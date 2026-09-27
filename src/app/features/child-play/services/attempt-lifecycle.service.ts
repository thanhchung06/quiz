import { Injectable, signal, computed } from '@angular/core';
import { Attempt, Exercise, QuizItem } from '../../../shared/models/domain.model';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { AnswerResultRepository } from '../../../data/repositories/answer-result.repository';
import { AttemptResolverService } from './attempt-resolver.service';
import { ScoringService, ScoringState } from './scoring.service';
import { evaluateAnswer } from './answer-evaluator';
import { RewardsEngineService, RewardsOutcome } from '../../rewards/services/rewards-engine.service';

function localDateOf(iso: string): string {
  const d = new Date(iso);
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

export interface FeedbackEvent {
  isCorrect: boolean;
  pointsEarned: number;
  livesRemaining: number | 'unlimited';
}

/**
 * Orchestrates one Attempt end-to-end (FR-009–016, FR-036, FR-038): starts
 * with the exercise's own configured lives (a number, or 'unlimited') and a
 * fixed deadline, persists progress after every answer, blocks changing a
 * submitted answer, and ends on completion/time-up/lives-lost. A normal
 * exercise allows a configurable lifetime number of attempts per child
 * (`Exercise.repeatLimit`, 1-3 or 'unlimited', defaulting to 1) —
 * `attemptsRemaining()` computes how many are left, and `start()` refuses
 * once it hits 0. A *daily* exercise (`Exercise.isDaily`, FR-091) is the one
 * exception, kept entirely separate from `repeatLimit`: it's one-attempt-per-
 * child-per-local-calendar-day instead, and `resolveNew()` already draws a
 * fresh random set on every `start()` call, so a new day's attempt is
 * naturally re-randomized with no extra logic needed for that part.
 *
 * Play and resume always render from `Attempt.itemSnapshots` — a frozen copy
 * captured at start — never from the live QuizItemRepository, so an edit or
 * archive to the bank while an attempt is active never changes what the
 * child sees or how it's scored (FR-020, FR-034, edge cases).
 */
@Injectable({ providedIn: 'root' })
export class AttemptLifecycleService {
  private readonly _attempt = signal<Attempt | undefined>(undefined);
  private readonly _currentIndex = signal(0);
  private readonly _scoring = signal<ScoringState>({ submittedCount: 0, correctCount: 0, score: 0, livesRemaining: 5 });
  private readonly _lastFeedback = signal<FeedbackEvent | undefined>(undefined);
  private readonly _isEvaluating = signal(false);
  private readonly _rewardsOutcome = signal<RewardsOutcome | undefined>(undefined);

  readonly attempt = this._attempt.asReadonly();
  readonly currentIndex = this._currentIndex.asReadonly();
  readonly lastFeedback = this._lastFeedback.asReadonly();
  readonly isEvaluating = this._isEvaluating.asReadonly();
  readonly rewardsOutcome = this._rewardsOutcome.asReadonly();

  readonly currentQuizItem = computed<QuizItem | undefined>(() => {
    const attempt = this._attempt();
    if (!attempt) return undefined;
    const id = attempt.resolvedItemOrder[this._currentIndex()];
    return id ? attempt.itemSnapshots[id] : undefined;
  });

  readonly totalQuestions = computed(() => this._attempt()?.resolvedItemOrder.length ?? 0);

  constructor(
    private readonly attempts: AttemptRepository,
    private readonly answerResults: AnswerResultRepository,
    private readonly resolver: AttemptResolverService,
    private readonly scoring: ScoringService,
    private readonly rewardsEngine: RewardsEngineService,
  ) {}

  /**
   * Starts a brand-new attempt. Refuses outright once `attemptsRemaining`
   * hits 0 for this (exercise, profile) — callers should check that (and
   * route to the past result via `findMostRecentCompletedAttempt` /
   * `findCompletedAttemptToday`) before ever reaching here, but this stays
   * as a hard backstop.
   */
  async start(exercise: Exercise, profileId: string, assignmentId?: string): Promise<Attempt> {
    const remaining = await this.attemptsRemaining(exercise, profileId);
    if (remaining === 0) {
      throw new Error(
        exercise.isDaily
          ? "This daily exercise was already completed by this profile today — it renews tomorrow."
          : 'This exercise has no attempts left for this profile.',
      );
    }

    const plan = await this.resolver.resolveNew(exercise, profileId);

    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + exercise.timeLimitMinutes * 60_000);
    const firstItemId = plan.resolvedItemOrder[0];
    const firstQuestionSeconds = firstItemId ? plan.perQuestionSeconds[firstItemId] : undefined;
    const currentQuestionDeadlineAt = firstQuestionSeconds
      ? new Date(startedAt.getTime() + firstQuestionSeconds * 1000).toISOString()
      : undefined;

    const attempt = await this.attempts.startAttempt({
      profileId,
      exerciseId: exercise.id,
      assignmentId,
      exerciseSnapshot: {
        title: exercise.title,
        timeLimitMinutes: exercise.timeLimitMinutes,
        lives: exercise.lives,
        passingPercent: exercise.passingPercent,
      },
      randomSeed: plan.randomSeed,
      resolvedItemOrder: plan.resolvedItemOrder,
      answerOrderByItem: plan.answerOrderByItem,
      itemSnapshots: Object.fromEntries(plan.itemsById),
      isScored: true,
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      perQuestionSeconds: plan.perQuestionSeconds,
      currentQuestionDeadlineAt,
    });

    this._attempt.set(attempt);
    this._currentIndex.set(0);
    this._scoring.set({ submittedCount: 0, correctCount: 0, score: 0, livesRemaining: exercise.lives });
    this._rewardsOutcome.set(undefined);
    return attempt;
  }

  /** The most recent finished (non-inProgress) attempt this profile has for this exercise, if any — its presence is what makes the exercise "already done". */
  async findMostRecentCompletedAttempt(exerciseId: string, profileId: string): Promise<Attempt | undefined> {
    const all = await this.attempts.listForProfile(profileId);
    return all
      .filter((a) => a.exerciseId === exerciseId && a.status !== 'inProgress')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  }

  /**
   * For daily exercises only: the most recent finished attempt, but only if
   * it was started on today's local calendar date — a completed attempt
   * from a prior day never blocks starting a fresh (re-randomized) one
   * today (FR-091). Returns undefined once a new day has begun, even if
   * yesterday's attempt is still the most recent one on record.
   */
  async findCompletedAttemptToday(exerciseId: string, profileId: string): Promise<Attempt | undefined> {
    const mostRecent = await this.findMostRecentCompletedAttempt(exerciseId, profileId);
    if (!mostRecent) return undefined;
    return localDateOf(mostRecent.startedAt) === localDateOf(new Date().toISOString()) ? mostRecent : undefined;
  }

  /** Total finished (non-inProgress) attempts this profile has for this exercise, ever. */
  async countCompletedAttempts(exerciseId: string, profileId: string): Promise<number> {
    const all = await this.attempts.listForProfile(profileId);
    return all.filter((a) => a.exerciseId === exerciseId && a.status !== 'inProgress').length;
  }

  /**
   * How many more times this profile may attempt this exercise: `'unlimited'`
   * for no cap, `0` once exhausted. An `isDaily` exercise keeps its own
   * separate once-per-calendar-day exemption, untouched by `repeatLimit`
   * (see class doc). Every other exercise is capped by `Exercise.repeatLimit`
   * as a lifetime total across all days (defaults to 1 wherever unset).
   */
  async attemptsRemaining(exercise: Exercise, profileId: string): Promise<number | 'unlimited'> {
    if (exercise.isDaily) {
      const doneToday = await this.findCompletedAttemptToday(exercise.id, profileId);
      return doneToday ? 0 : 1;
    }
    const repeatLimit = exercise.repeatLimit ?? 1;
    if (repeatLimit === 'unlimited') return 'unlimited';
    const completed = await this.countCompletedAttempts(exercise.id, profileId);
    return Math.max(0, repeatLimit - completed);
  }

  /** Hydrates the service's signals from an already-finished attempt so the result screen can display it (viewing a past result, not scoring a new one). */
  loadAttempt(attempt: Attempt): void {
    this._attempt.set(attempt);
    this._currentIndex.set(attempt.resolvedItemOrder.length);
    this._scoring.set({
      submittedCount: attempt.resolvedItemOrder.length,
      correctCount: 0,
      score: attempt.score,
      livesRemaining: attempt.livesRemaining,
    });
    this._rewardsOutcome.set(undefined);
  }

  /**
   * Resumes a stored in-progress attempt for this profile — only if this
   * device is the one that started it (FR-063). An attempt active on
   * another device is intentionally left alone here.
   */
  async resume(exercise: Exercise, profileId: string): Promise<Attempt | undefined> {
    const existing = await this.attempts.findInProgressOwnedByThisDevice(profileId);
    if (!existing || existing.exerciseId !== exercise.id) return undefined;

    const answered = await this.answerResults.listForAttempt(existing.id);

    this._attempt.set(existing);
    this._rewardsOutcome.set(undefined);
    this._currentIndex.set(answered.length);
    this._scoring.set({
      submittedCount: answered.length,
      correctCount: answered.filter((a) => a.isCorrect).length,
      score: existing.score,
      livesRemaining: existing.livesRemaining,
    });

    if (new Date(existing.deadlineAt).getTime() <= Date.now()) {
      await this.endAttempt('timeUp');
    }
    return existing;
  }

  async submitAnswer(rawAnswer: unknown): Promise<FeedbackEvent | undefined> {
    if (this._isEvaluating()) return undefined;
    const attempt = this._attempt();
    const item = this.currentQuizItem();
    if (!attempt || !item) return undefined;

    this._isEvaluating.set(true);
    try {
      const isCorrect = evaluateAnswer(item, rawAnswer);
      const pointsEarned = isCorrect ? item.points : 0;
      const next = this.scoring.applyAnswer(this._scoring(), isCorrect, item.points);
      this._scoring.set(next);

      await this.answerResults.append({
        attemptId: attempt.id,
        quizItemId: item.id,
        quizItemSnapshot: {
          prompt: item.prompt,
          type: item.type,
          choices: item.choices,
          correctAnswer: item.answerRule,
          explanation: item.explanation,
          passage: item.passage,
        },
        submittedAnswer: rawAnswer,
        isCorrect,
        pointsEarned,
        responseSeconds: 0,
        submittedAt: new Date().toISOString(),
      });

      await this.attempts.update(attempt.id, {
        score: next.score,
        livesRemaining: next.livesRemaining,
        accuracy: this.scoring.accuracy(next),
      });

      const feedback: FeedbackEvent = { isCorrect, pointsEarned, livesRemaining: next.livesRemaining };
      this._lastFeedback.set(feedback);

      if (this.scoring.outOfLives(next)) {
        await this.endAttempt('tryAgain');
      } else if (this._currentIndex() + 1 >= this.totalQuestions()) {
        await this.endAttempt('completed');
      }

      return feedback;
    } finally {
      this._isEvaluating.set(false);
    }
  }

  /**
   * Ends the attempt as Time Up without scoring whatever unsubmitted response
   * the child was in the middle of entering (edge case: not scored at time-zero).
   */
  async expireDueToTimeout(): Promise<void> {
    const attempt = this._attempt();
    if (!attempt || attempt.status !== 'inProgress') return;
    await this.endAttempt('timeUp');
  }

  advanceToNext(): void {
    const attempt = this._attempt();
    if (attempt?.status !== 'inProgress') return;
    this._currentIndex.update((i) => i + 1);
    this._lastFeedback.set(undefined);
    void this.applyQuestionDeadlineForCurrentItem(attempt);
  }

  /**
   * Ends the CURRENT question only (not the whole attempt) when its
   * per-question timer runs out: the question is left unanswered — same
   * "not counted toward accuracy" treatment as the overall-deadline timeout
   * (FR-040) — but unlike that overall timeout, a per-question timeout DOES
   * cost a life, the same as answering wrong, since the child had a fair
   * chance at this one question specifically and let it lapse. Play then
   * moves on to the next question, or to the result screen (as 'completed',
   * or 'tryAgain' if this was also the last life) if this was the last one.
   *
   * Reuses the submitAnswer reentrancy guard (_isEvaluating) and awaits the
   * ENTIRE mutation chain, including the next question's deadline write —
   * every state write here is a separate signal update, and the component's
   * `effect` watching `attempt()` re-invokes this same method on each one
   * while the old (already-expired) deadline is still in place; without the
   * guard, that reactive cascade calls this method several times concurrently
   * for a single expiry, costing multiple lives and skipping a question.
   */
  async expirePerQuestionTimeout(): Promise<void> {
    if (this._isEvaluating()) return;
    const attempt = this._attempt();
    if (!attempt || attempt.status !== 'inProgress') return;

    this._isEvaluating.set(true);
    try {
      const next = this.scoring.loseLife(this._scoring());
      this._scoring.set(next);
      await this.attempts.update(attempt.id, { livesRemaining: next.livesRemaining });
      this._attempt.update((a) => (a ? { ...a, livesRemaining: next.livesRemaining } : a));

      if (this.scoring.outOfLives(next)) {
        await this.endAttempt('tryAgain');
      } else if (this._currentIndex() + 1 >= this.totalQuestions()) {
        await this.endAttempt('completed');
      } else {
        this._currentIndex.update((i) => i + 1);
        this._lastFeedback.set(undefined);
        const updated = this._attempt();
        if (updated) await this.applyQuestionDeadlineForCurrentItem(updated);
      }
    } finally {
      this._isEvaluating.set(false);
    }
  }

  /** Recomputes and persists currentQuestionDeadlineAt for whichever item is current now (or clears it if that item has no per-question cap). */
  private async applyQuestionDeadlineForCurrentItem(attempt: Attempt): Promise<void> {
    const itemId = attempt.resolvedItemOrder[this._currentIndex()];
    const seconds = itemId ? attempt.perQuestionSeconds?.[itemId] : undefined;
    const currentQuestionDeadlineAt = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : undefined;

    await this.attempts.update(attempt.id, { currentQuestionDeadlineAt });
    this._attempt.update((a) => (a ? { ...a, currentQuestionDeadlineAt } : a));
  }

  private async endAttempt(status: 'completed' | 'timeUp' | 'tryAgain'): Promise<void> {
    const attempt = this._attempt();
    if (!attempt) return;
    const scoring = this._scoring();
    const passed =
      status === 'completed' &&
      this.scoring.passed(scoring, this.totalQuestions(), attempt.exerciseSnapshot.passingPercent);

    const completedAt = new Date().toISOString();
    await this.attempts.update(attempt.id, {
      status,
      completedAt,
      score: scoring.score,
      livesRemaining: scoring.livesRemaining,
      accuracy: this.scoring.accuracy(scoring),
      passed,
    });

    let finished: Attempt = { ...attempt, status, passed, completedAt, score: scoring.score, livesRemaining: scoring.livesRemaining, accuracy: this.scoring.accuracy(scoring) };

    if (finished.isScored && status === 'completed') {
      const outcome = await this.rewardsEngine.processCompletedAttempt(finished);
      await this.attempts.update(attempt.id, { starsAwarded: outcome.stars });
      finished = { ...finished, starsAwarded: outcome.stars };
      this._rewardsOutcome.set(outcome);
    }

    this._attempt.set(finished);
  }
}
