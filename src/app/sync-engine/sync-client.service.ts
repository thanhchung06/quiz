import { Injectable, signal } from '@angular/core';
import { db } from '../data/db';
import { currentDeviceId } from '../data/repositories/base-repository';
import { BatchBuilderService } from './batch-builder.service';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { GoogleAuthService } from '../features/sync/services/google-auth.service';
import { DownloadApplierService, TABLE_BY_ENTITY } from './download-applier.service';
import { SyncRequestBody, SyncResponseBody, SyncChange } from './sync-api.types';
import { SyncEnvelope } from '../shared/models/sync.model';
import { PARENT_TYPES, uploadPolicy, Uploader, UploadCandidate } from './upload-policy';

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
 * Two sync scopes: questions (and their categories), which automatic sync
 * only includes when "Đồng bộ cả câu hỏi" is ticked, and everything else
 * ("data": profiles, exercises, assignments, attempts, results, rewards…).
 */
export type SyncScope = 'questions' | 'data';
export const QUESTION_ENTITY_TYPES = ['Category', 'QuizItem'];
const DATA_ENTITY_TYPES = ['Profile', 'Exercise', 'Assignment', 'Rotation', 'Attempt', 'AnswerResult', 'Reward', 'PointRedemption'];
const SCOPE_TYPES: Record<SyncScope, string[]> = { questions: QUESTION_ENTITY_TYPES, data: DATA_ENTITY_TYPES };

/**
 * What one sync run does.
 *
 * No conflicts and no change log: whatever goes up overwrites Google's copy,
 * whatever comes down overwrites this device's copy. Versions only tell which
 * records differ, so unchanged ones aren't downloaded again.
 */
export interface SyncRunOptions {
  scopes: SyncScope[];
  /** Google -> this device. */
  pull: boolean;
  /** This device -> Google. */
  push: boolean;
  /**
   * 'changes' (automatic sync): push only records changed here; pull only
   * records that differ from Google, keeping any local change not uploaded
   * yet; never delete local records.
   * 'mirror' ("Đồng bộ ngay", one direction): the receiving side ends up
   * like the sending side — see pushAll / pullAll for the exceptions
   * (profiles, and data only a child's own login may upload).
   */
  mode: 'changes' | 'mirror';
  /** Questions and categories: only add those the receiving side doesn't have yet — never update or delete. */
  addedQuestionsOnly?: boolean;
  /** Who is logged in: decides which local records may go up (see uploadPolicy). Nobody: nothing goes up. */
  uploader?: Uploader;
}

export interface SyncSummary {
  outcome: SyncOutcome;
  options: SyncRunOptions;
  received: number;
  sent: number;
  toSend: number;
  /** Mirror only: records deleted on the receiving side because the sending side doesn't have them. */
  removed: number;
  seconds: number;
  error?: string;
}

