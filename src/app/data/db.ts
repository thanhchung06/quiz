import Dexie, { Table } from 'dexie';
import {
  Profile,
  Category,
  QuizItem,
  Exercise,
  Assignment,
  Rotation,
  Attempt,
  AnswerResult,
  Reward,
  PointRedemption,
  AppSettings,
  SyncTransaction,
  DeletedRecord,
} from '../shared/models/domain.model';

/**
 * Dexie schema for every entity in data-model.md. IndexedDB is the sole
 * operational, always-written-first store on each device (spec Assumptions).
 *
 * Index choices map directly to spec filters/queries:
 *  - QuizItem: subject/grade/type/difficulty/tag/status for FR-019, categoryId for lookups
 *  - Attempt: profileId+status for the "one inProgress attempt" rule (FR-063),
 *    profileId+startedAt for dashboard period filters (FR-046)
 *  - AnswerResult: attemptId for detail views (FR-047)
 *  - Assignment: profileId+assignedDate for "today's exercise" resolution (FR-007/033/069)
 */
export class QuizAppDb extends Dexie {
  profiles!: Table<Profile, string>;
  categories!: Table<Category, string>;
  quizItems!: Table<QuizItem, string>;
  exercises!: Table<Exercise, string>;
  assignments!: Table<Assignment, string>;
  rotations!: Table<Rotation, string>;
  attempts!: Table<Attempt, string>;
  answerResults!: Table<AnswerResult, string>;
  rewards!: Table<Reward, string>;
  pointRedemptions!: Table<PointRedemption, string>;
  appSettings!: Table<AppSettings, string>;
  syncTransactions!: Table<SyncTransaction, string>;
  deletedRecords!: Table<DeletedRecord, string>;

  constructor() {
    super('quiz-app-db');

    this.version(1).stores({
      profiles: 'id, role',
      categories: 'id, subject, normalizedName, status',
      quizItems: 'id, subject, grade, type, difficulty, status, reviewStatus, categoryId, *tags',
      exercises: 'id, subject, grade, status',
      assignments: 'id, profileId, assignedDate, [profileId+assignedDate]',
      rotations: 'id, profileId',
      attempts: 'id, profileId, status, [profileId+status], exerciseId, startedAt',
      answerResults: 'id, attemptId, submittedAt',
      rewards: 'id, profileId, type, earnedAt',
      appSettings: 'id',
      syncTransactions: 'syncId, status',
      deletedRecords: 'id, entityType, deletedAt',
    });

    // v2: PointRedemption (parent trades a child's earned points for a
    // real-world item) — only new/changed stores need listing; Dexie carries
    // every other v1 store forward unchanged.
    this.version(2).stores({
      pointRedemptions: 'id, profileId, redeemedAt',
    });

    // v3: syncStatus indexed on every synced table, so each save's upload
    // finds the few pending records without reading whole tables.
    this.version(3).stores({
      profiles: 'id, role, syncStatus',
      categories: 'id, subject, normalizedName, status, syncStatus',
      quizItems: 'id, subject, grade, type, difficulty, status, reviewStatus, categoryId, *tags, syncStatus',
      exercises: 'id, subject, grade, status, syncStatus',
      assignments: 'id, profileId, assignedDate, [profileId+assignedDate], syncStatus',
      rotations: 'id, profileId, syncStatus',
      attempts: 'id, profileId, status, [profileId+status], exerciseId, startedAt, syncStatus',
      answerResults: 'id, attemptId, submittedAt, syncStatus',
      rewards: 'id, profileId, type, earnedAt, syncStatus',
      pointRedemptions: 'id, profileId, redeemedAt, syncStatus',
    });
  }
}

export const db = new QuizAppDb();
