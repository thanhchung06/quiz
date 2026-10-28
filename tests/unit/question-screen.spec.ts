/**
 * The question screen (QuestionComponent) on a stand-in PlayService:
 * - hiding the app (switching to another one) fails the question on screen;
 * - a question with a reading passage gets two panes — passage and question —
 *   switched by tabs or a left/right swipe on narrow screens.
 * The side-by-side wide layout is CSS only and not checked here.
 */
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { QuestionComponent } from '../../src/app/features/child-play/question/question.component';
import { PlayService, PlayStatus } from '../../src/app/features/child-play/services/play.service';
import { EndStatus, PassageContext, PlaySession, QuizItem } from '../../src/app/shared/models/domain.model';

const passage = (passageId: string, order: number, total = 2): PassageContext => ({
  passageId,
  title: `Bài đọc ${passageId}`,
  text: 'Ngày xửa ngày xưa có một chú thỏ trắng.',
  order,
  total,
});

const question = (id: string, p?: PassageContext): QuizItem =>
  ({
    id,
    type: 'single-choice',
    prompt: `Câu ${id}`,
    choices: [
      { id: 'a', text: 'Một' },
      { id: 'b', text: 'Hai' },
    ],
    answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    points: 10,
    passage: p,
  }) as unknown as QuizItem;

/** Just the PlayService surface the question screen reads; `index` moves through `items`. */
class FakePlay {
  items: QuizItem[] = [];
  readonly index = signal(0);
  readonly status = signal<PlayStatus>('inProgress');
  readonly ending = signal<EndStatus | undefined>(undefined);
  readonly endError = signal<string | undefined>(undefined);
  readonly isEvaluating = signal(false);
  readonly deadlineAt = signal(Date.now() + 10 * 60_000);
  readonly questionDeadlineAt = signal<number | undefined>(undefined);
  readonly currentIndex = this.index.asReadonly();
  readonly totalQuestions = computed(() => this.items.length);
  readonly currentQuizItem = computed(() => this.items[this.index()]);
  readonly session = signal({
    exerciseSnapshot: { title: 'Bài', timeLimitMinutes: 10, lives: 3, passingPercent: 0 },
    progress: { livesRemaining: 3 },
  } as unknown as PlaySession);
  readonly failCurrentQuestionOnLeave = jest.fn(async () => undefined);
  readonly saveClock = jest.fn(async () => undefined);
  readonly submitAnswer = jest.fn(async () => true);
  readonly expireDueToTimeout = jest.fn(async () => undefined);
  readonly expirePerQuestionTimeout = jest.fn(async () => undefined);
}

let play: FakePlay;
let fixture: ComponentFixture<QuestionComponent>;
let visibility: DocumentVisibilityState;

function render(items: QuizItem[]) {
  play.items = items;
  fixture = TestBed.createComponent(QuestionComponent);
  fixture.detectChanges();
}

function goTo(index: number) {
  play.index.set(index);
  fixture.detectChanges();
}

const el = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
const pane = () => fixture.componentInstance.pane();

