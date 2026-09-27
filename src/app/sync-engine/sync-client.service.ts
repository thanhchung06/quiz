import { Injectable, signal } from '@angular/core';
import { db } from '../data/db';
import { currentDeviceId } from '../data/repositories/base-repository';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { BatchBuilderService } from './batch-builder.service';
import { GoogleAuthService } from '../features/sync/services/google-auth.service';
import { ConflictStateService } from './conflict-state.service';
import { DownloadApplierService, TABLE_BY_ENTITY } from './download-applier.service';
import { SyncRequestBody, SyncResponseBody, SyncChange } from './sync-api.types';

export type SyncOutcome = 'success' | 'busy' | 'rejected' | 'network-error' | 'server-error';

/**
 * Upload batches are cut by size rather than a fixed count: every request
 * pays a few seconds of Apps Script overhead, so small records (answers,
 * results) go up thousands at a time while long reading questions go a few
 * hundred at a time.
 */
export const SYNC_BATCH_MAX_CHARS = 1_000_000;
export const SYNC_BATCH_MAX_CHANGES = 2_000;

/**
 * Two independent sync scopes: questions (and their categories) only move
 * when the parent presses "Đồng bộ câu hỏi"; everything else ("data":
 * profiles, exercises, assignments, attempts, results, rewards…) also syncs
 * automatically. Each scope remembers its own "pulled up to" revision.
 */
export type SyncScope = 'questions' | 'data';
export const QUESTION_ENTITY_TYPES = ['Category', 'QuizItem'];
const DATA_ENTITY_TYPES = ['Profile', 'Exercise', 'Assignment', 'Rotation', 'Attempt', 'AnswerResult', 'Reward', 'PointRedemption'];
const SCOPE_TYPES: Record<SyncScope, string[]> = { questions: QUESTION_ENTITY_TYPES, data: DATA_ENTITY_TYPES };
const CURSOR: Record<SyncScope, 'lastPulledQuestionsRevision' | 'lastPulledRevision'> = {
  questions: 'lastPulledQuestionsRevision',
  data: 'lastPulledRevision',
};

/** What one sync run does: which scopes, and in which direction(s). */
export interface SyncRunOptions {
  scopes: SyncScope[];
  /** Google -> this device. */
  pull: boolean;
  /** This device -> Google. */
  push: boolean;
}

export interface SyncSummary {
  outcome: SyncOutcome;
  options: SyncRunOptions;
  received: number;
  sent: number;
  toSend: number;
  conflicts: number;
  seconds: number;
  error?: string;
}

