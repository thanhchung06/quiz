import { Injectable } from '@angular/core';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { Attempt } from '../../../shared/models/domain.model';

export interface PersonalBestResult {
  improvedScore: boolean;
  improvedAccuracy: boolean;
  improvedTime: boolean;
  any: boolean;
}

/** Personal-best detection (FR-044): score, accuracy, or completion-time improvement on a repeat attempt. */
@Injectable({ providedIn: 'root' })
export class PersonalBestService {
  constructor(private readonly attempts: AttemptRepository) {}

  async check(latest: Attempt): Promise<PersonalBestResult> {
    const all = await this.attempts.listForProfile(latest.profileId);
    const priorCompleted = all.filter(
      (a) => a.exerciseId === latest.exerciseId && a.id !== latest.id && a.completedAt && a.status !== 'inProgress',
    );

    if (priorCompleted.length === 0) {
      return { improvedScore: false, improvedAccuracy: false, improvedTime: false, any: false };
    }

    const bestScore = Math.max(...priorCompleted.map((a) => a.score));
    const bestAccuracy = Math.max(...priorCompleted.map((a) => a.accuracy));
    const bestTimeSeconds = Math.min(...priorCompleted.map((a) => this.durationSeconds(a)));

    const improvedScore = latest.score > bestScore;
    const improvedAccuracy = latest.accuracy > bestAccuracy;
    const improvedTime = this.durationSeconds(latest) < bestTimeSeconds;

    return { improvedScore, improvedAccuracy, improvedTime, any: improvedScore || improvedAccuracy || improvedTime };
  }

  private durationSeconds(attempt: Attempt): number {
    if (!attempt.completedAt) return Number.POSITIVE_INFINITY;
    return (new Date(attempt.completedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000;
  }
}
