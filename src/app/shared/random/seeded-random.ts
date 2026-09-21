/**
 * Deterministic PRNG (mulberry32). Given the same seed it always produces the
 * same sequence, which lets an Attempt store its randomSeed (FR-036, FR-038)
 * and exactly reproduce its random-group resolution and choice shuffle on resume.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generates a fresh 32-bit seed suitable for a new attempt. */
export function generateSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/** Fisher-Yates shuffle driven by a seeded PRNG, returning a new array. */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Picks `count` distinct items from `pool` using the seeded PRNG, no repeats. */
export function seededSample<T>(pool: readonly T[], count: number, rng: () => number): T[] {
  return seededShuffle(pool, rng).slice(0, Math.min(count, pool.length));
}