/** Records per FETCH request (the script also stops early on big answers, see `truncated`). */
const FETCH_IDS_PER_REQUEST = 300;

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
 * Talks to the Apps Script endpoint (contracts/sync-api.md). Uploads
 * overwrite Google's copy (REPLACE_GOOGLE_WITH_LOCAL); downloads list
 * Google's ids + versions (INDEX) and fetch only the records whose version
 * differs from this device's copy (FETCH), then overwrite the local copy.
 * Never blocks child login/play (FR-055) — callers run this fire-and-forget
 * from Automatic Sync, or explicitly from the Sync screen.
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
  /** Records uploaded so far in the running (or last) sync. */
  readonly progress = this._progress.asReadonly();
  /** FR-065: true once the server has reported its schema is newer than this client supports. */
  readonly schemaIncompatible = this._schemaIncompatible.asReadonly();

  private readonly _removed = signal(0);
  private readonly _received = signal(0);
  /** Records received from Google in the running (or last) sync. */
  readonly received = this._received.asReadonly();

  constructor(
    private readonly batchBuilder: BatchBuilderService,
    private readonly googleAuth: GoogleAuthService,
    private readonly downloads: DownloadApplierService,
    private readonly settings: AppSettingsRepository,
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
   * syncs). Re-sending is harmless: every request either only reads, or
   * writes records as they are (the same syncId also replays a stored result).
   */
  retryDelaysMs = [2000, 5000, 10000];

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
      removed: this._removed(),
      seconds: Math.round((Date.now() - started) / 1000),
      error: outcome === 'success' ? undefined : this._lastError(),
    });
    return outcome;
  }

  /**
   * Per scope (questions first, so exercises arrive after the questions they
   * use): push, then pull. Pushing first means nothing changed here is
   * overwritten by an older Google copy before it went up.
   */
  private async runScopes(endpointUrl: string, options: SyncRunOptions): Promise<SyncOutcome> {
    if (this._schemaIncompatible()) {
      // FR-065: refuse synchronization once the Google schema is known to be newer than this app build supports.
      return 'rejected';
    }
    const sharedSecret = this.googleAuth.sharedSecret();
    if (!sharedSecret) {
      this._lastError.set('Chưa có mã bí mật (SHARED_SECRET).');
      return 'rejected';
    }

    this._lastError.set(undefined);
    this._received.set(0);
    this._removed.set(0);
    this._progress.set(undefined);
    const mayUpload = await uploadPolicy(options.uploader);

    let outcome: SyncOutcome = 'success';
    for (const scope of options.scopes) {
      if (options.push) {
        this._phase.set('pushing');
        outcome = await this.push(endpointUrl, sharedSecret, scope, options, mayUpload);
      }
      if (outcome === 'success' && options.pull) {
        this._phase.set('pulling');
        outcome = await this.pull(endpointUrl, sharedSecret, scope, options, mayUpload);
      }
      if (outcome !== 'success') break;
    }
    this._lastOutcome.set(outcome);
    return outcome;
  }

  /**
   * Uploads the scope's records the logged-in person may upload, each
   * overwriting Google's copy: in 'changes' mode those changed here, in
   * 'mirror' mode all of them — and then, for the parent, Google marks
   * deleted whatever parent-managed record this device doesn't have.
   * With addedQuestionsOnly, only questions/categories never uploaded before go up.
   */
  private async push(
    endpointUrl: string,
    sharedSecret: string,
    scope: SyncScope,
    options: SyncRunOptions,
    mayUpload: (record: UploadCandidate) => boolean,
  ): Promise<SyncOutcome> {
    const types = SCOPE_TYPES[scope];
    const addedOnly = !!options.addedQuestionsOnly && scope === 'questions';
    const all = options.mode === 'mirror' ? await this.batchBuilder.collectAll(types) : await this.batchBuilder.collectPendingChanges(types);
    const changes = all.filter((c) => types.includes(c.entityType) && mayUpload(c) && (!addedOnly || c.lastGoogleVersion === 0));

    // Progress adds up over the scopes of one run (questions + data).
    const before = this._progress() ?? { sent: 0, total: 0 };
    const total = before.total + changes.length;
    this._progress.set({ sent: before.sent, total });
    let sent = before.sent;
    for (const batch of batchBySize(changes)) {
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, { action: 'REPLACE_GOOGLE_WITH_LOCAL', changes: batch }));
      if (outcome !== 'success' || !response) return outcome;
      if (!response.versions) return this.scriptTooOld();
      await this.markUploaded(batch, response.versions);
      sent += batch.length;
      this._progress.set({ sent, total });
    }

    if (options.mode === 'mirror' && options.uploader?.role === 'parent') {
      const keepIds: Record<string, string[]> = {};
      for (const type of types) {
        if (PARENT_TYPES.includes(type) && !(addedOnly && QUESTION_ENTITY_TYPES.includes(type))) keepIds[type] = [];
      }
      if (Object.keys(keepIds).length > 0) {
        for (const change of all) keepIds[change.entityType]?.push(change.entityId);
        const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, { action: 'REPLACE_PRUNE', keepIds }));
        if (outcome !== 'success' || !response) return outcome;
        this._removed.update((n) => n + (response.removed ?? 0));
      }
    }
    return 'success';
  }

  /** After an upload: the record's version is now Google's. An edit made meanwhile stays pending, one version above it. */
  private async markUploaded(batch: SyncChange[], versions: Record<string, number>): Promise<void> {
    for (const change of batch) {
      const version = versions[change.entityId];
      const tableName = TABLE_BY_ENTITY[change.entityType];
      if (version === undefined || !tableName) continue;
      const table = db[tableName] as unknown as {
        where(index: string): { equals(value: string): { modify(fn: (record: Record<string, unknown>) => void): Promise<number> } };
      };
      await table
        .where(':id')
        .equals(change.entityId)
        .modify((record) => {
          record['lastGoogleVersion'] = version;
          if (record['localVersion'] === change.localVersion) {
            record['localVersion'] = version;
            record['syncStatus'] = 'synced';
          } else {
            record['localVersion'] = Math.max(record['localVersion'] as number, version + 1);
          }
        });
    }
  }

  /**
   * Downloads the scope from Google, overwriting local copies: lists Google's
   * ids + versions, fetches every record this device lacks or holds at another
   * version, and stores it as is. A local change not uploaded yet is kept —
   * in 'mirror' mode only when the logged-in person couldn't upload it anyway
   * (e.g. a child's results on the parent's login). 'mirror' also deletes
   * local records Google doesn't have, never Profiles or such kept changes.
   * With addedQuestionsOnly, questions/categories only come from the sheet
   * rows after the last one this device has read (see pullNewRows).
   */
  private async pull(
    endpointUrl: string,
    sharedSecret: string,
    scope: SyncScope,
    options: SyncRunOptions,
    mayUpload: (record: UploadCandidate) => boolean,
  ): Promise<SyncOutcome> {
    if (scope === 'questions' && options.addedQuestionsOnly) return this.pullNewRows(endpointUrl, sharedSecret, SCOPE_TYPES[scope]);

    const types = SCOPE_TYPES[scope];
    const indexed = await this.post(endpointUrl, this.request(sharedSecret, { action: 'INDEX', indexTypes: types }));
    if (indexed.outcome !== 'success' || !indexed.response) return indexed.outcome;
    const index = indexed.response.index;
    if (!index) return this.scriptTooOld();

    for (const type of types) {
      const tableName = TABLE_BY_ENTITY[type];
      if (!tableName) continue;
      const table = db[tableName] as unknown as { toArray(): Promise<Array<SyncEnvelope & Record<string, unknown>>> };
      const locals = new Map((await table.toArray()).map((r) => [r.id, r]));
      const keepLocal = (local: SyncEnvelope & Record<string, unknown>) =>
        local.syncStatus === 'pendingUpload' &&
        (options.mode === 'changes' || !mayUpload({ entityType: type, entityId: local.id, lastGoogleVersion: local.lastGoogleVersion, payload: local }));

      const googleIds = new Set<string>();
      const wanted: string[] = [];
      for (const [id, version] of index[type] ?? []) {
        googleIds.add(id);
        const local = locals.get(id);
        if (!local) wanted.push(id);
        else if (keepLocal(local)) continue;
        else if (local.lastGoogleVersion !== version || local.syncStatus === 'pendingUpload') wanted.push(id);
      }

      const outcome = await this.fetchAndStore(endpointUrl, sharedSecret, type, wanted);
      if (outcome !== 'success') return outcome;

      if (options.mode === 'mirror' && type !== 'Profile') {
        const missing = Array.from(locals.values())
          .filter((local) => !googleIds.has(local.id) && !keepLocal(local))
          .map((local) => local.id);
        this._removed.update((n) => n + missing.length);
        await this.downloads.remove(type, missing);
      }
    }
    // Everything up to these rows is now here: "new questions only" can carry on after them.
    if (scope === 'questions' && indexed.response.lastRows) await this.saveRowCursor(indexed.response.lastRows);
    return 'success';
  }

  /**
   * "Only newly added questions": new records are always appended to their
   * sheet (edits stay in their row), so this device remembers the last row it
   * has read per sheet and asks only for the rows after it. Records it already
   * has are left alone; so are new ones that are already deleted.
   */
  private async pullNewRows(endpointUrl: string, sharedSecret: string, types: string[]): Promise<SyncOutcome> {
    for (let page = 0; page < 10_000; page++) {
      const cursor = (await this.settings.get()).questionRowCursor ?? {};
      const rowsAfter = Object.fromEntries(types.map((type) => [type, cursor[type] ?? 0]));
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, { action: 'ROWS_AFTER', rowsAfter }));
      if (outcome !== 'success' || !response) return outcome;
      if (!response.lastRows) return this.scriptTooOld();

      const fresh = [];
      for (const download of response.downloads ?? []) {
        const tableName = TABLE_BY_ENTITY[download.entityType];
        if (!tableName || download.payload?.['deletedAt']) continue;
        const table = db[tableName] as unknown as { get(id: string): Promise<unknown> };
        if (!(await table.get(download.entityId))) fresh.push(download);
      }
      const applied = await this.downloads.overwrite(fresh);
      this._received.update((n) => n + applied);
      await this.saveRowCursor(response.lastRows);
      if (!response.truncated) break;
    }
    return 'success';
  }

  private async saveRowCursor(lastRows: Record<string, number>): Promise<void> {
    const cursor = (await this.settings.get()).questionRowCursor ?? {};
    await this.settings.update({ questionRowCursor: { ...cursor, ...lastRows } });
  }

  private async fetchAndStore(endpointUrl: string, sharedSecret: string, type: string, ids: string[]): Promise<SyncOutcome> {
    let queue = ids;
    while (queue.length > 0) {
      const chunk = queue.slice(0, FETCH_IDS_PER_REQUEST);
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, { action: 'FETCH', fetchIds: { [type]: chunk } }));
      if (outcome !== 'success' || !response) return outcome;
      const applied = await this.downloads.overwrite(response.downloads ?? []);
      this._received.update((n) => n + applied);
      const got = new Set((response.downloads ?? []).map((d) => d.entityId));
      // Not truncated: every id was answered (ids gone from Google are simply absent).
      const rest = response.truncated ? chunk.filter((id) => !got.has(id)) : [];
      if (response.truncated && got.size === 0) return this.scriptTooOld();
      queue = [...rest, ...queue.slice(chunk.length)];
    }
    return 'success';
  }

  private scriptTooOld(): SyncOutcome {
    this._lastError.set('Apps Script trên Google là bản cũ. Hãy dán bản Code.gs.js mới rồi Deploy → Manage deployments → ✏️ → New version.');
    return 'server-error';
  }

  private request(sharedSecret: string, body: Partial<SyncRequestBody> & Pick<SyncRequestBody, 'action'>): SyncRequestBody {
    return {
      syncId: crypto.randomUUID(),
      deviceId: currentDeviceId(),
      sharedSecret,
      startedAt: new Date().toISOString(),
      lastKnownDataRevision: 0,
      changes: [],
      ...body,
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
        this._lastError.set('Google từ chối: mã bí mật không khớp với SHARED_SECRET trong Apps Script.');
      }
      return { outcome: 'rejected' };
    }
    return { outcome: 'success', response };
  }
}
