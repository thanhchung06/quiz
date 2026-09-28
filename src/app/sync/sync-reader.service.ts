import { Injectable, signal } from '@angular/core';
import { Table } from 'dexie';
import { db } from '../data/db';
import { Assignment, PlaySession, Profile } from '../shared/models/domain.model';
import { JsonRecord, ReadSpec, RESULT_CIRCLE_SIZE, SequencedSheet } from './protocol';
import { sendRead } from './sync-transport';

type AnyTable = Table<Record<string, unknown> & { id: string }, string>;

const TABLE_OF: Record<SequencedSheet, 'profiles' | 'categories' | 'quizItems' | 'exercises'> = {
  Profile: 'profiles',
  Category: 'categories',
  QuizItem: 'quizItems',
  Exercise: 'exercises',
};

export interface PullOptions {
  /** Include Category + QuizItem. */
  questions: boolean;
  /** With questions: skip those already on this device. */
  addedQuestionsOnly: boolean;
  /** Include Exercise. */
  exercises: boolean;
  /**
   * "Đồng bộ ngay" (Google → máy này): read everything from the start instead
   * of after the local maximum, and remove local records Google doesn't have
   * (never profiles; with addedQuestionsOnly, never questions/categories).
   */
  mirror?: boolean;
}

/**
 * Pulls from Google into the local database (plan §3, §5). What comes down
 * overwrites the local copy. Incremental by sheet: updateSequence above the
 * local maximum (Profile is read whole), rows after the last one read
 * (HistoryResult, PointUsage), result ids after the last one (Result); the
 * per-child sheets (Assignment, Session) are read whole and replace the
 * local ones.
 */
@Injectable({ providedIn: 'root' })
export class SyncReaderService {
  private readonly _received = signal(0);
  private readonly _removed = signal(0);
  /** Records received / removed locally by the running (or last) pull. */
  readonly received = this._received.asReadonly();
  readonly removed = this._removed.asReadonly();

  async pull(options: PullOptions): Promise<void> {
    this._received.set(0);
    this._removed.set(0);
    await this.pullProfiles();
    if (options.questions) {
      await this.pullSequenced('Category', options.mirror, options.addedQuestionsOnly);
      await this.pullSequenced('QuizItem', options.mirror, options.addedQuestionsOnly);
    }
    if (options.exercises) await this.pullSequenced('Exercise', options.mirror, false);
    await this.pullAssignments();
    await this.pullSessions();
    await this.pullHistoryAndUsage(options.mirror);
    await this.pullResults(options.mirror);
  }

  /** Google's profiles overwrite the local ones (with their password and total points); a profile only here stays. */
  async pullProfiles(): Promise<void> {
    const records = await this.readAll({ mode: 'ALL', sheet: 'Profile' });
    await db.profiles.bulkPut(records as unknown as Profile[]);
    this.count(records.length);
  }

  /** HistoryResult and PointUsage after the last row this device has (or everything, mirroring). */
  async pullHistoryAndUsage(mirror = false): Promise<void> {
    for (const [sheet, table] of [
      ['HistoryResult', db.historyResults],
      ['PointUsage', db.pointUsages],
    ] as const) {
      const after = mirror ? 0 : ((await (table as unknown as AnyTable).orderBy('row').last())?.['row'] as number | undefined) ?? 0;
      const records = await this.readAll({ mode: 'ROWS_AFTER', sheet, after });
      if (mirror) await this.removeMissing(table as unknown as AnyTable, records);
      await (table as unknown as AnyTable).bulkPut(records);
      this.count(records.length);
    }
  }

  /** Records by id — e.g. the questions an exercise needs that this device doesn't have. */
  async fetchByIds(sheet: SequencedSheet, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const records = await this.readAll({ mode: 'BY_ID', sheet, ids });
    await (db[TABLE_OF[sheet]] as unknown as AnyTable).bulkPut(records);
    return records.length;
  }