/** Splits changes into requests of at most maxChars of JSON and maxChanges items (one oversized change still goes alone). */
export function batchBySize<T>(changes: T[], maxChars = SYNC_BATCH_MAX_CHARS, maxChanges = SYNC_BATCH_MAX_CHANGES): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const change of changes) {
    const length = JSON.stringify(change).length;
    if (current.length > 0 && (size + length > maxChars || current.length >= maxChanges)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(change);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Apps Script reports a thrown error as an HTML page; keep just the readable message. */
export function describeServerError(body: string): string {
  const text = body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const match = /((?:Exception|Error|TypeError|ReferenceError|SyntaxError)[^.]*(?:\.[^.]*){0,2})/.exec(text);
  return (match?.[1] ?? text).slice(0, 400) || 'Máy chủ trả về phản hồi không hợp lệ.';
}

/**
 * Client sync-engine request/response handling (contracts/sync-api.md):
 * posts the pending batch, applies accepted commits/downloads locally, and
 * surfaces conflicts. Never blocks child login/play (FR-055) — callers run
 * this fire-and-forget from Automatic Sync, or explicitly from the Sync screen.
 */
@Injectable({ providedIn: 'root' })
export class SyncClientService {
  private readonly _lastOutcome = signal<SyncOutcome | undefined>(undefined);
  private readonly _schemaIncompatible = signal(false);
  readonly lastOutcome = this._lastOutcome.asReadonly();
  private readonly _lastError = signal<string | undefined>(undefined);
  private readonly _progress = signal<{ sent: number; total: number } | undefined>(undefined);
  /** Human-readable reason for the last failed sync (Vietnamese, plus Google's own message when there is one). */
  readonly lastError = this._lastError.asReadonly();
  /** Changes uploaded so far in the running (or last) sync. */
  readonly progress = this._progress.asReadonly();
  /** FR-065: true once the server has reported its schema is newer than this client supports. */
  readonly schemaIncompatible = this._schemaIncompatible.asReadonly();

  private readonly _received = signal(0);
  /** Records received from other devices in the running (or last) sync. */
  readonly received = this._received.asReadonly();

  constructor(
    private readonly batchBuilder: BatchBuilderService,
    private readonly googleAuth: GoogleAuthService,
    private readonly conflictState: ConflictStateService,
    private readonly settings: AppSettingsRepository,
    private readonly downloads: DownloadApplierService,
  ) {}

  /** Syncs run one after another; asking again for the same run while it is queued joins it. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<SyncOutcome>>();
  private readonly _phase = signal<'pulling' | 'pushing' | undefined>(undefined);
  private readonly _lastSummary = signal<SyncSummary | undefined>(undefined);
  /** What the running sync is doing right now. */
  readonly phase = this._phase.asReadonly();
  /** Result of the last finished run, for the summary shown after "Đồng bộ ngay". */
  readonly lastSummary = this._lastSummary.asReadonly();

  /**
   * Waits before re-sending a request that failed in transit or came back as
   * an Apps Script error page (Google's side often fails transiently on long
   * syncs). The same request — same syncId — is re-sent, so if Google had in
   * fact committed it, the script replays the stored result instead of
   * applying it twice.
   */
  retryDelaysMs = [2000, 5000, 10000];

  /**
   * `scope`: 'data' (what automatic sync uses), 'questions' (the question
   * button), or 'all' (questions first, so exercises that use new questions
   * arrive after them). One sync at a time.
   */
  syncNormally(endpointUrl: string, scope: SyncScope | 'all' = 'all'): Promise<SyncOutcome> {
    return this.run(endpointUrl, { scopes: scope === 'all' ? ['questions', 'data'] : [scope], pull: true, push: true });
  }

  run(endpointUrl: string, options: SyncRunOptions): Promise<SyncOutcome> {
    const key = JSON.stringify(options);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const run = this.queue.then(() => this.runSync(endpointUrl, options)).finally(() => this.pending.delete(key));
    this.pending.set(key, run);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** True while any sync is running or queued. */
  isBusy(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Pull, then push. Pulling first lets this device take over the records
   * other devices already stored (e.g. the default categories, which every
   * device seeds on its own) before uploading its own copies of them.
   */
  private async runSync(endpointUrl: string, options: SyncRunOptions): Promise<SyncOutcome> {
    const started = Date.now();
    const outcome = await this.runScopes(endpointUrl, options);
    this._phase.set(undefined);
    const progress = this._progress() ?? { sent: 0, total: 0 };
    this._lastSummary.set({
      outcome,
      options,
      received: this._received(),
      sent: progress.sent,
      toSend: progress.total,
      conflicts: this.conflictState.conflicts().length,
      seconds: Math.round((Date.now() - started) / 1000),
      error: outcome === 'success' ? undefined : this._lastError(),
    });
    return outcome;
  }

  private async runScopes(endpointUrl: string, { scopes, pull, push }: SyncRunOptions): Promise<SyncOutcome> {
    if (this.conflictState.hasUnresolvedConflicts()) {
      // Automatic sync stays paused until every conflict is resolved (FR-061).
      this._lastError.set('Còn xung đột chưa giải quyết — hãy chọn cách xử lý ở bên dưới trước.');
      return 'rejected';
    }
    if (this._schemaIncompatible()) {
      // FR-065: refuse automatic synchronization once the Google schema is
      // known to be newer than this app build supports.
      return 'rejected';
    }

    const sharedSecret = this.googleAuth.sharedSecret();
    if (!sharedSecret) {
      this._lastError.set('Chưa có mã bí mật (SHARED_SECRET).');
      return 'rejected';
    }

    this._lastError.set(undefined);
    this._received.set(0);
    this._progress.set(undefined);

    let outcome: SyncOutcome = 'success';
    for (const scope of scopes) {
      if (pull) {
        this._phase.set('pulling');
        outcome = await this.pull(endpointUrl, sharedSecret, scope);
      }
      if (outcome === 'success' && push) {
        this._phase.set('pushing');
        outcome = await this.push(endpointUrl, sharedSecret, scope);
      }
      if (outcome !== 'success') break;
    }
    this._lastOutcome.set(outcome);
    return outcome;
  }

  /** Receives other devices' changes page by page, remembering how far it got (per device). */
  private async pull(endpointUrl: string, sharedSecret: string, scope: SyncScope): Promise<SyncOutcome> {
    let since = (await this.settings.get())[CURSOR[scope]] ?? 0;
    for (let page = 0; page < 10_000; page++) {
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, [], since, SCOPE_TYPES[scope]));
      if (outcome !== 'success' || !response) return outcome;
      if (typeof response.dataRevision !== 'number') return 'success'; // script too old to support pulling
      const applied = await this.downloads.apply(response.downloads ?? []);
      this._received.update((n) => n + applied);
      since = response.dataRevision;
      await this.settings.update({ [CURSOR[scope]]: since });
      if (!response.hasMore) break;
    }
    return 'success';
  }

  /** Uploads this device's pending changes of the scope, batched by size; each committed batch is marked synced right away. */
  private async push(endpointUrl: string, sharedSecret: string, scope: SyncScope): Promise<SyncOutcome> {
    const types = new Set(SCOPE_TYPES[scope]);
    const changes = (await this.batchBuilder.collectPendingChanges()).filter((c) => types.has(c.entityType));
    // Progress adds up over the scopes of one run (questions + data for a full sync).
    const before = this._progress() ?? { sent: 0, total: 0 };
    this._progress.set({ sent: before.sent, total: before.total + changes.length });
    let sent = before.sent;
    for (const batch of batchBySize(changes)) {
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, batch));
      if (outcome !== 'success' || !response) return outcome;
      await this.applySuccessResponse(response, batch);
      if (response.conflicts && response.conflicts.length > 0) {
        this.conflictState.setConflicts(response.conflicts);
      }
      sent += batch.length;
      this._progress.set({ sent, total: before.total + changes.length });
    }
    return 'success';
  }

  private request(sharedSecret: string, changes: SyncChange[], pullSince?: number, pullTypes?: string[]): SyncRequestBody {
    return {
      syncId: crypto.randomUUID(),
      deviceId: currentDeviceId(),
      sharedSecret,
      startedAt: new Date().toISOString(),
      lastKnownDataRevision: pullSince ?? 0,
      action: 'SYNC_NORMAL',
      changes,
      ...(pullSince !== undefined ? { pullSince, pullTypes } : {}),
    };
  }

  private async post(endpointUrl: string, body: SyncRequestBody): Promise<{ outcome: SyncOutcome; response?: SyncResponseBody }> {
    for (let retry = 0; ; retry++) {
      const result = await this.postOnce(endpointUrl, body);
      const transient = result.outcome === 'network-error' || result.outcome === 'server-error';
      if (!transient || retry >= this.retryDelaysMs.length) return result;
      await new Promise((resolve) => setTimeout(resolve, this.retryDelaysMs[retry]));
    }
  }

  private async postOnce(endpointUrl: string, body: SyncRequestBody, attempt = 0): Promise<{ outcome: SyncOutcome; response?: SyncResponseBody }> {
    let response: SyncResponseBody;
    let text: string;
    let status = 0;
    const payload = JSON.stringify(body);
    try {
      const res = await fetch(endpointUrl, {
        method: 'POST',
        // Apps Script Web Apps don't handle CORS preflight requests, so the
        // request must stay a CORS "simple request": Content-Type limited to
        // text/plain (never application/json) and no custom headers like
        // Authorization — doPost still reads the raw body correctly via
        // e.postData.contents regardless of the declared Content-Type.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload,
        // Lets a small sync fired while the app is being closed finish after the page is gone
        // (browsers cap keepalive bodies at 64 KB, so large batches go without it).
        keepalive: payload.length < 60_000,
      });
      status = res.status;
      text = await res.text();
    } catch {
      // Offline/unreachable: local changes stay pendingUpload; never blocks child login/play.
      this._lastError.set('Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.');
      return { outcome: 'network-error' };
    }
    try {
      response = JSON.parse(text) as SyncResponseBody;
    } catch {
      // The script threw (quota, cell size, bad deployment…) — Apps Script answers with an HTML error page.
      const detail = text.trim() ? describeServerError(text) : 'phản hồi trống';
      this._lastError.set(`Apps Script báo lỗi (HTTP ${status || '?'}): ${detail}`);
      return { outcome: 'server-error' };
    }

    if (response.result === 'SYNC_BUSY') {
      if (attempt >= 3) {
        this._lastError.set('Google Sheet đang bận với một lần đồng bộ khác. Thử lại sau ít phút.');
        return { outcome: 'busy' };
      }
      const backoffMs = 500 * Math.pow(2, attempt) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.postOnce(endpointUrl, body, attempt + 1);
    }

    if (response.result === 'SYNC_REJECTED') {
      if (response.schemaCompatible === false) {
        this._schemaIncompatible.set(true);
        this._lastError.set('Dữ liệu trên Google mới hơn phiên bản ứng dụng này.');
      } else {
        this._lastError.set('Google từ chối: mã bí mật không khớp với SHARED_SECRET trong Apps Script, hoặc có bản ghi phiên bản không hợp lệ.');
      }
      return { outcome: 'rejected' };
    }
    return { outcome: 'success', response };
  }

  private async applySuccessResponse(response: SyncResponseBody, sentChanges: SyncChange[]): Promise<void> {
    const committedIds = new Set(response.committedChangeGroupIds ?? []);
    for (const change of sentChanges) {
      if (!committedIds.has(change.changeGroupId)) continue;
      const tableName = TABLE_BY_ENTITY[change.entityType];
      if (!tableName) continue;
      const table = db[tableName] as unknown as {
        where(index: string): { equals(value: string): { modify(fn: (record: Record<string, unknown>) => void): Promise<number> } };
      };
      // Google now holds exactly this localVersion. If the record was edited again while the sync ran,
      // it stays pendingUpload so that newer edit goes up next time.
      await table
        .where(':id')
        .equals(change.entityId)
        .modify((record) => {
          record['lastGoogleVersion'] = change.localVersion;
          if (record['localVersion'] === change.localVersion) record['syncStatus'] = 'synced';
        });
    }
    await this.downloads.apply(response.downloads ?? []);
  }
}
