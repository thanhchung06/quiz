import { PassageDrawConfig, QuizItem } from '../models/domain.model';
import { seededShuffle } from './seeded-random';

/** Groups passage sub-questions by passageId (each group sorted in passage order); standalone questions are ignored. */
export function groupByPassage(items: readonly QuizItem[]): QuizItem[][] {
  const groups = new Map<string, QuizItem[]>();
  for (const item of items) {
    if (!item.passage) continue;
    const list = groups.get(item.passage.passageId) ?? [];
    list.push(item);
    groups.set(item.passage.passageId, list);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => (a.passage?.order ?? 0) - (b.passage?.order ?? 0)));
}

/**
 * Randomly picks whole passages: exactly `value` of them for `by: 'passages'`,
 * or as many as needed for the question total to reach `value` for
 * `by: 'questions'` (stops early only when the passages run out).
 */
export function drawPassages(groups: readonly QuizItem[][], draw: PassageDrawConfig, rng: () => number): QuizItem[][] {
  const shuffled = seededShuffle(groups, rng);
  if (draw.by === 'passages') return shuffled.slice(0, Math.max(0, draw.value));
  const chosen: QuizItem[][] = [];
  let total = 0;
  for (const group of shuffled) {
    if (total >= draw.value) break;
    chosen.push(group);
    total += group.length;
  }
  return chosen;
}
