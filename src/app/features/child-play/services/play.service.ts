import { Injectable, computed, signal } from '@angular/core';
import {
  Assignment,
  EndStatus,
  Exercise,
  HistoryResult,
  PlayResult,
  PlaySession,
  QuizItem,
  ResultSummary,
  SessionProgress,
} from '../../../shared/models/domain.model';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { PlaySessionRepository } from '../../../data/repositories/play-session.repository';
import { ResultRepository } from '../../../data/repositories/result.repository';
import { AttemptResolverService } from './attempt-resolver.service';
import { evaluateAnswer } from './answer-evaluator';
import { outcomeOf } from './scoring.service';

export type PlayStatus = 'inProgress' | EndStatus;

function localDateOf(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** How many tries an exercise allows (daily: one per day, never used up). */
export function triesAllowed(exercise: Exercise): number | 'unlimited' {
  if (exercise.isDaily) return 'unlimited';
  return exercise.repeatLimit ?? 1;
}

/**
 * One play of an exercise (plan §3.3–3.5, FR-009–016): the PlaySession is the
 * single record of what the child is doing — the frozen questions, the answers
 * so far, lives, score and time left — saved (and, with sync on, uploaded)
 * after every answer, so opening the app on any device goes straight back
 * into it. The clock only runs while the app is open: time left is stored,
 * and saved locally every few seconds (saveClock). When the play ends, a
 * Result and a HistoryResult are recorded, the session ends, and the
 * assignment is removed once the child can't try it again.
 */
@Injectable({ providedIn: 'root' })
export class PlayService {
  private readonly _session = signal<PlaySession | undefined>(undefined);
  private readonly _status = signal<PlayStatus>('inProgress');
  private readonly _result = signal<PlayResult | undefined>(undefined);
  private readonly _isEvaluating = signal(false);
  /** Wall-clock moments the running timers reach zero (ms), recomputed from the stored time left whenever a play is (re)loaded. */
  private readonly _deadlineAt = signal(0);
  private readonly _questionDeadlineAt = signal<number | undefined>(undefined);
  /** How the play ended while that end is being saved (or failed to save and waits for retryFinish); no more answers once set. */
  private readonly _ending = signal<EndStatus | undefined>(undefined);
  private readonly _endError = signal<string | undefined>(undefined);
  private endingSave?: Promise<void>;

  readonly session = this._session.asReadonly();
  readonly status = this._status.asReadonly();
  /** The finished play's result (or a past one being viewed). */
  readonly result = this._result.asReadonly();
  readonly isEvaluating = this._isEvaluating.asReadonly();
  readonly deadlineAt = this._deadlineAt.asReadonly();
  readonly questionDeadlineAt = this._questionDeadlineAt.asReadonly();
  readonly ending = this._ending.asReadonly();
  readonly endError = this._endError.asReadonly();

  readonly currentIndex = computed(() => this._session()?.progress.currentIndex ?? 0);
  readonly totalQuestions = computed(() => this._session()?.itemOrder.length ?? 0);
  readonly currentQuizItem = computed<QuizItem | undefined>(() => {
    const session = this._session();
    if (!session) return undefined;
    const id = session.itemOrder[session.progress.currentIndex];
    return id ? session.itemSnapshots[id] : undefined;
  });

  constructor(
    private readonly resolver: AttemptResolverService,
    private readonly sessions: PlaySessionRepository,
    private readonly assignments: AssignmentRepository,
    private readonly results: ResultRepository,
  ) {}

  // --- Can the child play? ------------------------------------------------------

  /** Tries left for an assignment ('unlimited', or 0 when used up / already played today for a daily one). */
  async triesLeft(assignment: Assignment): Promise<number | 'unlimited'> {
    const exercise = assignment.exerciseSnapshot;
    if (exercise.isDaily) {
      const today = localDateOf(new Date().toISOString());
      const last = await this.results.lastTryOfAssignment(assignment.childId, assignment.id);
      return last && localDateOf(last.attemptedAt) === today ? 0 : 'unlimited';
    }
    const allowed = triesAllowed(exercise);
    return allowed === 'unlimited' ? 'unlimited' : Math.max(0, allowed - assignment.tries);
  }

  isAvailable(assignment: Assignment, now = Date.now()): boolean {
    return !assignment.availableFrom || new Date(assignment.availableFrom).getTime() <= now;
  }

  // --- Start / resume -------------------------------------------------------------

  async startAssignment(childId: string, assignment: Assignment): Promise<void> {
    const tryNumber = assignment.tries + 1;
    await this.assignments.addTry(assignment);
    await this.start(childId, assignment.exerciseSnapshot, tryNumber, true, assignment.id);
  }

  async startPractice(childId: string, exercise: Exercise): Promise<void> {
    const last = await this.results.lastPracticeTry(childId, exercise.id);
    await this.start(childId, exercise, (last?.tryNumber ?? 0) + 1, !!exercise.practiceEarnsPoints);
  }

  private async start(childId: string, exercise: Exercise, tryNumber: number, earnsPoints: boolean, assignmentId?: string): Promise<void> {
    if (await this.sessions.forChild(childId)) throw new Error('This child already has an ongoing exercise — finish or give it up first.');
    const plan = await this.resolver.resolveNew(exercise, childId);
    const firstId = plan.resolvedItemOrder[0];
    const session: PlaySession = {
      id: crypto.randomUUID(),
      childId,
      exerciseId: exercise.id,
      assignmentId,
      exerciseSnapshot: {
        title: exercise.title,
        timeLimitMinutes: exercise.timeLimitMinutes,
        lives: exercise.lives,
        passingPercent: exercise.passingPercent ?? 0,
      },
      earnsPoints,
      tryNumber,
      startedAt: new Date().toISOString(),
      itemOrder: plan.resolvedItemOrder,
      itemSnapshots: Object.fromEntries(plan.itemsById),
      answerOrderByItem: plan.answerOrderByItem,
      perQuestionSeconds: plan.perQuestionSeconds,
      progress: {
        currentIndex: 0,
        answers: {},
        livesRemaining: exercise.lives,
        timeLeftSeconds: exercise.timeLimitMinutes * 60,
        questionTimeLeftSeconds: firstId ? plan.perQuestionSeconds[firstId] : undefined,
        score: 0,
        updatedAt: new Date().toISOString(),
      },
    };
    await this.sessions.start(session);
    this.load(session);
  }

  /** Picks up the child's ongoing exercise, if any (true when there is one to continue). */
  async resume(childId: string): Promise<boolean> {
    const session = await this.sessions.forChild(childId);
    if (!session) return false;
    this.load(session);
    const { progress } = session;
    if (progress.timeLeftSeconds <= 0) await this.finish('timeUp');
    else if (progress.livesRemaining !== 'unlimited' && progress.livesRemaining <= 0) await this.finish('tryAgain');
    else if (progress.currentIndex >= session.itemOrder.length) await this.finish('completed');
    return true;
  }

  /** Gives up the ongoing exercise (counts as a try, never passes). */
  async abandon(childId: string): Promise<void> {
    if (!(await this.resume(childId))) return;
    if (this._status() === 'inProgress') await this.finish(this._ending() ?? 'abandoned');
    const error = this._endError();
    if (error) throw new Error(error);
  }

  private load(session: PlaySession): void {
    this._session.set(session);
    this._status.set('inProgress');
    this._result.set(undefined);
    this._ending.set(undefined);
    this._endError.set(undefined);
    const now = Date.now();
    this._deadlineAt.set(now + session.progress.timeLeftSeconds * 1000);
    const q = session.progress.questionTimeLeftSeconds;
    this._questionDeadlineAt.set(q !== undefined ? now + q * 1000 : undefined);
  }

  /** Shows a past result (from the local circle). */
  viewResult(result: PlayResult): void {
    this._session.set(undefined);
    this._ending.set(undefined);
    this._endError.set(undefined);
    this._result.set(result);
    this._status.set(result.status);
  }

  // --- Clock --------------------------------------------------------------------

  /** Stores the running clock (the app calls it every few seconds and when hidden), so another device resumes with the right time left. */
  async saveClock(): Promise<void> {
    const session = this._session();
    // Once the play is ending the session is about to be removed: a late write must not bring it back.
    if (!session || this._status() !== 'inProgress' || this._ending()) return;
    await this.sessions.saveProgress(session, this.withClock(session.progress));
  }

  private withClock(progress: SessionProgress): SessionProgress {
    const now = Date.now();
    const q = this._questionDeadlineAt();
    return {
      ...progress,
      timeLeftSeconds: Math.max(0, Math.round((this._deadlineAt() - now) / 1000)),
      questionTimeLeftSeconds: q !== undefined ? Math.max(0, Math.round((q - now) / 1000)) : undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  // --- Answers ------------------------------------------------------------------

  /** Records the answer to the current question and moves on (or ends the play). */
  async submitAnswer(rawAnswer: unknown): Promise<boolean> {
    if (this._isEvaluating()) return false;
    const session = this._session();
    const item = this.currentQuizItem();
    if (!session || !item || this._status() !== 'inProgress' || this._ending()) return false;
    if (Date.now() >= this._deadlineAt()) {
      // Too late: the time ran out before this answer, which isn't scored.
      await this.finish('timeUp');
      return false;
    }
    this._isEvaluating.set(true);
    try {
      const isCorrect = evaluateAnswer(item, rawAnswer);
      await this.recordAndAdvance(session, item, {
        submittedAnswer: rawAnswer,
        isCorrect,
        pointsEarned: isCorrect ? item.points : 0,
        submittedAt: new Date().toISOString(),
      });
      return true;
    } finally {
      this._isEvaluating.set(false);
    }
  }

  /** The current question's own timer ran out: counted wrong, costs a life, play moves on. */
  async expirePerQuestionTimeout(): Promise<void> {
    if (this._isEvaluating()) return;
    const session = this._session();
    const item = this.currentQuizItem();
    if (!session || !item || this._status() !== 'inProgress' || this._ending()) return;
    if (Date.now() >= this._deadlineAt()) return this.finish('timeUp');
    this._isEvaluating.set(true);
    try {
      await this.recordAndAdvance(session, item, {
        submittedAnswer: null,
        isCorrect: false,
        pointsEarned: 0,
        submittedAt: new Date().toISOString(),
        timedOut: true,
      });
    } finally {
      this._isEvaluating.set(false);
    }
  }

  /** The exercise's overall time ran out: ends as Time Up without scoring the unsubmitted response. */
  async expireDueToTimeout(): Promise<void> {
    if (this._status() !== 'inProgress' || !this._session() || this._ending()) return;
    await this.finish('timeUp');
  }

  private async recordAndAdvance(session: PlaySession, item: QuizItem, answer: PlaySession['progress']['answers'][string]): Promise<void> {
    const before = this.withClock(session.progress);
    const lives =
      answer.isCorrect || before.livesRemaining === 'unlimited' ? before.livesRemaining : Math.max(0, before.livesRemaining - 1);
    const nextIndex = before.currentIndex + 1;
    const nextId = session.itemOrder[nextIndex];
    const nextQuestionSeconds = nextId ? session.perQuestionSeconds[nextId] : undefined;
    const progress: SessionProgress = {
      ...before,
      answers: { ...before.answers, [item.id]: answer },
      currentIndex: nextIndex,
      livesRemaining: lives,
      score: before.score + answer.pointsEarned,
      questionTimeLeftSeconds: nextQuestionSeconds,
    };
    const updated = { ...session, progress };
    this._session.set(updated);
    this._questionDeadlineAt.set(nextQuestionSeconds !== undefined ? Date.now() + nextQuestionSeconds * 1000 : undefined);

    if (lives !== 'unlimited' && lives <= 0) {
      await this.finish('tryAgain');
    } else if (nextIndex >= session.itemOrder.length) {
      await this.finish('completed');
    } else {
      await this.sessions.saveProgress(updated, progress);
    }
  }

  // --- End ----------------------------------------------------------------------

  /** Saves the end again after it failed (the question screen offers this with the error). */
  async retryFinish(): Promise<void> {
    const status = this._ending();
    if (status && this._status() === 'inProgress') await this.finish(status);
  }

  /**
   * Ends the play once: answers and timers stop at once, and a second call
   * while saving waits for the same save. A failed save keeps the play
   * ending (endError says why) until retryFinish, never back to answering.
   */
  private finish(status: EndStatus): Promise<void> {
    if (this.endingSave) return this.endingSave;
    if (!this._session()) return Promise.resolve();
    this._ending.set(status);
    this._endError.set(undefined);
    this.endingSave = this.recordEnd(status)
      .catch((error: unknown) => this._endError.set(error instanceof Error ? error.message : String(error)))
      .finally(() => (this.endingSave = undefined));
    return this.endingSave;
  }

  private async recordEnd(status: EndStatus): Promise<void> {
    const session = this._session();
    if (!session) return;
    const progress = this.withClock(session.progress);
    const answers = Object.values(progress.answers);
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const total = session.itemOrder.length;
    const outcome = outcomeOf(progress.score, correctCount, total, session.exerciseSnapshot.passingPercent, status === 'abandoned');
    const assignment = session.assignmentId ? await this.assignments.getById(session.childId, session.assignmentId) : undefined;
    const now = new Date().toISOString();

    const summary: ResultSummary = {
      id: '', // the number the finish is stored under
      childId: session.childId,
      exerciseId: session.exerciseId,
      assignmentId: session.assignmentId,
      exerciseTitle: session.exerciseSnapshot.title,
      tryNumber: session.tryNumber,
      status,
      startedAt: session.startedAt,
      attemptedAt: now,
      totalQuestions: total,
      correctCount,
      wrongCount: answers.length - correctCount,
      score: progress.score,
      stars: outcome.stars,
      bonus: outcome.bonus,
      pointsEarned: outcome.pointsEarned,
      counted: outcome.passed && session.earnsPoints,
      late: !!assignment?.deadline && now > assignment.deadline,
    };
    const result: PlayResult = {
      ...summary,
      exerciseSnapshot: session.exerciseSnapshot,
      itemOrder: session.itemOrder,
      itemSnapshots: session.itemSnapshots,
      answerOrderByItem: session.answerOrderByItem,
      answers: progress.answers,
      livesRemaining: progress.livesRemaining,
    };
    const history: HistoryResult = { ...summary };

    // The child is done with the assignment once it passed or no tries are left (a daily one stays).
    let removeAssignment = false;
    if (assignment && !assignment.exerciseSnapshot.isDaily) {
      const allowed = triesAllowed(assignment.exerciseSnapshot);
      removeAssignment = outcome.passed || (allowed !== 'unlimited' && session.tryNumber >= allowed);
    }

    const stored = await this.results.recordFinish(result, history, session, removeAssignment);
    this._session.set({ ...session, progress });
    this._result.set(stored);
    this._status.set(status);
    this._ending.set(undefined);
  }
}
