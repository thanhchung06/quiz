import { Table } from 'dexie';
import { SyncEnvelope } from '../../shared/models/sync.model';
import { increment, RemoteStore } from '../../remote/remote-store';
import { db } from '../db';
import { decode, encode, StoredNode } from '../../remote/record-codec';

export function currentDeviceId(): string {
  const key = 'quiz-app.deviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/** Questions/categories written to Firebase per request (one atomic update each). */
const WRITE_CHUNK = 200;

/**
 * The quiz bank (questions, categories — specs/003-firebase/plan.md §3):
 * cached on the device for fast search and play, and written through to
 * Firebase. Every write goes online first, together with a +1 on
 * meta/quizVersion (so other devices know to pull), then into the local cache.
 * When nobody else wrote in between, this device also takes the new version as
 * its own, so its next start doesn't download what it just wrote.
 */
export class QuizBankRepository<T extends SyncEnvelope> {
  constructor(
    protected readonly table: Table<T, string>,
    protected readonly remote: RemoteStore,
    protected readonly path: 'questions' | 'categories',
  ) {}

  async getById(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  async list(): Promise<T[]> {
    return this.table.filter((r) => !r.deletedAt).toArray();
  }

  async create(entity: T): Promise<T> {
    await this.write([entity]);
    return entity;
  }

  /** Many records (an import): written in atomic chunks. */
  async createMany(entities: T[]): Promise<void> {
    for (let i = 0; i < entities.length; i += WRITE_CHUNK) await this.write(entities.slice(i, i + WRITE_CHUNK));
  }

  /** A default the app seeds on every device: written only if Firebase doesn't have it yet. */
  async createDefault(entity: T): Promise<void> {
    const existing = decode<T>(await this.remote.get<StoredNode>(`${this.path}/${entity.id}`));
    if (existing) await this.table.put(existing);
    else await this.write([entity]);
  }

  async update(id: string, patch: Partial<T>): Promise<void> {
    const record = await this.table.get(id);
    if (!record) return;
    await this.write([{ ...record, ...patch, updatedAt: new Date().toISOString(), updatedByDeviceId: currentDeviceId() }]);
  }

  /** Several records changed together (one atomic update). */
  async updateMany(changes: Array<{ id: string; patch: Partial<T> }>): Promise<void> {
    const records: T[] = [];
    for (const { id, patch } of changes) {
      const record = await this.table.get(id);
      if (record) records.push({ ...record, ...patch, updatedAt: new Date().toISOString(), updatedByDeviceId: currentDeviceId() });
    }
    for (let i = 0; i < records.length; i += WRITE_CHUNK) await this.write(records.slice(i, i + WRITE_CHUNK));
  }

  /** Soft-delete: only sets deletedAt, so devices caching the bank learn about it on their next pull. */
  async softDelete(id: string): Promise<void> {
    await this.update(id, { deletedAt: new Date().toISOString() } as Partial<T>);
  }

  private buffer?: Map<string, T>;

  /**
   * Runs `work` with writes collected instead of sent one by one (an import of
   * many questions), then sends them in atomic chunks. Records written inside
   * are readable from the local copy only after it ends.
   */
  async inBatch<R>(work: () => Promise<R>): Promise<R> {
    if (this.buffer) return work();
    this.buffer = new Map();
    try {
      const result = await work();
      const records = [...this.buffer.values()];
      this.buffer = undefined;
      for (let i = 0; i < records.length; i += WRITE_CHUNK) await this.write(records.slice(i, i + WRITE_CHUNK));
      return result;
    } finally {
      this.buffer = undefined;
    }
  }

  protected async write(records: T[]): Promise<void> {
    if (records.length === 0) return;
    if (this.buffer) {
      for (const record of records) this.buffer.set(record.id, record);
      return;
    }
    const values: Record<string, unknown> = { 'meta/quizVersion': increment(1) };
    for (const record of records) values[`${this.path}/${record.id}`] = encode(record);
    const before = await this.remote.get<number>('meta/quizVersion');
    const settings = await db.appSettings.get('singleton');
    await this.remote.update(values);
    await this.table.bulkPut(records);

    // Up to date before, and the version moved by exactly this write → nothing new from anyone else:
    // take the new version, and this write's server time as the pull cursor.
    if (settings && before === settings.quizVersion) {
      const after = await this.remote.get<number>('meta/quizVersion');
      if (after === (before ?? 0) + 1) {
        const writtenAt = await this.remote.get<number>(`${this.path}/${records[0].id}/updatedAt`);
        await db.appSettings.update('singleton', {
          quizVersion: after,
          quizPulledAt: Math.max(settings.quizPulledAt ?? 0, writtenAt ?? 0),
        });
      }
    }
  }
}

/**
 * Records that live only in Firebase (exercises, profiles): read and written
 * online, nothing kept on the device.
 */
export class RemoteRecordRepository<T extends SyncEnvelope> {
  constructor(
    protected readonly remote: RemoteStore,
    protected readonly path: 'exercises' | 'profiles',
  ) {}

  /** Everything, deleted ones included. */
  async all(): Promise<T[]> {
    return (await this.remote.list<StoredNode>(this.path)).map((c) => decode<T>(c.value)).filter((r): r is T => !!r);
  }

  async list(): Promise<T[]> {
    return (await this.all()).filter((r) => !r.deletedAt);
  }

  async getById(id: string): Promise<T | undefined> {
    return decode<T>(await this.remote.get<StoredNode>(`${this.path}/${id}`));
  }

  async create(entity: T): Promise<T> {
    await this.remote.update({ [`${this.path}/${entity.id}`]: encode(entity) });
    return entity;
  }

  /** Fields kept beside the record (a profile's points): an edit leaves them as they are. */
  protected readonly storedApart: string[] = [];

  async update(id: string, patch: Partial<T>): Promise<void> {
    const record = await this.getById(id);
    if (!record) return;
    const edited: Record<string, unknown> = { ...record, ...patch, updatedByDeviceId: currentDeviceId() };
    for (const field of this.storedApart) delete edited[field];
    const node = encode(edited);
    await this.remote.update(Object.fromEntries(Object.entries(node).map(([field, value]) => [`${this.path}/${id}/${field}`, value])));
  }

  async softDelete(id: string): Promise<void> {
    await this.update(id, { deletedAt: new Date().toISOString() } as Partial<T>);
  }
}
