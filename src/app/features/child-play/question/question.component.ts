import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AttemptLifecycleService } from '../services/attempt-lifecycle.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { vi } from '../../../shared/i18n/vi';
import { parseNumberAnswer } from '../services/answer-evaluator';
import { QuizImageComponent } from '../../../shared/quiz-image/quiz-image.component';

const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * One quiz item per screen (FR-010): position/lives/time shown, the answer
 * control stays disabled until a valid response is given, and a submitted
 * answer is locked for the rest of the attempt (FR-011). No correct/incorrect
 * panel is shown — submitting immediately advances to the next question (or
 * the result screen if this was the last one); the only visible sign of a
 * wrong answer is a lost heart in the header, with a double-submission guard
 * (edge case) preventing a second submit while the first is still evaluating.
 */
@Component({
  selector: 'app-question',
  standalone: true,
  imports: [FormsModule, IconComponent, QuizImageComponent],
  templateUrl: './question.component.html',
  styleUrl: './question.component.scss',
})
export class QuestionComponent {
  readonly strings = vi;
  readonly item: AttemptLifecycleService['currentQuizItem'];
  readonly index: AttemptLifecycleService['currentIndex'];
  readonly total: AttemptLifecycleService['totalQuestions'];
  readonly isEvaluating: AttemptLifecycleService['isEvaluating'];
  readonly attempt: AttemptLifecycleService['attempt'];

  readonly choiceAnswer = signal<string[]>([]);
  readonly textAnswer = signal('');
  readonly numberAnswer = signal<string>('');
  readonly remainingSeconds = signal(0);
  readonly remainingQuestionSeconds = signal<number | undefined>(undefined);

  readonly isValidResponse = computed(() => {
    const item = this.item();
    if (!item) return false;
    if (item.type === 'single-choice' || item.type === 'true-false') return this.choiceAnswer().length === 1;
    if (item.type === 'multiple-choice') return this.choiceAnswer().length > 0;
    if (item.type === 'short-text') return this.textAnswer().trim().length > 0;
    if (item.type === 'number') return !Number.isNaN(parseNumberAnswer(this.numberAnswer()));
    return false;
  });

  readonly choiceLetters = CHOICE_LETTERS;

  readonly isUnlimitedLives = computed(() => this.attempt()?.exerciseSnapshot.lives === 'unlimited');

  /** One entry per possible life (as configured on the exercise), true = still held. Drives heart icons; empty/unused when lives are unlimited (see isUnlimitedLives). */
  readonly livesDots = computed(() => {
    const attempt = this.attempt();
    if (!attempt || attempt.exerciseSnapshot.lives === 'unlimited') return [];
    const max = attempt.exerciseSnapshot.lives;
    const remaining = attempt.livesRemaining === 'unlimited' ? max : attempt.livesRemaining;
    return Array.from({ length: max }, (_, i) => i < remaining);
  });

  readonly progressPercent = computed(() => {
    const total = this.total();
    return total > 0 ? Math.round((this.index() / total) * 100) : 0;
  });

  /** True once under a fifth of the exercise's own time limit remains — used to color the timer as urgent. */
  readonly timeIsLow = computed(() => {
    const attempt = this.attempt();
    if (!attempt) return false;
    const totalSeconds = attempt.exerciseSnapshot.timeLimitMinutes * 60;
    return totalSeconds > 0 && this.remainingSeconds() <= Math.max(10, totalSeconds * 0.2);
  });

  readonly timeLabel = computed(() => {
    const s = this.remainingSeconds();
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return `${m}:${rest.toString().padStart(2, '0')}`;
  });

  /** Fraction of the exercise's time limit still remaining; drives the burning-fuse ring around the timer. */
  readonly timeRatio = computed(() => {
    const attempt = this.attempt();
    if (!attempt) return 1;
    const totalSeconds = attempt.exerciseSnapshot.timeLimitMinutes * 60;
    return totalSeconds > 0 ? Math.max(0, Math.min(1, this.remainingSeconds() / totalSeconds)) : 1;
  });

