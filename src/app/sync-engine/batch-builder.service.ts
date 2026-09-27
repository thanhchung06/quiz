import { Injectable } from '@angular/core';
import { db } from '../data/db';
import { SyncChange, EntityTypeName } from './sync-api.types';
import { SyncEnvelope } from '../shared/models/sync.model';
import { Profile } from '../shared/models/domain.model';
import { ProfileRepository } from '../data/repositories/profile.repository';

/**
 * Collects pending local changes grouped by changeGroupId (FR-057, FR-060).
 * Each entity's own id is its change group, since this app's data model
 * already embeds related sub-records (e.g., ExerciseItem) inside their
 * parent row rather than as separate tables — so no record ever needs to
 * commit jointly with a sibling row. `Profile.credentialHash`, any OAuth
 * token, and local-only UI state are never included (FR-066).
 */
@Injectable({ providedIn: 'root' })
export class BatchBuilderService {
  constructor(private readonly profiles: ProfileRepository) {}

  async collectPendingChanges(): Promise<SyncChange[]> {
    return this.collect((row) => row.syncStatus === 'pendingUpload');
  }

  /** Every local record of these types, pending or not (deletions included) — for a "this device → Google" overwrite. */
  async collectAll(types: readonly string[]): Promise<SyncChange[]> {
    return (await this.collect(() => true)).filter((change) => types.includes(change.entityType));
  }

  private async collect(include: (row: SyncEnvelope) => boolean): Promise<SyncChange[]> {
    const tables: Array<{ type: EntityTypeName; rows: SyncEnvelope[] }> = [
      { type: 'Profile', rows: (await db.profiles.toArray()).map((p) => this.profiles.toSyncable(p) as unknown as Profile) },
      { type: 'Category', rows: await db.categories.toArray() },
      { type: 'QuizItem', rows: await db.quizItems.toArray() },
      { type: 'Exercise', rows: await db.exercises.toArray() },
      { type: 'Assignment', rows: await db.assignments.toArray() },
      { type: 'Rotation', rows: await db.rotations.toArray() },
      { type: 'Attempt', rows: await db.attempts.toArray() },
      { type: 'AnswerResult', rows: await db.answerResults.toArray() },
      { type: 'Reward', rows: await db.rewards.toArray() },
      { type: 'PointRedemption', rows: await db.pointRedemptions.toArray() },
    ];

    const changes: SyncChange[] = [];
    for (const { type, rows } of tables) {
      for (const row of rows) {
        if (!include(row)) continue;
        changes.push({
          changeGroupId: row.id,
          entityType: type,
          entityId: row.id,
          localVersion: row.localVersion,
          lastGoogleVersion: row.lastGoogleVersion,
          operation: row.deletedAt ? 'delete' : 'upsert',
          payload: row as unknown as Record<string, unknown>,
        });
      }
    }
    return changes;
  }
}
