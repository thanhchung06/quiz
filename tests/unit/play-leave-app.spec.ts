/**
 * Switching away from the app during a play (PlayService.failCurrentQuestionOnLeave):
 * the question on screen counts as wrong, costs a life and the play moves on —
 * like a per-question timeout, but marked `leftApp`.
 */
import { randomUUID } from 'node:crypto';
import { PlayService } from '../../src/app/features/child-play/services/play.service';
import { buildBreakdown } from '../../src/app/features/child-play/result/result.component';
import { Exercise, PlayResult, PlaySession, QuizItem, SessionProgress } from '../../src/app/shared/models/domain.model';

if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

const question = (i: number): QuizItem =>
  ({
    id: `q${i}`,
    subject: 'math',
    grade: 2,
    type: 'single-choice',
    prompt: `Câu ${i}`,
    choices: [
      { id: 'a', text: '1' },
      { id: 'b', text: '2' },
    ],
    answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: [],
    difficulty: 1,
    points: 10,
    categoryId: 'cat',
    shuffleChoices: false,
    reviewStatus: 'approved',
    status: 'active',
  }) as unknown as QuizItem;

async function startPlay(count: number, lives: number | 'unlimited', perQuestionSeconds: Record<string, number> = {}) {
  const items = Array.from({ length: count }, (_, i) => question(i));
  const saved: SessionProgress[] = [];
  const sessions = {
    forChild: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    saveProgress: jest.fn(async (_session: PlaySession, progress: SessionProgress) => void saved.push(progress)),
  };
  const results = {
    lastPracticeTry: jest.fn().mockResolvedValue(undefined),
    recordFinish: jest.fn(async (result: PlayResult) => ({ ...result, id: 'r1' })),
  };
  const resolver = {
    resolveNew: jest.fn(async () => ({
      resolvedItemOrder: items.map((q) => q.id),
      itemsById: new Map(items.map((q) => [q.id, q])),
      answerOrderByItem: {},
      perQuestionSeconds,
    })),
  };
  const play = new PlayService(resolver as never, sessions as never, {} as never, results as never);
  const exercise = {
    id: 'ex',
    title: 'Bài đọc',
    timeLimitMinutes: 10,
    lives,
    passingPercent: 0,
  } as unknown as Exercise;
  await play.startPractice('kid', exercise);
  return { play, sessions, results, saved };
}

describe('failing the current question when the child leaves the app', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts the question on screen as wrong, costs a life, moves on and saves the progress', async () => {
    const { play, saved } = await startPlay(3, 3);

    await play.failCurrentQuestionOnLeave();

    expect(play.currentIndex()).toBe(1);
    expect(play.status()).toBe('inProgress');
    const progress = play.session()!.progress;
    expect(progress.livesRemaining).toBe(2);
    expect(progress.score).toBe(0);
    expect(progress.answers['q0']).toMatchObject({
      submittedAnswer: null,
      isCorrect: false,
      pointsEarned: 0,
      leftApp: true,
    });
    expect(progress.answers['q0'].timedOut).toBeUndefined();
    expect(saved.at(-1)).toEqual(progress);
  });

  it('with unlimited lives the question is still wrong but no life is lost', async () => {
    const { play } = await startPlay(2, 'unlimited');

    await play.failCurrentQuestionOnLeave();

    expect(play.session()!.progress.livesRemaining).toBe('unlimited');
    expect(play.session()!.progress.answers['q0']).toMatchObject({ isCorrect: false, leftApp: true });
    expect(play.currentIndex()).toBe(1);
  });

  it('losing the last life this way ends the play as "try again"', async () => {
    const { play, results } = await startPlay(3, 1);

    await play.failCurrentQuestionOnLeave();

    expect(play.status()).toBe('tryAgain');
    expect(results.recordFinish).toHaveBeenCalledTimes(1);
    expect(play.result()).toMatchObject({ correctCount: 0, wrongCount: 1, livesRemaining: 0 });
  });

  it('leaving on the last question completes the play', async () => {
    const { play } = await startPlay(2, 'unlimited');
    await play.submitAnswer(['a']);

    await play.failCurrentQuestionOnLeave();

    expect(play.status()).toBe('completed');
    expect(play.result()).toMatchObject({ correctCount: 1, wrongCount: 1, score: 10 });
  });

  it('two hide events at once fail only one question', async () => {
    const { play } = await startPlay(3, 3);

    await Promise.all([play.failCurrentQuestionOnLeave(), play.failCurrentQuestionOnLeave()]);

    expect(play.currentIndex()).toBe(1);
    expect(play.session()!.progress.livesRemaining).toBe(2);
  });

  it('does nothing once the play is over', async () => {
    const { play, results, sessions } = await startPlay(1, 1);
    await play.failCurrentQuestionOnLeave();
    const writes = sessions.saveProgress.mock.calls.length;

    await play.failCurrentQuestionOnLeave();

    expect(results.recordFinish).toHaveBeenCalledTimes(1);
    expect(sessions.saveProgress).toHaveBeenCalledTimes(writes);
  });

  it('after the overall time ran out it ends as time up without recording the question', async () => {
    const { play } = await startPlay(3, 3);
    jest.spyOn(Date, 'now').mockReturnValue(play.deadlineAt() + 1000);

    await play.failCurrentQuestionOnLeave();

    expect(play.status()).toBe('timeUp');
    expect(play.result()?.answers).toEqual({});
  });

  it('a per-question timeout is still marked timedOut, not leftApp', async () => {
    const { play } = await startPlay(2, 3, { q0: 20, q1: 20 });

    await play.expirePerQuestionTimeout();

    const answer = play.session()!.progress.answers['q0'];
    expect(answer).toMatchObject({ isCorrect: false, timedOut: true });
    expect(answer.leftApp).toBeUndefined();
  });

  it('the result review shows a question failed by leaving as not answered', async () => {
    const { play } = await startPlay(2, 'unlimited');
    await play.failCurrentQuestionOnLeave();
    await play.submitAnswer(['a']);

    const [left, answered] = buildBreakdown(play.result()!);

    expect(left).toMatchObject({ answered: false, isCorrect: false, selectedText: 'Chưa trả lời' });
    expect(answered).toMatchObject({ answered: true, isCorrect: true });
  });
});
