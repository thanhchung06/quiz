import { ScoringService } from '../../src/app/features/child-play/services/scoring.service';

describe('ScoringService', () => {
  const scoring = new ScoringService();

  it('awards points and keeps lives on a correct answer', () => {
    const next = scoring.applyAnswer({ submittedCount: 0, correctCount: 0, score: 0, livesRemaining: 5 }, true, 10);
    expect(next).toEqual({ submittedCount: 1, correctCount: 1, score: 10, livesRemaining: 5 });
  });

  it('removes exactly one life on an incorrect answer', () => {
    const next = scoring.applyAnswer({ submittedCount: 0, correctCount: 0, score: 0, livesRemaining: 5 }, false, 10);
    expect(next.livesRemaining).toBe(4);
    expect(next.score).toBe(0);
  });

  it('never drops lives below zero', () => {
    const next = scoring.applyAnswer({ submittedCount: 0, correctCount: 0, score: 0, livesRemaining: 0 }, false, 10);
    expect(next.livesRemaining).toBe(0);
  });

  it('computes accuracy as correct/submitted', () => {
    expect(scoring.accuracy({ submittedCount: 4, correctCount: 3, score: 30, livesRemaining: 5 })).toBe(0.75);
  });

  it('passes only when all questions are answered and accuracy meets the threshold', () => {
    const state = { submittedCount: 5, correctCount: 4, score: 40, livesRemaining: 4 };
    expect(scoring.passed(state, 5, 70)).toBe(true);
    expect(scoring.passed(state, 5, 90)).toBe(false);
    expect(scoring.passed(state, 6, 70)).toBe(false); // not all questions answered yet
  });
});
