import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, OnDestroy, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PlayService } from '../services/play.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { vi } from '../../../shared/i18n/vi';
import { parseNumberAnswer } from '../services/answer-evaluator';
import { QuizImageComponent } from '../../../shared/quiz-image/quiz-image.component';

const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Keys the mobile decimal keypad lacks (or has only one of) for decimals, fractions ("3 1/2") and negatives. */
const NUMBER_SYMBOL_KEYS = [
  { symbol: ',', text: ',', label: 'Dấu phẩy' },
  { symbol: '.', text: '.', label: 'Dấu chấm' },
  { symbol: '/', text: '/', label: 'Dấu phân số' },
  { symbol: '-', text: '−', label: 'Dấu trừ' },
  { symbol: ' ', text: '␣', label: 'Dấu cách' },
] as const;

/** A horizontal swipe must travel this far (px) and be mostly sideways to switch panes. */
const SWIPE_MIN_DISTANCE = 50;

export type PlayPane = 'passage' | 'question';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionComponent implements OnDestroy {
  readonly strings = vi;
  readonly item: PlayService['currentQuizItem'];
  readonly index: PlayService['currentIndex'];
  readonly total: PlayService['totalQuestions'];
  readonly isEvaluating: PlayService['isEvaluating'];
  readonly session: PlayService['session'];
  /** Set from the moment the play ends (time up, last answer, no lives) until its result is saved — the question is closed meanwhile. */
  readonly ending: PlayService['ending'];
  readonly endError: PlayService['endError'];
  readonly retrying = signal(false);

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
  readonly numberSymbolKeys = NUMBER_SYMBOL_KEYS;
  private readonly numberInput = viewChild<ElementRef<HTMLInputElement>>('numberInput');

  /**
   * For a question with a reading passage on a narrow screen: which of the two
   * panes is shown (swipe or the tabs switch them). Wide screens show both side by side.
   */
  readonly pane = signal<PlayPane>('question');
  private readonly passagePane = viewChild<ElementRef<HTMLElement>>('passagePane');
  private readonly questionPane = viewChild<ElementRef<HTMLElement>>('questionPane');
  private touchStart?: { x: number; y: number };

  readonly isUnlimitedLives = computed(() => this.session()?.exerciseSnapshot.lives === 'unlimited');

  /** One entry per possible life (as configured on the exercise), true = still held. Empty when lives are unlimited. */
  readonly livesDots = computed(() => {
    const session = this.session();
    if (!session || session.exerciseSnapshot.lives === 'unlimited') return [];
    const max = session.exerciseSnapshot.lives;
    const held = session.progress.livesRemaining;
    const remaining = held === 'unlimited' ? max : held;
    return Array.from({ length: max }, (_, i) => i < remaining);
  });

  readonly progressPercent = computed(() => {
    const total = this.total();
    return total > 0 ? Math.round((this.index() / total) * 100) : 0;
  });

  private readonly totalSeconds = computed(() => (this.session()?.exerciseSnapshot.timeLimitMinutes ?? 0) * 60);

  /** True once under a fifth of the exercise's own time limit remains — used to color the timer as urgent. */
  readonly timeIsLow = computed(() => {
    const total = this.totalSeconds();
    return total > 0 && this.remainingSeconds() <= Math.max(10, total * 0.2);
  });

  readonly timeLabel = computed(() => {
    const s = this.remainingSeconds();
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  });

  /** Fraction of the exercise's time limit still remaining; drives the burning-fuse ring around the timer. */
  readonly timeRatio = computed(() => {
    const total = this.totalSeconds();
    return total > 0 ? Math.max(0, Math.min(1, this.remainingSeconds() / total)) : 1;
  });

  /** Whether the current question has its own per-question time cap (see QuestionTimingMode). */
  readonly hasQuestionTimer = computed(() => this.play.questionDeadlineAt() !== undefined);

  readonly questionTimeLabel = computed(() => {
    const s = this.remainingQuestionSeconds() ?? 0;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return m > 0 ? `${m}:${rest.toString().padStart(2, '0')}` : `${rest}s`;
  });

  readonly questionTimeIsLow = computed(() => (this.remainingQuestionSeconds() ?? 0) <= 3);

  private readonly timerHandle: ReturnType<typeof setInterval>;
  private readonly clockHandle: ReturnType<typeof setInterval>;
  /** Switching to another app fails the question on screen (wrong, costs a life); the play then moves on and is saved. */
  private readonly onHidden = () => {
    if (document.visibilityState !== 'hidden') return;
    void this.play.failCurrentQuestionOnLeave().then(() => this.play.saveClock());
  };
  private readonly onPageHide = () => void this.play.saveClock();

  constructor(
    private readonly play: PlayService,
    private readonly router: Router,
  ) {
    this.item = this.play.currentQuizItem;
    this.index = this.play.currentIndex;
    this.total = this.play.totalQuestions;
    this.isEvaluating = this.play.isEvaluating;
    this.session = this.play.session;
    this.ending = this.play.ending;
    this.endError = this.play.endError;

    effect(() => {
      // Reset local answer state whenever the current question changes.
      this.index();
      this.choiceAnswer.set([]);
      this.textAnswer.set('');
      this.numberAnswer.set('');
    });

    let passageId: string | undefined;
    effect(() => {
      // A new question starts at the top; a new passage opens on its text, later questions of the same one on the question.
      this.index();
      const passage = this.item()?.passage;
      untracked(() => {
        const newPassage = passage?.passageId !== passageId;
        passageId = passage?.passageId;
        this.pane.set(passage && newPassage ? 'passage' : 'question');
        const questionPane = this.questionPane()?.nativeElement;
        const passagePane = this.passagePane()?.nativeElement;
        if (questionPane) questionPane.scrollTop = 0;
        if (passagePane && newPassage) passagePane.scrollTop = 0;
      });
    });

    effect(() => {
      if (this.play.status() !== 'inProgress') {
        void this.router.navigateByUrl('/exercise/result');
        return;
      }
      if (!this.session()) void this.router.navigateByUrl('/child-home');
      this.updateRemainingSeconds();
    });

    this.timerHandle = setInterval(() => this.updateRemainingSeconds(), 1000);
    // The clock keeps running while the app is hidden and stops only when it is closed: save it often.
    this.clockHandle = setInterval(() => void this.play.saveClock(), 10_000);
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onPageHide);
  }

  private updateRemainingSeconds(): void {
    if (!this.session() || this.play.status() !== 'inProgress' || this.play.ending()) return;
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((this.play.deadlineAt() - now) / 1000));
    this.remainingSeconds.set(remaining);
    if (remaining === 0) {
      // Overall exercise time is a hard backstop in every timing mode; the unsubmitted response isn't scored.
      void this.play.expireDueToTimeout();
      return;
    }
    const questionDeadline = this.play.questionDeadlineAt();
    if (questionDeadline !== undefined) {
      const qRemaining = Math.max(0, Math.floor((questionDeadline - now) / 1000));
      this.remainingQuestionSeconds.set(qRemaining);
      if (qRemaining === 0) void this.play.expirePerQuestionTimeout();
    } else {
      this.remainingQuestionSeconds.set(undefined);
    }
  }

  onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.touchStart = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }

  /** Swipe left shows the question, swipe right the passage; vertical drags are left to the pane's own scrolling. */
  onTouchEnd(event: TouchEvent): void {
    const start = this.touchStart;
    const touch = event.changedTouches[0];
    this.touchStart = undefined;
    if (!start || !touch || !this.item()?.passage) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    this.pane.set(dx < 0 ? 'question' : 'passage');
  }

  toggleChoice(choiceId: string, multi: boolean): void {
    this.choiceAnswer.update((current) => {
      if (multi) {
        return current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId];
      }
      return [choiceId];
    });
  }

  /** Types `symbol` at the number input's caret (replacing any selection), keeping it focused. */
  insertNumberSymbol(symbol: string): void {
    const input = this.numberInput()?.nativeElement;
    if (!input) {
      this.numberAnswer.update((value) => value + symbol);
      return;
    }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    // Written to the element directly so the caret can be placed now; ngModel then writes back the same string, which leaves the caret alone.
    input.value = input.value.slice(0, start) + symbol + input.value.slice(end);
    input.focus();
    input.setSelectionRange(start + symbol.length, start + symbol.length);
    this.numberAnswer.set(input.value);
  }

  async submit(): Promise<void> {
    if (!this.isValidResponse() || this.isEvaluating() || this.ending()) return;
    const item = this.item();
    if (!item) return;

    let value: unknown;
    if (item.type === 'short-text') value = this.textAnswer();
    else if (item.type === 'number') value = parseNumberAnswer(this.numberAnswer());
    else value = this.choiceAnswer();

    await this.play.submitAnswer(value);
  }

  async retryFinish(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.play.retryFinish();
    } finally {
      this.retrying.set(false);
    }
  }

  /** Leaves the exercise without ending it: it stays open and continues from here next time. */
  async leave(): Promise<void> {
    await this.play.saveClock();
    await this.router.navigateByUrl('/child-home');
  }

  ngOnDestroy(): void {
    clearInterval(this.timerHandle);
    clearInterval(this.clockHandle);
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pagehide', this.onPageHide);
    void this.play.saveClock();
  }
}
