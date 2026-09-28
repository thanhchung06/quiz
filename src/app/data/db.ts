import Dexie, { Table } from 'dexie';
import { Category, QuizItem, AppSettings } from '../shared/models/domain.model';

/** Bumped when the local layout changes: a different version is a fresh database (the old one is deleted). */
export const LOCAL_SCHEMA_VERSION = 3;
export const DB_NAME = `quiz-app-v${LOCAL_SCHEMA_VERSION}`;
const OLD_DB_NAMES = ['quiz-app-db', ...Array.from({ length: LOCAL_SCHEMA_VERSION - 1 }, (_, i) => `quiz-app-v${i + 1}`)];

/**
 * The device's own storage (specs/003-firebase/plan.md): only the quiz bank —
 * questions and categories, cached from Firebase — and this device's settings.
 * Everything else is read from and written to Firebase directly.
 */
export class QuizAppDb extends Dexie {
  categories!: Table<Category, string>;
  quizItems!: Table<QuizItem, string>;
  appSettings!: Table<AppSettings, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      categories: 'id, subject, normalizedName, status',
      quizItems: 'id, subject, grade, type, difficulty, status, reviewStatus, categoryId, *tags',
      appSettings: 'id',
    });
  }
}

export const db = new QuizAppDb();

/** Deletes the databases of earlier layouts (their data was exported before upgrading, and can be imported). */
export async function dropOldDatabases(): Promise<void> {
  await Promise.all(OLD_DB_NAMES.map((name) => Dexie.delete(name).catch(() => undefined)));
}
