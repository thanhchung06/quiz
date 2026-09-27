import { Injectable } from '@angular/core';
import { db } from '../data/db';
import { normalizeName } from '../data/repositories/category.repository';
import { Category, Exercise, Profile, QuizItem } from '../shared/models/domain.model';
import { SyncEnvelope } from '../shared/models/sync.model';
import { SyncDownload } from './sync-api.types';

export const TABLE_BY_ENTITY: Record<string, keyof typeof db> = {
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

type AnyTable = { get(id: string): Promise<(SyncEnvelope & Record<string, unknown>) | undefined>; put(record: object): Promise<unknown> };

/**
 * Applies records received from Google (another device's changes, or a newer
 * copy of a record this device sent) to the local database:
 *
 * - A record edited here and not uploaded yet is left alone — the upload that
 *   follows lets the server's version check decide (upload or conflict).
 * - A copy this device already has (same or newer Google version) is skipped.
 * - A Profile keeps this device's own `credentialHash`: it is never synced
 *   (FR-066), so the downloaded copy doesn't have one.
 * - A Category that duplicates a local one by name+subject (each device
 *   seeds the default categories on its own) takes the local one's place:
 *   its questions and exercise random groups are moved over, and the local
 *   duplicate is removed.
 */
@Injectable({ providedIn: 'root' })
export class DownloadApplierService {
  /** Returns how many records were written locally. */
  async apply(downloads: SyncDownload[]): Promise<number> {
    let applied = 0;
    for (const download of downloads) {
      const tableName = TABLE_BY_ENTITY[download.entityType];
      if (!tableName) continue;
      const table = db[tableName] as unknown as AnyTable;
      const local = await table.get(download.entityId);
      if (local?.syncStatus === 'pendingUpload') continue;
      if (local && (local.lastGoogleVersion ?? 0) >= download.version) continue;

      const record: Record<string, unknown> = {
        ...download.payload,
        id: download.entityId,
        lastGoogleVersion: download.version,
        localVersion: download.version,
        syncStatus: 'synced',
      };
      if (download.entityType === 'Profile') {
        const credentialHash = (local as unknown as Profile | undefined)?.credentialHash;
        if (credentialHash) record['credentialHash'] = credentialHash;
      }
      if (download.entityType === 'Category' && !local) {
        await this.replaceLocalDuplicates(record as unknown as Category);
      }
      await table.put(record);
      applied++;
    }
    return applied;
  }

  /**
   * "Google → this device" overwrite: each record is written exactly as Google
   * has it, whatever the local copy (edited or not, newer or not). Only the
   * Profile login hash stays, since it never leaves the device.
   */
  async overwrite(downloads: SyncDownload[]): Promise<number> {
    let applied = 0;
    for (const download of downloads) {
      const tableName = TABLE_BY_ENTITY[download.entityType];
      if (!tableName || !download.payload || typeof download.payload !== 'object') continue;
      const table = db[tableName] as unknown as AnyTable;
      const record: Record<string, unknown> = {
        ...download.payload,
        id: download.entityId,
        lastGoogleVersion: download.version,
        localVersion: download.version,
        syncStatus: 'synced',
      };
      if (download.entityType === 'Profile') {
        const local = (await table.get(download.entityId)) as unknown as Profile | undefined;
        if (local?.credentialHash) record['credentialHash'] = local.credentialHash;
      }
      await table.put(record);
      applied++;
    }
    return applied;
  }

  /**
   * Last step of a "Google → this device" overwrite: removes local records of
   * these types that Google does not have. Profiles are never removed — the
   * parent/child logins on this device must keep working.
   */
  async removeMissing(entityType: string, keepIds: ReadonlySet<string>): Promise<number> {
    const tableName = TABLE_BY_ENTITY[entityType];
    if (!tableName || entityType === 'Profile') return 0;
    const table = db[tableName] as unknown as { toCollection(): { primaryKeys(): Promise<string[]> }; bulkDelete(ids: string[]): Promise<void> };
    const missing = (await table.toCollection().primaryKeys()).filter((id) => !keepIds.has(id));
    if (missing.length > 0) await table.bulkDelete(missing);
    return missing.length;
  }

  private async replaceLocalDuplicates(incoming: Category): Promise<void> {
    if (incoming.deletedAt) return;
    const normalized = normalizeName(incoming.normalizedName ?? incoming.name);
    const duplicates = (await db.categories.toArray()).filter(
      (c) => c.id !== incoming.id && !c.deletedAt && c.normalizedName === normalized && c.subject === incoming.subject,
    );
    for (const duplicate of duplicates) {
      await this.moveCategoryReferences(duplicate.id, incoming.id);
      if ((duplicate.lastGoogleVersion ?? 0) === 0) {
        // Never reached Google — nothing to tell other devices, just drop it.
        await db.categories.delete(duplicate.id);
      } else {
        await db.categories.update(duplicate.id, {
          deletedAt: new Date().toISOString(),
          localVersion: duplicate.localVersion + 1,
          syncStatus: 'pendingUpload',
        });
      }
    }
  }

  private async moveCategoryReferences(fromId: string, toId: string): Promise<void> {
    const items = await db.quizItems.where('categoryId').equals(fromId).toArray();
    for (const item of items) {
      await db.quizItems.update(item.id, {
        categoryId: toId,
        localVersion: item.localVersion + 1,
        syncStatus: 'pendingUpload',
      } as Partial<QuizItem>);
    }
    for (const exercise of await db.exercises.toArray()) {
      let touched = false;
      const items = exercise.items.map((entry) => {
        if (entry.kind !== 'randomGroup' || !entry.randomGroup.categoryIds.includes(fromId)) return entry;
        touched = true;
        const categoryIds = Array.from(new Set(entry.randomGroup.categoryIds.map((id) => (id === fromId ? toId : id))));
        return { ...entry, randomGroup: { ...entry.randomGroup, categoryIds } };
      });
      if (touched) {
        await db.exercises.update(exercise.id, {
          items,
          localVersion: exercise.localVersion + 1,
          syncStatus: 'pendingUpload',
        } as Partial<Exercise>);
      }
    }
  }
}
