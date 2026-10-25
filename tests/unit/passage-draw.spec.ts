import { drawPassages, groupByPassage } from '../../src/app/shared/random/passage-draw';
import { mulberry32 } from '../../src/app/shared/random/seeded-random';
import { AttemptResolverService } from '../../src/app/features/child-play/services/attempt-resolver.service';
import { RandomGroupCheckService } from '../../src/app/features/exercise-builder/services/random-group-check.service';
import { Exercise, QuizItem, RandomGroupConfig } from '../../src/app/shared/models/domain.model';

function item(id: string, passageId?: string, order = 1, total = 1, categoryId = 'cat'): QuizItem {
  return {
    id,
    subject: 'language',
    grade: 3,
    type: 'singleChoice',
    prompt: id,
    answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: [],
    difficulty: 2,
    points: 10,
    categoryId,
    shuffleChoices: false,
    reviewStatus: 'approved',
    status: 'active',
    passage: passageId ? { passageId, title: passageId, text: 't', order, total } : undefined,
  } as unknown as QuizItem;
}

// p1: 2 questions, p2: 3 questions, p3: 4 questions, plus 2 standalone
const bank: QuizItem[] = [
  item('p1q2', 'p1', 2, 2),
  item('p1q1', 'p1', 1, 2),
  ...[1, 2, 3].map((n) => item(`p2q${n}`, 'p2', n, 3)),
  ...[1, 2, 3, 4].map((n) => item(`p3q${n}`, 'p3', n, 4)),
  item('s1'),
  item('s2'),
];

const group = (extra: Partial<RandomGroupConfig>): RandomGroupConfig => ({
  count: 1,
  categoryIds: [],
  tags: [],
  difficultyMin: 1,
  difficultyMax: 5,
  allowedTypes: [],
  avoidRecentUse: false,
  preferWeakAreas: false,
  mode: 'fullyRandom',
  ...extra,
});

describe('groupByPassage', () => {
  it('groups sub-questions in passage order and ignores standalone questions', () => {
    const groups = groupByPassage(bank);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g[0].passage!.passageId === 'p1')!.map((q) => q.id)).toEqual(['p1q1', 'p1q2']);
  });
});

describe('drawPassages', () => {
  const groups = groupByPassage(bank);

  it('picks exactly N whole passages', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const chosen = drawPassages(groups, { by: 'passages', value: 2 }, mulberry32(seed));
      expect(chosen).toHaveLength(2);
      expect(new Set(chosen.map((g) => g[0].passage!.passageId)).size).toBe(2);
    }
  });

  it('caps at the available passages', () => {
    expect(drawPassages(groups, { by: 'passages', value: 10 }, mulberry32(1))).toHaveLength(3);
  });

  it('keeps adding passages until the question total reaches the target', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const chosen = drawPassages(groups, { by: 'questions', value: 5 }, mulberry32(seed));
      const total = chosen.reduce((n, g) => n + g.length, 0);
      expect(total).toBeGreaterThanOrEqual(5);
      // stopped as soon as the target was met: without the last passage it was still short
      expect(total - chosen[chosen.length - 1].length).toBeLessThan(5);
    }
  });

  it('returns every passage when the target exceeds the supply', () => {
    expect(drawPassages(groups, { by: 'questions', value: 100 }, mulberry32(1))).toHaveLength(3);
  });
});

describe('AttemptResolverService passage groups', () => {
  const quizItems = { search: jest.fn(async () => bank), getById: jest.fn() };
  const resolver = new AttemptResolverService(quizItems as never, {} as never, {} as never);
  const exercise = (g: RandomGroupConfig) =>
    ({ items: [{ id: 'x', position: 0, kind: 'randomGroup', randomGroup: g }], questionTimingMode: 'none' }) as unknown as Exercise;

  it('adds all questions of each drawn passage, never standalone ones, and is reproducible by seed', async () => {
    const ex = exercise(group({ passageDraw: { by: 'passages', value: 2 } }));
    const plan = await resolver.resolveWithSeed(ex, 'child', 42);
    const ids = plan.resolvedItemOrder;
    const passageIds = new Set(ids.map((id) => plan.itemsById.get(id)!.passage!.passageId));
    expect(passageIds.size).toBe(2);
    for (const pid of passageIds) {
      const expected = bank.filter((q) => q.passage?.passageId === pid).length;
      expect(ids.filter((id) => plan.itemsById.get(id)!.passage!.passageId === pid)).toHaveLength(expected);
    }
    expect((await resolver.resolveWithSeed(ex, 'child', 42)).resolvedItemOrder).toEqual(ids);
  });

  it('meets a minimum total question target', async () => {
    const plan = await resolver.resolveWithSeed(exercise(group({ passageDraw: { by: 'questions', value: 6 } })), 'child', 7);
    expect(plan.resolvedItemOrder.length).toBeGreaterThanOrEqual(6);
  });

  it('a normal group still ignores passage questions', async () => {
    const plan = await resolver.resolveWithSeed(exercise(group({ count: 10 })), 'child', 3);
    expect(plan.resolvedItemOrder.sort()).toEqual(['s1', 's2']);
  });
});

describe('RandomGroupCheckService passage groups', () => {
  const service = new RandomGroupCheckService({ search: async () => bank } as never);

  it('is satisfiable by passage count', async () => {
    expect((await service.checkSatisfiable(group({ passageDraw: { by: 'passages', value: 3 } }))).satisfiable).toBe(true);
    const r = await service.checkSatisfiable(group({ passageDraw: { by: 'passages', value: 4 } }));
    expect(r.satisfiable).toBe(false);
    expect(r.matchingCount).toBe(3);
  });

  it('is satisfiable by total question count', async () => {
    expect((await service.checkSatisfiable(group({ passageDraw: { by: 'questions', value: 9 } }))).satisfiable).toBe(true);
    expect((await service.checkSatisfiable(group({ passageDraw: { by: 'questions', value: 10 } }))).satisfiable).toBe(false);
  });

  it('counts only standalone questions for a normal group', async () => {
    expect((await service.checkSatisfiable(group({ count: 3 }))).satisfiable).toBe(false);
  });
});
