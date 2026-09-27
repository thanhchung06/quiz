import { Injectable, signal } from '@angular/core';
import { db } from '../data/db';
import { currentDeviceId } from '../data/repositories/base-repository';
import { BatchBuilderService } from './batch-builder.service';
import { GoogleAuthService } from '../features/sync/services/google-auth.service';
import { ConflictStateService } from './conflict-state.service';
import { SyncRequestBody, SyncResponseBody, SyncChange } from './sync-api.types';

const TABLE_BY_ENTITY: Record<string, keyof typeof db> = {
  Profile: 'profiles',
  Category: 'categories',
  QuizItem: 'quizItems',
  Exercise: 'exercises',
  Assignment: 'assignments',
  Rotation: 'rotations',
  Attempt: 'attempts',
  AnswerResult: 'answerResults',
  Reward: 'rewards',
  PointRedemption: 'pointRedemptions',
};

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

  constructor(
    private readonly batchBuilder: BatchBuilderService,
    private readonly googleAuth: GoogleAuthService,
    private readonly conflictState: ConflictStateService,
  ) {}

  private running?: Promise<SyncOutcome>;

  /** One sync at a time: an automatic sync and a button press share the same run instead of uploading twice. */
  syncNormally(endpointUrl: string): Promise<SyncOutcome> {
    this.running ??= this.runSync(endpointUrl).finally(() => (this.running = undefined));
    return this.running;
  }

  private async runSync(endpointUrl: string): Promise<SyncOutcome> {
    if (this.conflictState.hasUnresolvedConflicts()) {
      // Automatic sync stays paused until every conflict is resolved (FR-061).
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
    const changes = await this.batchBuilder.collectPendingChanges();
    this._progress.set({ sent: 0, total: changes.length });

    // Always at least one request, so an up-to-date device still receives others' changes.
    let outcome: SyncOutcome = 'success';
    for (let start = 0; start === 0 || start < changes.length; start += SYNC_BATCH_SIZE) {
      const batch = changes.slice(start, start + SYNC_BATCH_SIZE);
      const body: SyncRequestBody = {
        syncId: crypto.randomUUID(),
        deviceId: currentDeviceId(),
        sharedSecret,
        startedAt: new Date().toISOString(),
        lastKnownDataRevision: 0,
        action: 'SYNC_NORMAL',
        changes: batch,
      };
      outcome = await this.postWithRetry(endpointUrl, body);
      if (outcome !== 'success') break;
      this._progress.set({ sent: Math.min(start + batch.length, changes.length), total: changes.length });
    }

    this._lastOutcome.set(outcome);
    return outcome;
  }

  private async postWithRetry(endpointUrl: string, body: SyncRequestBody, attempt = 0): Promise<SyncOutcome> {
    let response: SyncResponseBody;
    let text: string;
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
      text = await res.text();
    } catch {
      // Offline/unreachable: local changes stay pendingUpload; never blocks child login/play.
      this._lastError.set('Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.');
      return 'network-error';
    }
    try {
      response = JSON.parse(text) as SyncResponseBody;
    } catch {
      // The script threw (quota, cell size, bad deployment…) — Apps Script answers with an HTML error page.
      this._lastError.set(`Apps Script báo lỗi: ${describeServerError(text)}`);
      return 'server-error';
    }

    if (response.result === 'SYNC_BUSY') {
      if (attempt >= 3) {
        this._lastError.set('Google Sheet đang bận với một lần đồng bộ khác. Thử lại sau ít phút.');
        return 'busy';
      }
      const backoffMs = 500 * Math.pow(2, attempt) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.postWithRetry(endpointUrl, { ...body, syncId: body.syncId }, attempt + 1);
    }

    if (response.result === 'SYNC_REJECTED') {
      if (response.schemaCompatible === false) {
        this._schemaIncompatible.set(true);
        this._lastError.set('Dữ liệu trên Google mới hơn phiên bản ứng dụng này.');
      } else {
        this._lastError.set('Google từ chối: mã bí mật không khớp với SHARED_SECRET trong Apps Script.');
      }
      return 'rejected';
    }

    await this.applySuccessResponse(response, body.changes);
    if (response.conflicts && response.conflicts.length > 0) {
      this.conflictState.setConflicts(response.conflicts);
    }
    return 'success';
  }

  private async applySuccessResponse(response: SyncResponseBody, sentChanges: SyncChange[]): Promise<void> {
    const committedIds = new Set(response.committedChangeGroupIds ?? []);
    for (const change of sentChanges) {
      if (!committedIds.has(change.changeGroupId)) continue;
      const tableName = TABLE_BY_ENTITY[change.entityType];
      if (!tableName) continue;
      const table = db[tableName] as unknown as { update: (id: string, changes: object) => Promise<number> };
      await table.update(change.entityId, {
        lastGoogleVersion: change.localVersion,
        syncStatus: 'synced',
      });
    }

    for (const download of response.downloads ?? []) {
      const tableName = TABLE_BY_ENTITY[download.entityType];
      if (!tableName) continue;
      const table = db[tableName] as unknown as { put: (record: object) => Promise<string> };
      await table.put({ ...download.payload, lastGoogleVersion: download.version, localVersion: download.version, syncStatus: 'synced' });
    }
  }
}
