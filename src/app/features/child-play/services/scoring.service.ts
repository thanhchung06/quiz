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

/**
 * Stars (plan §3.5, hard-coded): 3 = all correct; 2 = at least halfway
 * between the pass rate and 100%, rounded down (80% without a pass rate);
 * 1 = at least the pass rate (anything, without one); 0 = below the pass rate.
 */
export function starsFor(correctCount: number, totalQuestions: number, passingPercent: number): number {
  if (totalQuestions > 0 && correctCount >= totalQuestions) return 3;
  const percent = totalQuestions > 0 ? (correctCount * 100) / totalQuestions : 0;
  const twoStars = passingPercent > 0 ? Math.floor((passingPercent + 100) / 2) : 80;
  if (percent >= twoStars) return 2;
  if (passingPercent <= 0) return 1;
  return percent >= passingPercent ? 1 : 0;
}

/** Bonus on top of the score: +50% for 3 stars, +25% for 2, rounded down. */
export function bonusFor(score: number, stars: number): number {
  if (stars >= 3) return Math.floor(score * 0.5);
  if (stars === 2) return Math.floor(score * 0.25);
  return 0;
}

export interface TryOutcome {
  stars: number;
  bonus: number;
  pointsEarned: number;
  /** Met the pass rate — the assignment is done, and the points count (when this play may earn). */
  passed: boolean;
}

/** An abandoned try never passes; otherwise stars decide (unanswered questions count as not correct). */
export function outcomeOf(score: number, correctCount: number, totalQuestions: number, passingPercent: number, abandoned: boolean): TryOutcome {
  const stars = abandoned ? 0 : starsFor(correctCount, totalQuestions, passingPercent);
  const bonus = bonusFor(score, stars);
  return { stars, bonus, pointsEarned: score + bonus, passed: stars >= 1 };
}
