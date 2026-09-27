import { SyncEnvelope } from './sync.model';

// ---------------------------------------------------------------------------
// Profile (data-model.md §1)
// ---------------------------------------------------------------------------

export type ProfileRole = 'child' | 'parent';

export interface Profile extends SyncEnvelope {
  role: ProfileRole;
  displayName: string;
  avatar: string;
  /** Hashed PIN (child) or hashed password (parent). Never synced/exported. */
  credentialHash: string;
  grade?: number; // 1-5, informational only (FR-033); parent has none
  preferences: {
    audioEnabled: boolean;
    reducedMotion: boolean;
    feedbackDelayMs: number;
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Category (data-model.md §2)
// ---------------------------------------------------------------------------

export type Subject = 'math' | 'language';
export type CategorySubject = Subject | 'both';

export interface Category extends SyncEnvelope {
  name: string;
  normalizedName: string;
  subject: CategorySubject;
  description?: string;
  color?: string;
  icon?: string;
  status: 'active' | 'archived';
}

// ---------------------------------------------------------------------------
// QuizItem (data-model.md §3)
// ---------------------------------------------------------------------------

export type QuizItemType =
  | 'single-choice'
  | 'short-text'
  | 'number'
  | 'multiple-choice'
  | 'true-false'
  | 'match-pairs';

/** 1=Dễ (easy) .. 5=Chuyên gia (expert); defaults to 2 (Trung bình) wherever unset (FR-017, amended 2026-09-18 — was 1-3). See DIFFICULTY_LABELS in shared/difficulty.ts for display names. */
export type QuizDifficulty = 1 | 2 | 3 | 4 | 5;

export interface Choice {
  id: string;
  /** May be empty when the choice is just a picture. */
  text: string;
  /** Optional picture for this answer option — same URL forms as QuizItem.media.imageRef. */
  imageRef?: string;
}

export type AnswerRule =
  | { kind: 'choice'; correctChoiceIds: string[] }
  | { kind: 'text'; acceptedAnswer: string; caseSensitive: boolean; punctuationSensitive: boolean }
  | { kind: 'number'; acceptedValue?: number; min?: number; max?: number }
  | { kind: 'boolean'; correctValue: boolean }
  | { kind: 'pairs'; pairs: Array<{ leftId: string; rightId: string }> };

/**
 * Shared reading passage / problem statement for a cluster of sub-questions
 * (FR-073–075) — e.g. "read this text, answer these 3 questions" or "given
 * this problem, answer these 2 sub-questions". Deliberately denormalized
 * (copied identically onto every sub-question's QuizItem, keyed by the
 * shared `passageId`) rather than a separate synced entity/table: each
 * sub-question is already a full, independently-scored QuizItem, and
 * `Attempt.itemSnapshots` already freezes the complete QuizItem per id at
 * attempt start, so this denormalization gets snapshot-immutability
 * (FR-020) for free with no changes to the attempt/sync machinery.
 * `PassageEditorRepository`-style writes update the `title`/`text` copy on
 * every sibling QuizItem together so they never drift apart.
 */
export interface PassageContext {
  passageId: string;
  title: string;
  text: string;
  /** Optional illustration for the shared passage — see QuizItem.media.imageRef for the accepted URL forms. */
  imageUrl?: string;
  order: number; // 1-based position of this sub-question within the passage
  total: number; // total sub-question count in the passage
}

export interface QuizItem extends SyncEnvelope {
  externalId?: string;
  subject: Subject;
  grade: number; // 1-5, informational (FR-033)
  type: QuizItemType;
  prompt: string;
  choices?: Choice[];
  answerRule: AnswerRule;
  explanation?: string;
  /** `imageRef` is an illustration shown with the prompt: an absolute http(s)/data URL, or a path/filename under the app's `assets/images/` folder (resolved by shared/quiz-image). */
  media?: { imageRef?: string; audioRef?: string };
  tags: string[];
  difficulty: QuizDifficulty;
  points: number; // default 10 (FR-039)
  /** Every quiz item belongs to exactly one category, always (FR-022, amended 2026-09-18 — import now falls back to a default category rather than silently dropping an item with none specified). */
  categoryId: string;
  shuffleChoices: boolean;
  reviewStatus: 'approved' | 'needsReview';
  status: 'active' | 'archived';
  importBatchId?: string;
  /** Set only for a sub-question that belongs to a shared passage/problem group. */
  passage?: PassageContext;
}

// ---------------------------------------------------------------------------
// Exercise + ExerciseItem (data-model.md §4/§4a)
// ---------------------------------------------------------------------------

export type RandomMode = 'fullyRandom' | 'balanced' | 'practiceWeakAreas';

export interface RandomGroupConfig {
  count: number;
  subject?: Subject;
  grade?: number;
  categoryIds: string[];
  tags: string[];
  difficultyMin: QuizDifficulty;
  difficultyMax: QuizDifficulty;
  allowedTypes: QuizItemType[];
  avoidRecentUse: boolean;
  preferWeakAreas: boolean;
  mode: RandomMode;
  /** Only used when the owning Exercise's questionTimingMode is 'custom'; applies to every item drawn from this group. */
  timeLimitSeconds?: number;
  /** Overrides every drawn item's own default points for this group, when set (added 2026-09-18) — mirrors the fixed-item `points` override; never mutates the underlying QuizItem. */
  pointsOverride?: number;
}

export type ExerciseItem =
  | {
      id: string;
      position: number;
      kind: 'fixed';
      quizItemId: string;
      timeLimitSeconds?: number;
      /** Overrides the QuizItem's own `points` for this exercise only, when set. */
      points?: number;
    }
  | { id: string; position: number; kind: 'randomGroup'; randomGroup: RandomGroupConfig };

/**
 * Per-question timing, independent of the exercise's own overall
 * `timeLimitMinutes` (which always keeps applying as a hard backstop
 * regardless of this mode):
 * - `none`: no per-question cap — a child may spend as long as they want on
 *   any one question, same as the app's original behavior.
 * - `distribute`: the exercise's overall time budget is split evenly across
 *   every resolved question.
 * - `uniform`: every question gets the same cap, the exercise's
 *   `defaultQuestionSeconds`.
 * - `custom`: each item's own `timeLimitSeconds` (on the ExerciseItem, or on
 *   a random group's RandomGroupConfig); an item left unset gets the
 *   exercise's `defaultQuestionSeconds`, or no cap of its own if that is unset.
 */
export type QuestionTimingMode = 'none' | 'distribute' | 'uniform' | 'custom';

export interface Exercise extends SyncEnvelope {
  title: string;
  subject: Subject | 'mixed';
  grade: number;
  items: ExerciseItem[];
  timeLimitMinutes: number; // 1-60 (FR-032)
  /** 3-10, or 'unlimited' for no life limit at all. Configured per exercise at creation. */
  lives: number | 'unlimited';
  passingPercent: number; // default 70 (FR-032)
  orderMode: 'fixed' | 'randomized';
  /** No longer enforced — every exercise is strictly one-attempt-per-child now, kept only so old records keep a value. */
  replayAllowed: boolean;
  correctionReviewEnabled: boolean;
  repeatSameQuestions: boolean;
  /** Defaults to 'none' when absent (older records predate this field) — see QuestionTimingMode. */
  questionTimingMode: QuestionTimingMode;
  /** Seconds per question for the 'uniform' mode, and the fallback for unset items in 'custom'. */
  defaultQuestionSeconds?: number;
  /** Points per question in this exercise when an item has no override of its own; absent = each question's own points. */
  defaultQuestionPoints?: number;
  status: 'active' | 'archived';
  /**
   * A daily exercise (added 2026-09-18) draws its questions fresh at random
   * every time a child starts it, rather than once and for all — so `items`
   * MUST only ever contain `randomGroup` entries, never a `fixed` one (the
   * parent picks a category/difficulty/count/time/points "slot" instead of
   * a specific quiz — see `QuizPickerComponent`'s `dailyMode`). It is also
   * exempt from the normal one-attempt-per-child rule (FR-015/FR-081): a
   * child may start a fresh attempt once per local calendar day, and each
   * day's attempt gets its own independent random draw. Defaults to false
   * (a normal, one-time exercise) wherever absent.
   */
  isDaily?: boolean;
  /**
   * How many times, ever (lifetime, not per-day), a child may complete this
   * exercise before it's considered exhausted — defaults to 1 wherever
   * absent (older records predate this field), which is exactly today's
   * hardcoded "one attempt forever" rule. Independent of `isDaily`, whose
   * own once-per-calendar-day exemption (see AttemptLifecycleService) is
   * untouched by this field.
   */
  repeatLimit?: RepeatLimit;
}

/** 1-3 lifetime attempts, or 'unlimited' for no cap at all. See `Exercise.repeatLimit`. */
export type RepeatLimit = 1 | 2 | 3 | 'unlimited';

// ---------------------------------------------------------------------------
// Assignment + Rotation (data-model.md §5/§5a)
// ---------------------------------------------------------------------------

export interface Assignment extends SyncEnvelope {
  profileId: string;
  exerciseId: string;
  /** YYYY-MM-DD, local calendar date. Absent for a one-time (day-less) assignment — see AssignmentRepository.assignOnetime. */
  assignedDate?: string;
  /** Only meaningful when `assignedDate` is set (single per-date slot winner); always false for a one-time assignment. */
  isPrimary: boolean;
  replayAllowed?: boolean;
}

export interface Rotation extends SyncEnvelope {
  profileId: string;
  orderedExerciseIds: string[];
  cursor: number;
}

// ---------------------------------------------------------------------------
// Attempt + AnswerResult (data-model.md §6/§7)
// ---------------------------------------------------------------------------

export type AttemptStatus = 'inProgress' | 'completed' | 'timeUp' | 'tryAgain' | 'abandoned';

export interface ExerciseSnapshot {
  title: string;
  timeLimitMinutes: number;
  lives: number | 'unlimited';
  passingPercent: number;
}

export interface Attempt extends SyncEnvelope {
  profileId: string;
  exerciseId: string;
  assignmentId?: string;
  exerciseSnapshot: ExerciseSnapshot;
  randomSeed: number;
  resolvedItemOrder: string[]; // QuizItem ids in play order
  answerOrderByItem: Record<string, string[]>; // quizItemId -> displayed choiceId order
  /**
   * Frozen copy of every resolved QuizItem, captured at attempt start.
   * Play and resume ALWAYS render from here, never from the live
   * QuizItemRepository, so a later edit/archive/delete never changes an
   * active attempt (FR-020, FR-034, edge cases).
   */
  itemSnapshots: Record<string, QuizItem>;
  isScored: boolean;
  startedAt: string;
  /** Overall exercise deadline — always enforced as a hard backstop, in every questionTimingMode. */
  deadlineAt: string;
  /** quizItemId -> seconds allotted, only for ids with a per-question cap (see QuestionTimingMode). Empty/absent when the exercise's mode is 'none'. */
  perQuestionSeconds?: Record<string, number>;
  /** Recomputed each time the child moves to a new question that has a per-question cap; absent when the current question has none. */
  currentQuestionDeadlineAt?: string;
  completedAt?: string;
  status: AttemptStatus;
  livesRemaining: number | 'unlimited';
  score: number;
  accuracy: number; // 0-1
  passed: boolean;
  starsAwarded: number; // 0-3
  ownerDeviceId: string;
}

export interface QuizItemSnapshot {
  prompt: string;
  type: QuizItemType;
  choices?: Choice[];
  correctAnswer: unknown;
  explanation?: string;
  passage?: PassageContext;
}

export interface AnswerResult extends SyncEnvelope {
  attemptId: string;
  /** Links back to the original QuizItem for aggregation (FR-048); display always uses quizItemSnapshot. */
  quizItemId: string;
  quizItemSnapshot: QuizItemSnapshot;
  submittedAnswer: unknown;
  isCorrect: boolean;
  pointsEarned: number;
  responseSeconds: number;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Reward (data-model.md §8)
// ---------------------------------------------------------------------------

export type RewardType = 'star' | 'badge' | 'streakMilestone' | 'personalBest' | 'unlock';

export interface Reward extends SyncEnvelope {
  profileId: string;
  type: RewardType;
  key: string;
  earnedAt: string;
  sourceAttemptId?: string;
}

// ---------------------------------------------------------------------------
// PointRedemption — parent-recorded real-world point spend
// ---------------------------------------------------------------------------

/**
 * One append-only record of a parent trading a child's earned points for a
 * real-world item/privilege (never edited after write, same as AnswerResult/
 * Reward). A child's spendable point balance is always computed, never
 * stored: sum of every Attempt.score for that profile, minus the sum of
 * every PointRedemption.points for that profile.
 */
export interface PointRedemption extends SyncEnvelope {
  profileId: string;
  points: number; // positive — points deducted
  note?: string; // what was traded, e.g. "Đổi đồ chơi"
  redeemedAt: string;
}

// ---------------------------------------------------------------------------
// AppSettings (data-model.md §9, local only)
// ---------------------------------------------------------------------------

export type StorageMode = 'localOnly' | 'manualSync' | 'automaticSync';

export interface AppSettings {
  id: 'singleton';
  schemaVersion: number;
  timerVisibility: boolean;
  audioEnabled: boolean;
  reducedMotion: boolean;
  feedbackDelayMs: number;
  /** @deprecated Replaced by autoSyncEnabled/autoSyncQuestions (data is always stored locally); only read to carry an older setting over. */
  storageMode: StorageMode;
  /** Sync automatically (app open/close, finished exercise, assigning work). */
  autoSyncEnabled?: boolean;
  /** Automatic sync also includes questions and categories (off by default — they normally sync from "Đồng bộ ngay"). */
  autoSyncQuestions?: boolean;
  /** With autoSyncQuestions: only take questions/categories this device doesn't have yet — never updates to existing ones. */
  autoSyncAddedQuestionsOnly?: boolean;
  backupMetadata: { lastExportAt?: string; lastImportAt?: string };
  /** Set once the curriculum's default categories have been created, so a category the parent deletes is not re-added. */
  defaultCategoriesSeeded?: boolean;
  /** Google Sheet revision this device has received other devices' changes up to (sync pull). */
  lastPulledRevision?: number;
  /** Same, for the question scope (QuizItem + Category), which only syncs from its own button. */
  lastPulledQuestionsRevision?: number;
}

// ---------------------------------------------------------------------------
// SyncTransaction (data-model.md §10)
// ---------------------------------------------------------------------------

export interface SyncTransaction {
  syncId: string;
  deviceId: string;
  status: 'started' | 'committed' | 'failed' | 'conflict';
  startedAt: string;
  completedAt?: string;
  recordCount: number;
  changeGroupIds: string[];
  error?: string;
  commitSequence?: number;
}

// ---------------------------------------------------------------------------
// DeletedRecord (data-model.md §11)
// ---------------------------------------------------------------------------

export interface DeletedRecord {
  id: string; // `${entityType}:${entityId}` composite key
  entityType: string;
  entityId: string;
  version: number;
  deletedAt: string;
  updatedByDeviceId: string;
}
