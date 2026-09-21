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

export type SyncOutcome = 'success' | 'busy' | 'rejected' | 'network-error';

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
  /** FR-065: true once the server has reported its schema is newer than this client supports. */
  readonly schemaIncompatible = this._schemaIncompatible.asReadonly();

  constructor(
    private readonly batchBuilder: BatchBuilderService,
    private readonly googleAuth: GoogleAuthService,
    private readonly conflictState: ConflictStateService,
  ) {}

  async syncNormally(endpointUrl: string): Promise<SyncOutcome> {
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
      return 'rejected';
    }

    const changes = await this.batchBuilder.collectPendingChanges();
    const body: SyncRequestBody = {
      syncId: crypto.randomUUID(),
      deviceId: currentDeviceId(),
      sharedSecret,
      startedAt: new Date().toISOString(),
      lastKnownDataRevision: 0,
      action: 'SYNC_NORMAL',
      changes,
    };

    const outcome = await this.postWithRetry(endpointUrl, body);
    this._lastOutcome.set(outcome);
    return outcome;
  }

  private async postWithRetry(endpointUrl: string, body: SyncRequestBody, attempt = 0): Promise<SyncOutcome> {
    let response: SyncResponseBody;
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
      response = (await res.json()) as SyncResponseBody;
    } catch {
      // Offline/unreachable: local changes stay pendingUpload; never blocks child login/play.
      return 'network-error';
    }

    if (response.result === 'SYNC_BUSY') {
      if (attempt >= 3) return 'busy';
      const backoffMs = 500 * Math.pow(2, attempt) + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.postWithRetry(endpointUrl, { ...body, syncId: body.syncId }, attempt + 1);
    }

    if (response.result === 'SYNC_REJECTED') {
      if (response.schemaCompatible === false) {
        this._schemaIncompatible.set(true);
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
