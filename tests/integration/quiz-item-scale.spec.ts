/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { db } from '../../src/app/data/db';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';
import { QuizItem } from '../../src/app/shared/models/domain.model';

/**
 * SC-006: the app must remain responsive with at least 2,000 quiz items, with
 * no noticeable list/search slowdown. This seeds that scale against a real
 * Dexie/IndexedDB (via fake-indexeddb, since Jest runs outside a browser) and
 * times the quiz bank filter. Answer results are no longer stored on the
 * device (specs/003-firebase: results live on the server, last few kept).
 */
describe('scale: 2,000 QuizItems (SC-006)', () => {
  const deviceId = 'perf-test-device';

  beforeAll(async () => {
    const categoryId = 'perf-category';
    await db.categories.add({
      ...newSyncEnvelope(categoryId, deviceId),
      name: 'Perf',
      normalizedName: 'perf',
      subject: 'math',
      status: 'active',
    });

    const quizItems: QuizItem[] = Array.from({ length: 2000 }, (_, i) => ({
      ...newSyncEnvelope(`perf-quiz-${i}`, deviceId),
      subject: i % 2 === 0 ? 'math' : 'language',
      grade: (i % 5) + 1,
      type: 'number',
      prompt: `Perf question ${i}`,
      answerRule: { kind: 'number', acceptedValue: i },
      tags: [`tag-${i % 20}`],
      difficulty: ((i % 3) + 1) as 1 | 2 | 3,
      points: 10,
      categoryId,
      shuffleChoices: false,
      reviewStatus: 'approved',
      status: 'active',
    }));
    await db.quizItems.bulkAdd(quizItems);

  }, 60_000);

  it('filters the 2,000-item quiz bank by subject/grade/tag well under a noticeable-lag threshold', async () => {
    const start = performance.now();
    const results = await db.quizItems
      .filter((item) => item.subject === 'math' && item.grade === 3 && item.tags.includes('tag-2'))
      .toArray();
    const elapsedMs = performance.now() - start;

    expect(results).toHaveLength(100); // i % 20 === 2: even (math) and i % 5 === 2 (grade 3)
    expect(elapsedMs).toBeLessThan(500);
  });
});
