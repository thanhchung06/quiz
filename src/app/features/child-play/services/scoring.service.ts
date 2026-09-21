import { Injectable } from '@angular/core';

export interface ScoringState {
  submittedCount: number;
  correctCount: number;
  score: number;
  /** A configured number, or 'unlimited' — an unlimited attempt never loses a life and can never end via tryAgain. */
  livesRemaining: number | 'unlimited';
}

/**
 * Pure scoring rules (FR-039–041): points per configured item, accuracy =
 * correct/submitted, one life removed per incorrect submission regardless
 * of repeat taps (edge case), pass = all answered AND accuracy >= threshold.
 */
@Injectable({ providedIn: 'root' })
export class ScoringService {
  applyAnswer(state: ScoringState, isCorrect: boolean, points: number): ScoringState {
    return {
      submittedCount: state.submittedCount + 1,
      correctCount: state.correctCount + (isCorrect ? 1 : 0),
      score: state.score + (isCorrect ? points : 0),
      livesRemaining: isCorrect || state.livesRemaining === 'unlimited' ? state.livesRemaining : Math.max(0, state.livesRemaining - 1),
    };
  }

  /** A per-question timer running out costs a life, same as a wrong answer, but isn't counted toward submittedCount/accuracy since nothing was actually answered. */
  loseLife(state: ScoringState): ScoringState {
    if (state.livesRemaining === 'unlimited') return state;
    return { ...state, livesRemaining: Math.max(0, state.livesRemaining - 1) };
  }

  outOfLives(state: ScoringState): boolean {
    return state.livesRemaining !== 'unlimited' && state.livesRemaining <= 0;
  }

  accuracy(state: ScoringState): number {
    return state.submittedCount === 0 ? 0 : state.correctCount / state.submittedCount;
  }

  passed(state: ScoringState, totalQuestions: number, passingPercent: number): boolean {
    const allAnswered = state.submittedCount >= totalQuestions;
    return allAnswered && this.accuracy(state) * 100 >= passingPercent;
  }
}
