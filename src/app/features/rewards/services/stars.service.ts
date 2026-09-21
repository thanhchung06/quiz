import { Injectable } from '@angular/core';
import { Attempt } from '../../../shared/models/domain.model';

/** Stars-awarding rule (FR-042): 1 completion, 2 passing, 3 for ≥90% accuracy with ≥1 life remaining. */
@Injectable({ providedIn: 'root' })
export class StarsService {
  computeStars(attempt: Pick<Attempt, 'status' | 'passed' | 'accuracy' | 'livesRemaining'>): number {
    if (attempt.status !== 'completed') return 0;
    const hasLifeLeft = attempt.livesRemaining === 'unlimited' || attempt.livesRemaining >= 1;
    if (attempt.accuracy >= 0.9 && hasLifeLeft) return 3;
    if (attempt.passed) return 2;
    return 1;
  }
}
