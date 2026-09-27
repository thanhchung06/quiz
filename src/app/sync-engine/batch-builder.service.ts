import { Injectable } from '@angular/core';
import { Table } from 'dexie';
import { db } from '../data/db';
import { SyncChange, EntityTypeName } from './sync-api.types';
import { SyncEnvelope } from '../shared/models/sync.model';
import { Profile } from '../shared/models/domain.model';
import { ProfileRepository } from '../data/repositories/profile.repository';

const TABLES: Array<{ type: EntityTypeName; table: () => Table<SyncEnvelope, string> }> = [
  { type: 'Profile', table: () => db.profiles as unknown as Table<SyncEnvelope, string> },
  { type: 'Category', table: () => db.categories as unknown as Table<SyncEnvelope, string> },
  { type: 'QuizItem', table: () => db.quizItems as unknown as Table<SyncEnvelope, string> },
  { type: 'Exercise', table: () => db.exercises as unknown as Table<SyncEnvelope, string> },
  { type: 'Assignment', table: () => db.assignments as unknown as Table<SyncEnvelope, string> },
  { type: 'Rotation', table: () => db.rotations as unknown as Table<SyncEnvelope, string> },
  { type: 'Attempt', table: () => db.attempts as unknown as Table<SyncEnvelope, string> },
  { type: 'AnswerResult', table: () => db.answerResults as unknown as Table<SyncEnvelope, string> },
  { type: 'Reward', table: () => db.rewards as unknown as Table<SyncEnvelope, string> },
  { type: 'PointRedemption', table: () => db.pointRedemptions as unknown as Table<SyncEnvelope, string> },
];

/**
 * Turns local records into upload changes (FR-057, FR-060). Each entity's own
 * id is its change group, since this app's data model already embeds related
 * sub-records (e.g., ExerciseItem) inside their parent row rather than as
 * separate tables — so no record ever needs to commit jointly with a sibling
 * row. `Profile.credentialHash`, any OAuth token, and local-only UI state are
 * never included (FR-066).
 */
@Injectable({ providedIn: 'root' })
export class BatchBuilderService {
  constructor(private readonly profiles: ProfileRepository) {}

  /** Records changed here and not uploaded yet (all types, or just these), found through the syncStatus index. */
  async collectPendingChanges(types?: readonly string[]): Promise<SyncChange[]> {
    return this.collect(types, (table) => table.where('syncStatus').equals('pendingUpload').toArray());
  }

  /** Every local record of these types, pending or not (deletions included) — for a "this device → Google" mirror. */
  async collectAll(types: readonly string[]): Promise<SyncChange[]> {
    return this.collect(types, (table) => table.toArray());
  }

  private async collect(types: readonly string[] | undefined, read: (table: Table<SyncEnvelope, string>) => Promise<SyncEnvelope[]>): Promise<SyncChange[]> {
    const changes: SyncChange[] = [];
    for (const { type, table } of TABLES) {
      if (types && !types.includes(type)) continue;
      let rows = await read(table());
      if (type === 'Profile') rows = rows.map((p) => this.profiles.toSyncable(p as Profile) as unknown as SyncEnvelope);
      for (const row of rows) {
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
