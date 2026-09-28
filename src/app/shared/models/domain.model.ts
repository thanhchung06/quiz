import { SyncEnvelope } from './sync.model';

// ---------------------------------------------------------------------------
// Profile (data-model.md §1)
// ---------------------------------------------------------------------------

export type ProfileRole = 'child' | 'parent';

export interface Profile extends SyncEnvelope {
  role: ProfileRole;
  displayName: string;
  avatar: string;
  /**
   * The parent's password, stored as typed (plan §3.1: synced so the parent
   * can log in on any device). Children log in by picking their avatar and
   * never need one.
   */
  password: string;
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
  /** 0 = no pass rate: every try passes (see shared/scoring). Default 70 (FR-032). */
  passingPercent: number;
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
  /** A child may also play this exercise as practice, without it being assigned. */
  allowPractice?: boolean;
  /** Practice plays of this exercise earn points too (by the same rules as an assignment). */
  practiceEarnsPoints?: boolean;
}

/** 1-3 lifetime attempts, or 'unlimited' for no cap at all. See `Exercise.repeatLimit`. */
export type RepeatLimit = 1 | 2 | 3 | 'unlimited';

// ---------------------------------------------------------------------------
// Assignment (plan §3.2) — one list per child on Google
// ---------------------------------------------------------------------------

export interface Assignment {
  /** UUID made on the parent's device. */
  id: string;
  childId: string;
  exerciseId: string;
  /** The exercise as it was when assigned; editing or deleting the exercise later doesn't change it. Questions stay references into the bank. */
  exerciseSnapshot: Exercise;
  assignedAt: string;
  /** Not playable before this moment (absent = right away). */
  availableFrom?: string;
  /** Finishing after it still counts, flagged late. */
  deadline?: string;
  /** Tries started so far. */
  tries: number;
}

// ---------------------------------------------------------------------------
// PlaySession (plan §3.3) — what a child is doing right now, one per child
// ---------------------------------------------------------------------------

export type EndStatus = 'completed' | 'timeUp' | 'tryAgain' | 'abandoned';

export interface ExerciseSnapshot {
  title: string;
  timeLimitMinutes: number;
  lives: number | 'unlimited';
  /** 0 = no pass rate. */
  passingPercent: number;
}

/** One submitted (or timed-out) answer. */
export interface AnswerRecord {
  submittedAnswer: unknown;
  isCorrect: boolean;
  pointsEarned: number;
  submittedAt: string;
  /** The per-question timer ran out before an answer: counted wrong and cost a life. */
  timedOut?: boolean;
}

export interface SessionProgress {
  /** Position in itemOrder of the question on screen. */
  currentIndex: number;
  /** quizItemId -> answer. */
  answers: Record<string, AnswerRecord>;
  livesRemaining: number | 'unlimited';
  /** The clock only runs while the app is open, so time left is stored rather than a deadline. */
  timeLeftSeconds: number;
  /** Per-question cap of the current question, when it has one. */
  questionTimeLeftSeconds?: number;
  score: number;
  updatedAt: string;
}

export interface PlaySession {
  /** UUID made when the child started. */
  id: string;
  childId: string;
  exerciseId: string;
  /** Absent for practice. */
  assignmentId?: string;
  exerciseSnapshot: ExerciseSnapshot;
  /** Practice earns points only when the exercise says so; an assignment always can. */
  earnsPoints: boolean;
  tryNumber: number;
  startedAt: string;
  /** QuizItem ids in play order. */
  itemOrder: string[];
  /** Frozen copy of every question of this play (random groups already picked). */
  itemSnapshots: Record<string, QuizItem>;
  /** quizItemId -> displayed choice order. */
  answerOrderByItem: Record<string, string[]>;
  /** quizItemId -> seconds, only for questions with their own cap. */
  perQuestionSeconds: Record<string, number>;
  progress: SessionProgress;
}

// ---------------------------------------------------------------------------
// Result / HistoryResult (plan §3.4) and PointUsage (plan §3.6)
// ---------------------------------------------------------------------------

/** The numbers every finished try records, in both Result and HistoryResult. */
export interface ResultSummary {
  /** UUID made on the child's device when the try ended. */
  id: string;
  childId: string;
  exerciseId: string;
  assignmentId?: string;
  exerciseTitle: string;
  tryNumber: number;
  status: EndStatus;
  startedAt: string;
  attemptedAt: string;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  /** Points of the correct answers. */
  score: number;
  stars: number;
  bonus: number;
  /** score + bonus. */
  pointsEarned: number;
  /** Passed (and allowed to earn): these points count toward the child's total. */
  counted: boolean;
  /** Finished after the assignment's deadline. */
  late: boolean;
}

/** Full detail of a finished try, for review — the last RESULTS_KEPT per child are kept. */
export interface PlayResult extends ResultSummary {
  exerciseSnapshot: ExerciseSnapshot;
  itemOrder: string[];
  itemSnapshots: Record<string, QuizItem>;
  answerOrderByItem: Record<string, string[]>;
  answers: Record<string, AnswerRecord>;
  livesRemaining: number | 'unlimited';
}

/** Short record of a finished try, kept forever (append-only). */
export type HistoryResult = ResultSummary;

/** A parent trading a child's points for something (append-only). */
export interface PointUsage {
  id: string;
  childId: string;
  points: number;
  note?: string;
  usedAt: string;
}

// ---------------------------------------------------------------------------
// AppSettings (data-model.md §9, local only)
// ---------------------------------------------------------------------------

export interface AppSettings {
  id: 'singleton';
  timerVisibility: boolean;
  audioEnabled: boolean;
  reducedMotion: boolean;
  feedbackDelayMs: number;
  /** meta/quizVersion when this device last brought its quiz bank up to date (specs/003 §3). */
  quizVersion?: number;
  /** Newest question/category updatedAt (server time, ms) this device has — the next pull asks for newer ones. */
  quizPulledAt?: number;
  backupMetadata: { lastExportAt?: string; lastImportAt?: string };
  /** Set once the curriculum's default categories have been created, so a category the parent deletes is not re-added. */
  defaultCategoriesSeeded?: boolean;
}
