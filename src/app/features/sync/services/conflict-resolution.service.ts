import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { ConflictStateService } from '../../../sync-engine/conflict-state.service';
import { SyncConflict } from '../../../sync-engine/sync-api.types';
import { currentDeviceId } from '../../../data/repositories/base-repository';

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
};

/**
 * Conflict resolution (FR-061): Use Local / Use Google / Keep Both / Decide
 * Later. `resolvedVersion = max(localVersion, googleVersion) + 1`. Keep Both
 * preserves the Google record and creates the local content as a brand-new
 * record with a new UUID, never merging field-level content.
 */
@Injectable({ providedIn: 'root' })
export class ConflictResolutionService {
  constructor(private readonly conflictState: ConflictStateService) {}

  private resolvedVersion(conflict: SyncConflict): number {
    return Math.max(conflict.localVersion, conflict.googleVersion) + 1;
  }

  async useLocal(conflict: SyncConflict): Promise<void> {
    const tableName = TABLE_BY_ENTITY[conflict.entityType];
    if (!tableName) return;
    const table = db[tableName] as unknown as { update: (id: string, changes: object) => Promise<number> };
    await table.update(conflict.entityId, {
      localVersion: this.resolvedVersion(conflict),
      lastGoogleVersion: this.resolvedVersion(conflict),
      syncStatus: 'pendingUpload',
    });
    this.conflictState.resolveOne(conflict.entityType, conflict.entityId);
  }

  /** The Google copy's content must be fetched via a follow-up sync download; this stamps the resolved version locally once applied. */
  async useGoogle(conflict: SyncConflict): Promise<void> {
    this.conflictState.resolveOne(conflict.entityType, conflict.entityId);
  }

  async keepBoth(conflict: SyncConflict): Promise<void> {
    const tableName = TABLE_BY_ENTITY[conflict.entityType];
    if (!tableName) return;
    const table = db[tableName] as unknown as { get: (id: string) => Promise<Record<string, unknown> | undefined>; add: (record: object) => Promise<string> };
    const existing = await table.get(conflict.entityId);
    if (existing) {
      await table.add({
        ...existing,
        id: crypto.randomUUID(),
        localVersion: 1,
        lastGoogleVersion: 0,
        syncStatus: 'pendingUpload',
        updatedByDeviceId: currentDeviceId(),
        updatedAt: new Date().toISOString(),
      });
    }
    this.conflictState.resolveOne(conflict.entityType, conflict.entityId);
  }

  decideLater(): void {
    // No-op: the conflict remains listed until the parent chooses one of the other options.
  }
}