function swipe(dx: number, dy = 0) {
  const body = fixture.debugElement.query(By.css('.play-body'));
  body.triggerEventHandler('touchstart', { touches: [{ clientX: 200, clientY: 300 }] });
  body.triggerEventHandler('touchend', { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
  fixture.detectChanges();
}

function hideApp(state: DocumentVisibilityState = 'hidden') {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  play = new FakePlay();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  TestBed.configureTestingModule({
    imports: [QuestionComponent],
    providers: [
      { provide: PlayService, useValue: play },
      { provide: Router, useValue: { navigateByUrl: jest.fn().mockResolvedValue(true) } },
    ],
  });
});

afterEach(() => fixture?.destroy());

describe('switching away from the app', () => {
  it('fails the question on screen, then saves the clock', async () => {
    render([question('q0'), question('q1')]);

    hideApp();
    await Promise.resolve();
    await Promise.resolve();

    expect(play.failCurrentQuestionOnLeave).toHaveBeenCalledTimes(1);
    expect(play.saveClock).toHaveBeenCalled();
    expect(play.failCurrentQuestionOnLeave.mock.invocationCallOrder[0]).toBeLessThan(
      play.saveClock.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('coming back to the app does not fail anything', () => {
    render([question('q0')]);

    hideApp('visible');

    expect(play.failCurrentQuestionOnLeave).not.toHaveBeenCalled();
  });

  it('stops watching once the question screen is closed', () => {
    render([question('q0')]);
    fixture.destroy();

    hideApp();

    expect(play.failCurrentQuestionOnLeave).not.toHaveBeenCalled();
  });
});

describe('reading passage layout', () => {
  it('a question without a passage has no panes to switch', () => {
    render([question('q0')]);

    expect(el('main')!.classList).not.toContain('with-passage');
    expect(el('.play-body')!.classList).not.toContain('has-passage');
    expect(el('.pane-switch')).toBeNull();
    expect(el('.passage-pane')).toBeNull();
    expect(el('.question-pane .prompt')!.textContent).toContain('Câu q0');
  });

  it('a passage question shows the passage pane and the question pane with tabs', () => {
    render([question('q0', passage('p1', 1))]);

    expect(el('main')!.classList).toContain('with-passage');
    expect(el('.play-body')!.classList).toContain('has-passage');
    expect(el('.passage-pane .passage-text')!.textContent).toContain('chú thỏ trắng');
    expect(el('.passage-pane .passage-heading')!.textContent).toContain('Câu 1/2 của đoạn này');
    expect(el('.question-pane .prompt')!.textContent).toContain('Câu q0');
    expect(el('.question-pane .choices')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.pane-switch [role="tab"]')).toHaveLength(2);
  });

  it('opens on the reading for a new passage, on the question for the next one of the same passage', () => {
    render([question('q0', passage('p1', 1)), question('q1', passage('p1', 2)), question('q2', passage('p2', 1, 1))]);
    expect(pane()).toBe('passage');
    expect(el('.play-body')!.classList).not.toContain('show-question');

    goTo(1);
    expect(pane()).toBe('question');
    expect(el('.play-body')!.classList).toContain('show-question');

    goTo(2);
    expect(pane()).toBe('passage');
  });

  it('the tabs and the "answer" button switch panes', () => {
    render([question('q0', passage('p1', 1))]);
    const [readingTab, questionTab] = fixture.nativeElement.querySelectorAll('.pane-switch [role="tab"]');
    expect(readingTab.getAttribute('aria-selected')).toBe('true');

    questionTab.click();
    fixture.detectChanges();
    expect(pane()).toBe('question');
    expect(questionTab.getAttribute('aria-selected')).toBe('true');
    expect(readingTab.getAttribute('aria-selected')).toBe('false');

    readingTab.click();
    fixture.detectChanges();
    expect(pane()).toBe('passage');

    el('.to-question')!.click();
    fixture.detectChanges();
    expect(pane()).toBe('question');
  });

  it('swiping left shows the question, swiping right the reading', () => {
    render([question('q0', passage('p1', 1))]);

    swipe(-120);
    expect(pane()).toBe('question');
    expect(el('.play-body')!.classList).toContain('show-question');

    swipe(120);
    expect(pane()).toBe('passage');
  });

  it('short or mostly vertical drags (scrolling) do not switch panes', () => {
    render([question('q0', passage('p1', 1))]);

    swipe(-30);
    expect(pane()).toBe('passage');

    swipe(-80, 200);
    expect(pane()).toBe('passage');
  });

  it('a multi-finger touch is not a swipe', () => {
    render([question('q0', passage('p1', 1))]);
    const body = fixture.debugElement.query(By.css('.play-body'));

    body.triggerEventHandler('touchstart', {
      touches: [
        { clientX: 200, clientY: 300 },
        { clientX: 260, clientY: 300 },
      ],
    });
    body.triggerEventHandler('touchend', { changedTouches: [{ clientX: 20, clientY: 300 }] });

    expect(pane()).toBe('passage');
  });

  it('swiping does nothing on a question without a passage', () => {
    render([question('q0')]);

    swipe(120);

    expect(pane()).toBe('question');
  });
});

describe('number answer symbol keys', () => {
  const numberQuestion = (id: string): QuizItem =>
    ({ id, type: 'number', prompt: `Câu ${id}`, answerRule: { kind: 'number', acceptedValue: 3.5 }, points: 10 }) as unknown as QuizItem;

  /** Lets ngModel write its initial (empty) value, as it would before the child starts typing; the question timer keeps the zone from ever being stable. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const input = () => el('input[name="numberAnswer"]') as HTMLInputElement;
  /** Taps a symbol key, then lets ngModel's write-back run, as the browser does before the next keystroke. */
  const pressKey = async (label: string) => {
    const key = [...fixture.nativeElement.querySelectorAll('.symbol-keys button')].find(
      (b: HTMLElement) => b.getAttribute('aria-label') === label,
    ) as HTMLButtonElement;
    key.click();
    fixture.detectChanges();
    await settle();
  };
  /** Types as a child would: the text ends up in the input with the caret after it. */
  const type = (text: string) => {
    input().value = text;
    input().setSelectionRange(text.length, text.length);
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('only appears on a number question', () => {
    render([question('q0')]);
    expect(el('.symbol-keys')).toBeNull();
  });

  it('types "/", space, "," and "-" so fractions, mixed numbers and decimals can be entered', async () => {
    render([numberQuestion('q0')]);
    await settle();

    type('3');
    await pressKey('Dấu cách');
    type(input().value + '1');
    await pressKey('Dấu phân số');
    type(input().value + '2');
    expect(fixture.componentInstance.numberAnswer()).toBe('3 1/2');
    expect(fixture.componentInstance.isValidResponse()).toBe(true);

    type('');
    await pressKey('Dấu trừ');
    type(input().value + '3');
    await pressKey('Dấu phẩy');
    type(input().value + '5');
    expect(fixture.componentInstance.numberAnswer()).toBe('-3,5');

    await fixture.componentInstance.submit();
    expect(play.submitAnswer).toHaveBeenCalledWith(-3.5);
  });

  it('inserts at the caret, replacing a selection, and keeps the input focused', async () => {
    render([numberQuestion('q0')]);
    await settle();
    type('72');
    input().focus();
    input().setSelectionRange(1, 1);

    await pressKey('Dấu phân số');

    expect(fixture.componentInstance.numberAnswer()).toBe('7/2');
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(2);
  });
});
