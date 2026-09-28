import {
  AnswerRecord,
  Assignment,
  Category,
  Exercise,
  HistoryResult,
  PlayResult,
  PlaySession,
  PointUsage,
  Profile,
  QuizItem,
  ResultSummary,
} from '../../../shared/models/domain.model';
import { RESULTS_KEPT } from '../../../data/repositories/result.repository';
import { outcomeOf } from '../../child-play/services/scoring.service';

/** Backup file (contracts/backup-format.md, format 2.0 — the redesigned entities). */
export interface BackupEnvelope {
  formatVersion: '2.0';
  exportedAt: string;
  exportedByDeviceId: string;
  data: BackupData;
}

export interface BackupData {
  profiles: Profile[];
  categories: Category[];
  quizItems: QuizItem[];
  exercises: Exercise[];
  assignments: Assignment[];
  sessions: PlaySession[];
  results: PlayResult[];
  historyResults: HistoryResult[];
  pointUsages: PointUsage[];
  /** childId → spendable points when exported (recomputed from the records on import anyway). */
  points?: Record<string, number>;
}

/** The pre-redesign file (format 1.0), as far as the conversion needs it. */
export interface LegacyBackupEnvelope {
  formatVersion: '1.0';
  data: {
    profiles?: Array<Record<string, unknown>>;
    categories?: Array<Record<string, unknown>>;
    quizItems?: Array<Record<string, unknown>>;
    exercises?: Array<Record<string, unknown>>;
    attempts?: LegacyAttempt[];
    answerResults?: LegacyAnswer[];
    pointRedemptions?: Array<{ id: string; profileId: string; points: number; note?: string; redeemedAt: string; deletedAt?: string }>;
  };
}

interface LegacyAttempt {
  id: string;
  profileId: string;
  exerciseId: string;
  assignmentId?: string;
  exerciseSnapshot: { title: string; timeLimitMinutes: number; lives: number | 'unlimited'; passingPercent: number };
  resolvedItemOrder: string[];
  answerOrderByItem?: Record<string, string[]>;
  itemSnapshots: Record<string, QuizItem>;
  startedAt: string;
  completedAt?: string;
  status: 'inProgress' | 'completed' | 'timeUp' | 'tryAgain' | 'abandoned';
  livesRemaining: number | 'unlimited';
  score: number;
  deletedAt?: string;
}

interface LegacyAnswer {
  attemptId: string;
  quizItemId: string;
  submittedAnswer: unknown;
  isCorrect: boolean;
  pointsEarned: number;
  submittedAt: string;
}

/** Fields of the old sync envelope that no longer exist. */
function withoutLegacyFields<T>(record: Record<string, unknown>): T {
  const { localVersion: _l, lastGoogleVersion: _g, syncStatus: _s, credentialHash: _c, ...rest } = record;
  return rest as T;
}

/**
 * Converts a pre-redesign backup (plan §6): profiles, categories, questions and
 * exercises as they are; finished attempts → HistoryResult (all) and Result
 * (the newest RESULTS_KEPT per child), with stars and points by the new rules;
 * point redemptions → PointUsage. Assignments, rotations and rewards are
 * dropped. A profile keeps the password this device has for it (old backups
 * never held one); total points are recomputed after import.
 */
export function convertLegacyBackup(legacy: LegacyBackupEnvelope, localPasswords: Map<string, string>): BackupData {
  const d = legacy.data;
  const profiles = (d.profiles ?? []).map((p) => ({
    ...withoutLegacyFields<Profile>(p),
    password: localPasswords.get(p['id'] as string) ?? '',
  }));

  const answersByAttempt = new Map<string, LegacyAnswer[]>();
  for (const answer of d.answerResults ?? []) {
    answersByAttempt.set(answer.attemptId, [...(answersByAttempt.get(answer.attemptId) ?? []), answer]);
  }

  const finished = (d.attempts ?? [])
    .filter((a) => a.status !== 'inProgress' && !a.deletedAt)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const triesSoFar = new Map<string, number>();
  const results: PlayResult[] = [];
  const historyResults: HistoryResult[] = [];
  for (const attempt of finished) {
    const key = `${attempt.profileId}|${attempt.exerciseId}`;
    const tryNumber = (triesSoFar.get(key) ?? 0) + 1;
    triesSoFar.set(key, tryNumber);

    const answers: Record<string, AnswerRecord> = {};
    for (const a of answersByAttempt.get(attempt.id) ?? []) {
      answers[a.quizItemId] = { submittedAnswer: a.submittedAnswer, isCorrect: a.isCorrect, pointsEarned: a.pointsEarned, submittedAt: a.submittedAt };
    }
    const answered = Object.values(answers);
    const correctCount = answered.filter((a) => a.isCorrect).length;
    const total = attempt.resolvedItemOrder.length;
    const status = attempt.status as ResultSummary['status'];
    const outcome = outcomeOf(attempt.score, correctCount, total, attempt.exerciseSnapshot.passingPercent ?? 0, status === 'abandoned');
    const summary: ResultSummary = {
      id: attempt.id,
      childId: attempt.profileId,
      exerciseId: attempt.exerciseId,
      assignmentId: attempt.assignmentId,
      exerciseTitle: attempt.exerciseSnapshot.title,
      tryNumber,
      status,
      startedAt: attempt.startedAt,
      attemptedAt: attempt.completedAt ?? attempt.startedAt,
      totalQuestions: total,
      correctCount,
      wrongCount: answered.length - correctCount,
      score: attempt.score,
      stars: outcome.stars,
      bonus: outcome.bonus,
      pointsEarned: outcome.pointsEarned,
      counted: outcome.passed,
      late: false,
    };
    historyResults.push({ ...summary });
    results.push({
      ...summary,
      exerciseSnapshot: attempt.exerciseSnapshot,
      itemOrder: attempt.resolvedItemOrder,
      itemSnapshots: attempt.itemSnapshots,
      answerOrderByItem: attempt.answerOrderByItem ?? {},
      answers,
      livesRemaining: attempt.livesRemaining,
    });
  }

  return {
    profiles,
    categories: (d.categories ?? []).map((c) => withoutLegacyFields<Category>(c)),
    quizItems: (d.quizItems ?? []).map((q) => withoutLegacyFields<QuizItem>(q)),
    exercises: (d.exercises ?? []).map((e) => withoutLegacyFields<Exercise>(e)),
    assignments: [],
    sessions: [],
    results: newestPerChild(results),
    historyResults,
    pointUsages: (d.pointRedemptions ?? [])
      .filter((r) => !r.deletedAt)
      .map((r) => ({ id: r.id, childId: r.profileId, points: r.points, note: r.note, usedAt: r.redeemedAt })),
  };
}

/** The newest RESULTS_KEPT results of each child (the input is oldest first). */
function newestPerChild(results: PlayResult[]): PlayResult[] {
  const byChild = new Map<string, PlayResult[]>();
  for (const r of results) byChild.set(r.childId, [...(byChild.get(r.childId) ?? []), r]);
  return [...byChild.values()].flatMap((list) => list.slice(-RESULTS_KEPT));
}
