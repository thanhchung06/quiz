/**
 * A daily assignment (PlayService.dailyState / triesLeft): done for the day
 * once a try today passed; a failed or given-up try leaves it open; a new day
 * starts fresh whatever happened the day before.
 */
import { PlayService, passedTry } from '../../src/app/features/child-play/services/play.service';
import { Assignment, HistoryResult } from '../../src/app/shared/models/domain.model';

const DAY = 24 * 60 * 60 * 1000;

const assignment = (isDaily = true, tries = 0): Assignment =>
  ({
    id: 'as1',
    childId: 'kid',
    exerciseId: 'ex',
    exerciseSnapshot: { isDaily, repeatLimit: 1 },
    assignedAt: new Date().toISOString(),
    tries,
  }) as unknown as Assignment;

function playWithLastTry(last?: Partial<HistoryResult>) {
  const results = { lastTryOfAssignment: jest.fn().mockResolvedValue(last) };
  return new PlayService({} as never, {} as never, {} as never, results as never);
}

const today = () => new Date().toISOString();
const yesterday = () => new Date(Date.now() - DAY).toISOString();

describe('daily assignment: play until passed each day', () => {
  it('not tried yet: new, unlimited', async () => {
    const play = playWithLastTry(undefined);
    expect(await play.dailyState(assignment())).toBe('new');
    expect(await play.triesLeft(assignment())).toBe('unlimited');
  });

  it('failed today: can retry', async () => {
    const play = playWithLastTry({ attemptedAt: today(), stars: 0, status: 'tryAgain' });
    expect(await play.dailyState(assignment())).toBe('retry');
    expect(await play.triesLeft(assignment())).toBe('unlimited');
  });

  it('given up today: can retry', async () => {
    const play = playWithLastTry({ attemptedAt: today(), stars: 0, status: 'abandoned' });
    expect(await play.dailyState(assignment())).toBe('retry');
  });

  it('passed today: done until tomorrow', async () => {
    const play = playWithLastTry({ attemptedAt: today(), stars: 1, status: 'completed' });
    expect(await play.dailyState(assignment())).toBe('passed');
    expect(await play.triesLeft(assignment())).toBe(0);
  });

  it('passed yesterday: a new day starts fresh', async () => {
    const play = playWithLastTry({ attemptedAt: yesterday(), stars: 3, status: 'completed' });
    expect(await play.dailyState(assignment())).toBe('new');
    expect(await play.triesLeft(assignment())).toBe('unlimited');
  });

  it('a normal assignment still counts its tries', async () => {
    const play = playWithLastTry({ attemptedAt: today(), stars: 0 });
    expect(await play.triesLeft(assignment(false, 0))).toBe(1);
    expect(await play.triesLeft(assignment(false, 1))).toBe(0);
  });

  it('a try passes with at least one star', () => {
    expect(passedTry({ stars: 0 })).toBe(false);
    expect(passedTry({ stars: 1 })).toBe(true);
  });
});
