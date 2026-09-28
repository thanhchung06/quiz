import { Table } from 'dexie';
import { SyncEnvelope } from '../../shared/models/sync.model';
import { JsonRecord, SequencedSheet } from '../../sync/protocol';
import { enqueue } from '../outbox';

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
 * CRUD for the records of a sequenced sheet (Profile, Category, QuizItem,
 * Exercise — plan §3.8). Every write is stored locally and, with sync on,
 * queued as a WRITE_RECORD that overwrites the whole record on Google; Google
 * answers with the record's new updateSequence (see SyncWriterService).
 */
export class BaseRepository<T extends SyncEnvelope> {
  constructor(
    protected readonly table: Table<T, string>,
    protected readonly sheet: SequencedSheet,
  ) {}

  async getById(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  async list(): Promise<T[]> {
    return this.table.filter((r) => !r.deletedAt).toArray();
  }

  async create(entity: T): Promise<T> {
    await this.table.add(entity);
    await this.upload(entity);
    return entity;
  }

  /** A default the app seeds on every device: goes to Google only if Google doesn't have it (never overwriting another device's edit). */
  async createDefault(entity: T): Promise<T> {
    await this.table.add(entity);
    await this.upload(entity, true);
    return entity;
  }

  async update(id: string, patch: Partial<T>): Promise<void> {
    await this.table.where(':id').equals(id).modify((record: T) => {
      Object.assign(record, patch);
      record.updatedAt = new Date().toISOString();
      record.updatedByDeviceId = currentDeviceId();
    });
    const record = await this.table.get(id);
    if (record) await this.upload(record);
  }

  /** Soft-delete: only sets deletedAt, so other devices learn about it on their next pull. */
  async softDelete(id: string): Promise<void> {
    await this.update(id, { deletedAt: new Date().toISOString() } as Partial<T>);
  }

  /** Queues the record's current state for Google (a no-op with sync off). */
  protected async upload(record: T, onlyIfAbsent = false): Promise<void> {
    await enqueue({ op: 'WRITE_RECORD', sheet: this.sheet, record: record as unknown as JsonRecord, onlyIfAbsent });
  }
}
