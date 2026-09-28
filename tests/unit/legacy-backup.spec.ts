import { convertLegacyBackup, LegacyBackupEnvelope } from '../../src/app/features/backup/services/backup-format';

const envelope = (): LegacyBackupEnvelope => ({
  formatVersion: '1.0',
  data: {
    profiles: [{ id: 'kid', role: 'child', displayName: 'Nam', avatar: 'a', localVersion: 3, lastGoogleVersion: 2, syncStatus: 'synced' }],
    quizItems: [{ id: 'q1', prompt: 'x', localVersion: 1, lastGoogleVersion: 0, syncStatus: 'pendingUpload' }],
    attempts: [
      {
        id: 'a1', profileId: 'kid', exerciseId: 'e', assignmentId: 'as', exerciseSnapshot: { title: 'Bài', timeLimitMinutes: 5, lives: 3, passingPercent: 50 },
        resolvedItemOrder: ['q1', 'q2'], itemSnapshots: {}, startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:05:00Z',
        status: 'completed', livesRemaining: 3, score: 20,
      },
      {
        id: 'a2', profileId: 'kid', exerciseId: 'e', exerciseSnapshot: { title: 'Bài', timeLimitMinutes: 5, lives: 3, passingPercent: 50 },
        resolvedItemOrder: ['q1', 'q2'], itemSnapshots: {}, startedAt: '2026-01-02T00:00:00Z', status: 'inProgress', livesRemaining: 3, score: 0,
      },
    ],
    answerResults: [
      { attemptId: 'a1', quizItemId: 'q1', submittedAnswer: ['a'], isCorrect: true, pointsEarned: 10, submittedAt: 't' },
      { attemptId: 'a1', quizItemId: 'q2', submittedAnswer: ['a'], isCorrect: true, pointsEarned: 10, submittedAt: 't' },
    ],
    pointRedemptions: [{ id: 'r1', profileId: 'kid', points: 5, note: 'Kẹo', redeemedAt: '2026-01-03T00:00:00Z' }],
  },
});

describe('importing a pre-redesign backup (plan §6)', () => {
  it('keeps profiles/questions without the old sync fields, turns finished attempts into results by the new rules, redemptions into point usage', () => {
    const data = convertLegacyBackup(envelope(), new Map([['kid', 'pin']]));
    expect(data.profiles).toEqual([{ id: 'kid', role: 'child', displayName: 'Nam', avatar: 'a', password: 'pin' }]);
    expect(data.quizItems).toEqual([{ id: 'q1', prompt: 'x' }]);

    // Only the finished attempt; 2/2 correct → 3 stars, +50% bonus.
    expect(data.historyResults).toEqual([
      expect.objectContaining({ id: 'a1', childId: 'kid', assignmentId: 'as', tryNumber: 1, status: 'completed', correctCount: 2, wrongCount: 0, score: 20, stars: 3, bonus: 10, pointsEarned: 30, counted: true }),
    ]);
    expect(data.results[0].answers['q1']).toEqual({ submittedAnswer: ['a'], isCorrect: true, pointsEarned: 10, submittedAt: 't' });
    expect(data.pointUsages).toEqual([{ id: 'r1', childId: 'kid', points: 5, note: 'Kẹo', usedAt: '2026-01-03T00:00:00Z' }]);
    expect(data.assignments).toEqual([]);
  });
});
