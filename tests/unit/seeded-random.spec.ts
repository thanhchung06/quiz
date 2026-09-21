import { mulberry32, seededShuffle, seededSample } from '../../src/app/shared/random/seeded-random';

describe('seeded-random', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('shuffles deterministically for a given rng', () => {
    const items = [1, 2, 3, 4, 5];
    const shuffled1 = seededShuffle(items, mulberry32(7));
    const shuffled2 = seededShuffle(items, mulberry32(7));
    expect(shuffled1).toEqual(shuffled2);
    expect(shuffled1.sort()).toEqual(items.sort());
  });

  it('samples without repeats and without mutating the pool', () => {
    const pool = ['a', 'b', 'c', 'd'];
    const sample = seededSample(pool, 2, mulberry32(1));
    expect(sample.length).toBe(2);
    expect(new Set(sample).size).toBe(2);
    expect(pool).toEqual(['a', 'b', 'c', 'd']);
  });
});
