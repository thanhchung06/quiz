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
 * Changes per request. The first sync of a family's data is thousands of
 * records; one huge request risks Apps Script's execution-time limit and,
 * if anything fails, redoes everything. Batches commit (and are marked
 * synced locally) one by one, so a retry only resends what is left.
 */
export const SYNC_BATCH_SIZE = 100;

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

  private running?: Promise<SyncOutcome>;

  /**
   * Waits before re-sending a request that failed in transit or came back as
   * an Apps Script error page (Google's side often fails transiently on long
   * syncs). The same request — same syncId — is re-sent, so if Google had in
   * fact committed it, the script replays the stored result instead of
   * applying it twice.
   */
  retryDelaysMs = [2000, 5000, 10000];

  /** One sync at a time: an automatic sync and a button press share the same run instead of uploading twice. */
  syncNormally(endpointUrl: string): Promise<SyncOutcome> {
    this.running ??= this.runSync(endpointUrl).finally(() => (this.running = undefined));
    return this.running;
  }

  /**
   * Pull, then push. Pulling first lets this device take over the records
   * other devices already stored (e.g. the default categories, which every
   * device seeds on its own) before uploading its own copies of them.
   */
  private async runSync(endpointUrl: string): Promise<SyncOutcome> {
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

    const outcome = await this.pull(endpointUrl, sharedSecret).then((pulled) =>
      pulled === 'success' ? this.push(endpointUrl, sharedSecret) : pulled,
    );
    this._lastOutcome.set(outcome);
    return outcome;
  }

  /** Receives other devices' changes page by page, remembering how far it got (per device). */
  private async pull(endpointUrl: string, sharedSecret: string): Promise<SyncOutcome> {
    let since = (await this.settings.get()).lastPulledRevision ?? 0;
    for (let page = 0; page < 10_000; page++) {
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, [], since));
      if (outcome !== 'success' || !response) return outcome;
      if (typeof response.dataRevision !== 'number') return 'success'; // script too old to support pulling
      const applied = await this.downloads.apply(response.downloads ?? []);
      this._received.update((n) => n + applied);
      since = response.dataRevision;
      await this.settings.update({ lastPulledRevision: since });
      if (!response.hasMore) break;
    }
    return 'success';
  }

  /** Uploads this device's pending changes in batches; each committed batch is marked synced right away. */
  private async push(endpointUrl: string, sharedSecret: string): Promise<SyncOutcome> {
    const changes = await this.batchBuilder.collectPendingChanges();
    this._progress.set({ sent: 0, total: changes.length });
    for (let start = 0; start < changes.length; start += SYNC_BATCH_SIZE) {
      const batch = changes.slice(start, start + SYNC_BATCH_SIZE);
      const { outcome, response } = await this.post(endpointUrl, this.request(sharedSecret, batch));
      if (outcome !== 'success' || !response) return outcome;
      await this.applySuccessResponse(response, batch);
      if (response.conflicts && response.conflicts.length > 0) {
        this.conflictState.setConflicts(response.conflicts);
      }
      this._progress.set({ sent: Math.min(start + batch.length, changes.length), total: changes.length });
    }
    return 'success';
  }

  private request(sharedSecret: string, changes: SyncChange[], pullSince?: number): SyncRequestBody {
    return {
      syncId: crypto.randomUUID(),
      deviceId: currentDeviceId(),
      sharedSecret,
      startedAt: new Date().toISOString(),
      lastKnownDataRevision: pullSince ?? 0,
      action: 'SYNC_NORMAL',
      changes,
      ...(pullSince !== undefined ? { pullSince } : {}),
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
    try {
      const res = await fetch(endpointUrl, {
        method: 'POST',
        // Apps Script Web Apps don't handle CORS preflight requests, so the
        // request must stay a CORS "simple request": Content-Type limited to
        // text/plain (never application/json) and no custom headers like
        // Authorization — doPost still reads the raw body correctly via
        // e.postData.contents regardless of the declared Content-Type.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
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
