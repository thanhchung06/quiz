import 'fake-indexeddb/auto';
import { db } from '../../src/app/data/db';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';
import { QuizItem, AnswerResult } from '../../src/app/shared/models/domain.model';

/**
 * SC-006: the app must remain responsive with at least 2,000 quiz items and
 * 10,000 answer results, with no noticeable list/search slowdown. This seeds
 * that scale against a real Dexie/IndexedDB (via fake-indexeddb, since Jest
 * runs outside a browser) and times the compound-index queries the quiz
 * bank and dashboard actually use.
 */
describe('scale: 2,000 QuizItems / 10,000 AnswerResults (SC-006)', () => {
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

    const attemptId = 'perf-attempt';
    await db.attempts.add({
      ...newSyncEnvelope(attemptId, deviceId),
      profileId: 'perf-profile',
      exerciseId: 'perf-exercise',
      exerciseSnapshot: { title: 'Perf', timeLimitMinutes: 10, lives: 5, passingPercent: 70 },
      randomSeed: 1,
      resolvedItemOrder: [],
      answerOrderByItem: {},
      itemSnapshots: {},
      isScored: true,
      startedAt: new Date().toISOString(),
      deadlineAt: new Date().toISOString(),
      status: 'completed',
      livesRemaining: 5,
      score: 100,
      accuracy: 1,
      passed: true,
      starsAwarded: 3,
      ownerDeviceId: deviceId,
    });

    const answerResults: AnswerResult[] = Array.from({ length: 10_000 }, (_, i) => ({
      ...newSyncEnvelope(`perf-answer-${i}`, deviceId),
      attemptId,
      quizItemId: `perf-quiz-${i % 2000}`,
      quizItemSnapshot: { prompt: `Perf question ${i % 2000}`, type: 'number', correctAnswer: i },
      submittedAnswer: i,
      isCorrect: i % 2 === 0,
      pointsEarned: i % 2 === 0 ? 10 : 0,
      responseSeconds: 3,
      submittedAt: new Date().toISOString(),
    }));
    await db.answerResults.bulkAdd(answerResults);
  }, 60_000);

  it('filters the 2,000-item quiz bank by subject/grade/tag well under a noticeable-lag threshold', async () => {
    const start = performance.now();
    const results = await db.quizItems
      .filter((item) => item.subject === 'math' && item.grade === 3 && item.tags.includes('tag-5'))
      .toArray();
    const elapsedMs = performance.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(500);
  });

  it('reads all 10,000 answer results for an attempt well under a noticeable-lag threshold', async () => {
    const start = performance.now();
    const results = await db.answerResults.where('attemptId').equals('perf-attempt').sortBy('submittedAt');
    const elapsedMs = performance.now() - start;

    expect(results.length).toBe(10_000);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
