import { Table } from 'dexie';
import { SyncEnvelope } from '../../shared/models/sync.model';

export function currentDeviceId(): string {
  const key = 'quiz-app.deviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Generic CRUD over a Dexie table for entities carrying the sync envelope
 * (data-model.md §0). Every local write increments localVersion and leaves
 * lastGoogleVersion untouched, per FR-057's version-only conflict detection.
 */
export class BaseRepository<T extends SyncEnvelope> {
  constructor(protected readonly table: Table<T, string>) {}

  async getById(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  async list(): Promise<T[]> {
    return this.table.filter((r) => !r.deletedAt).toArray();
  }

  async create(entity: T): Promise<T> {
    await this.table.add(entity);
    return entity;
  }

  /** Applies a partial update, bumping localVersion (never lastGoogleVersion). */
  async update(id: string, patch: Partial<T>): Promise<void> {
    await this.table.where(':id').equals(id).modify((record: T) => {
      Object.assign(record, patch);
      record.localVersion += 1;
      record.updatedAt = new Date().toISOString();
      record.updatedByDeviceId = currentDeviceId();
      record.syncStatus = 'pendingUpload';
    });
  }

  /** Soft-delete: stamps deletedAt rather than removing the row (FR-064 tombstones). */
  async softDelete(id: string): Promise<void> {
    await this.update(id, {
      deletedAt: new Date().toISOString(),
    } as Partial<T>);
  }
}
