import Dexie, { Table } from 'dexie';
import {
  Profile,
  Category,
  QuizItem,
  Exercise,
  Assignment,
  PlaySession,
  PlayResult,
  HistoryResult,
  PointUsage,
  OutboxEntry,
  AppSettings,
} from '../shared/models/domain.model';
import { DATA_SCHEMA_VERSION } from '../sync/protocol';

/** The database of this layout; a different DATA_SCHEMA_VERSION means a different (fresh) database. */
export const DB_NAME = `quiz-app-v${DATA_SCHEMA_VERSION}`;
/** Databases of earlier layouts, deleted on start (plan §1: a version change drops all local data). */
const OLD_DB_NAMES = ['quiz-app-db', ...Array.from({ length: DATA_SCHEMA_VERSION - 1 }, (_, i) => `quiz-app-v${i + 1}`)];

/**
 * Dexie schema (specs/002-sync-data-redesign/plan.md §3). IndexedDB is the
 * always-written-first store on each device; with sync on, every write also
 * queues its operation in `outbox`.
 */
export class QuizAppDb extends Dexie {
  profiles!: Table<Profile, string>;
  categories!: Table<Category, string>;
  quizItems!: Table<QuizItem, string>;
  exercises!: Table<Exercise, string>;
  assignments!: Table<Assignment, string>;
  /** Keyed by childId: at most one ongoing exercise per child. */
  sessions!: Table<PlaySession, string>;
  results!: Table<PlayResult, string>;
  historyResults!: Table<HistoryResult, string>;
  pointUsages!: Table<PointUsage, string>;
  outbox!: Table<OutboxEntry, number>;
  appSettings!: Table<AppSettings, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      profiles: 'id, role',
      categories: 'id, subject, normalizedName, status, updateSequence',
      quizItems: 'id, subject, grade, type, difficulty, status, reviewStatus, categoryId, *tags, updateSequence',
      exercises: 'id, subject, grade, status, updateSequence',
      assignments: 'id, childId, exerciseId',
      sessions: 'childId, id',
      results: 'id, resultId, childId, assignmentId, exerciseId, attemptedAt',
      historyResults: 'id, row, childId, assignmentId, exerciseId, attemptedAt',
      pointUsages: 'id, row, childId, usedAt',
      outbox: '++seq',
      appSettings: 'id',
    });
  }
}

export const db = new QuizAppDb();

/** Deletes the databases of earlier layouts (their data was exported before upgrading, and can be imported). */
export async function dropOldDatabases(): Promise<void> {
  await Promise.all(OLD_DB_NAMES.map((name) => Dexie.delete(name).catch(() => undefined)));
}