  private async pullSequenced(sheet: SequencedSheet, mirror = false, addedOnly = false): Promise<void> {
    const table = db[TABLE_OF[sheet]] as unknown as AnyTable;
    const after = mirror ? 0 : ((await table.orderBy('updateSequence').last())?.['updateSequence'] as number | undefined) ?? 0;
    let records = await this.readAll({ mode: 'SEQUENCE_AFTER', sheet, after });
    if (addedOnly) {
      const local = new Set(await table.toCollection().primaryKeys());
      // A new record that is already deleted on Google has nothing to add.
      records = records.filter((r) => !local.has(r.id) && !r['deletedAt']);
    } else if (mirror) {
      await this.removeMissing(table, records);
    }
    await table.bulkPut(records);
    this.count(records.length);
  }

  /** Every child's list, as Google has it now. */
  private async pullAssignments(): Promise<void> {
    const rows = await this.readAll({ mode: 'ALL', sheet: 'Assignment' });
    const assignments = rows.flatMap((row) =>
      ((row['assignments'] as Assignment[] | undefined) ?? []).map((a) => ({ ...a, childId: row.id })),
    );
    await db.transaction('rw', db.assignments, () => db.assignments.clear().then(() => db.assignments.bulkPut(assignments)));
    this.count(assignments.length);
  }

  /** Ongoing exercises: whatever a child was doing on any device continues here. */
  private async pullSessions(): Promise<void> {
    const sessions = (await this.readAll({ mode: 'ALL', sheet: 'Session' })) as unknown as PlaySession[];
    await db.transaction('rw', db.sessions, () => db.sessions.clear().then(() => db.sessions.bulkPut(sessions)));
    this.count(sessions.length);
  }

  /** Results after the last id this device has, keeping the same circle as Google. */
  private async pullResults(mirror = false): Promise<void> {
    const after = mirror ? 0 : ((await db.results.orderBy('resultId').last())?.resultId ?? 0);
    const records = await this.readAll({ mode: 'RESULTS_AFTER', after });
    if (mirror) await this.removeMissing(db.results as unknown as AnyTable, records);
    await (db.results as unknown as AnyTable).bulkPut(records);
    const newest = Math.max(0, ...records.map((r) => r['resultId'] as number));
    if (newest > 0) await db.results.where('resultId').belowOrEqual(newest - RESULT_CIRCLE_SIZE).delete();
    this.count(records.length);
  }

  /** Mirroring: local records Google doesn't have go away. */
  private async removeMissing(table: AnyTable, remote: JsonRecord[]): Promise<void> {
    const keep = new Set(remote.map((r) => r.id));
    const missing = (await table.toCollection().primaryKeys()).filter((id) => !keep.has(id));
    await table.bulkDelete(missing);
    this._removed.update((n) => n + missing.length);
  }

  /** Follows `truncated` answers until the whole selection has arrived. */
  private async readAll(spec: ReadSpec): Promise<JsonRecord[]> {
    const all: JsonRecord[] = [];
    let next: ReadSpec | undefined = spec;
    while (next) {
      const response = await sendRead(next);
      const records = response.records ?? [];
      all.push(...records);
      next = response.truncated && records.length > 0 ? continuation(next, records[records.length - 1]) : undefined;
    }
    return all;
  }

  private count(n: number): void {
    this._received.update((total) => total + n);
  }
}

function continuation(spec: ReadSpec, last: JsonRecord): ReadSpec | undefined {
  switch (spec.mode) {
    case 'SEQUENCE_AFTER':
      return { ...spec, after: last['updateSequence'] as number };
    case 'ROWS_AFTER':
      return { ...spec, after: last['row'] as number };
    case 'RESULTS_AFTER':
      return { ...spec, after: last['resultId'] as number };
    case 'BY_ID':
      return { ...spec, ids: spec.ids.slice(spec.ids.indexOf(last.id) + 1) };
    default:
      return undefined;
  }
}