  /** Whether the current question has its own per-question time cap (see QuestionTimingMode). */
  readonly hasQuestionTimer = computed(() => {
    const attempt = this.attempt();
    const item = this.item();
    if (!attempt || !item) return false;
    return !!attempt.perQuestionSeconds?.[item.id];
  });

  readonly questionTimeLabel = computed(() => {
    const s = this.remainingQuestionSeconds() ?? 0;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return m > 0 ? `${m}:${rest.toString().padStart(2, '0')}` : `${rest}s`;
  });

  readonly questionTimeIsLow = computed(() => (this.remainingQuestionSeconds() ?? 0) <= 3);

  private timerHandle?: ReturnType<typeof setInterval>;

  constructor(
    private readonly lifecycle: AttemptLifecycleService,
    private readonly router: Router,
  ) {
    this.item = this.lifecycle.currentQuizItem;
    this.index = this.lifecycle.currentIndex;
    this.total = this.lifecycle.totalQuestions;
    this.isEvaluating = this.lifecycle.isEvaluating;
    this.attempt = this.lifecycle.attempt;

    effect(() => {
      // Reset local answer state whenever the current question changes.
      this.index();
      this.choiceAnswer.set([]);
      this.textAnswer.set('');
      this.numberAnswer.set('');
    });

    effect(() => {
      const attempt = this.attempt();
      if (attempt && attempt.status !== 'inProgress') {
        void this.router.navigateByUrl('/exercise/result');
        return;
      }
      this.updateRemainingSeconds();
    });

    this.timerHandle = setInterval(() => this.updateRemainingSeconds(), 1000);
  }

  private updateRemainingSeconds(): void {
    const attempt = this.attempt();
    if (!attempt) return;
    const remaining = Math.max(0, Math.floor((new Date(attempt.deadlineAt).getTime() - Date.now()) / 1000));
    this.remainingSeconds.set(remaining);
    if (remaining === 0 && attempt.status === 'inProgress') {
      // Overall exercise deadline reached: end as Time Up without scoring
      // the current unsubmitted response (edge case, FR-013). This always
      // takes priority over — and stays independent of — any per-question
      // timer below, since it's a hard backstop in every timing mode.
      void this.lifecycle.expireDueToTimeout().then(() => this.router.navigateByUrl('/exercise/result'));
      return;
    }

    if (attempt.currentQuestionDeadlineAt && attempt.status === 'inProgress') {
      const qRemaining = Math.max(0, Math.floor((new Date(attempt.currentQuestionDeadlineAt).getTime() - Date.now()) / 1000));
      this.remainingQuestionSeconds.set(qRemaining);
      if (qRemaining === 0) {
        void this.lifecycle.expirePerQuestionTimeout().then(() => {
          if (this.attempt()?.status !== 'inProgress') this.router.navigateByUrl('/exercise/result');
        });
      }
    } else {
      this.remainingQuestionSeconds.set(undefined);
    }
  }

  toggleChoice(choiceId: string, multi: boolean): void {
    this.choiceAnswer.update((current) => {
      if (multi) {
        return current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId];
      }
      return [choiceId];
    });
  }

  async submit(): Promise<void> {
    if (!this.isValidResponse() || this.isEvaluating()) return;
    const item = this.item();
    if (!item) return;

    let value: unknown;
    if (item.type === 'short-text') value = this.textAnswer();
    else if (item.type === 'number') value = parseNumberAnswer(this.numberAnswer());
    else value = this.choiceAnswer();

    const result = await this.lifecycle.submitAnswer(value);
    if (!result) return;

    this.goNext();
  }

  /** Moves to the next question, or to the result screen if the attempt already ended (e.g. that was the last question, or the last life). */
  private goNext(): void {
    const attempt = this.attempt();
    if (attempt && attempt.status !== 'inProgress') {
      void this.router.navigateByUrl('/exercise/result');
      return;
    }
    this.lifecycle.advanceToNext();
  }

  ngOnDestroy(): void {
    if (this.timerHandle) clearInterval(this.timerHandle);
  }
}
