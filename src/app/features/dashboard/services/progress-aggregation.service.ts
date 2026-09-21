import { Injectable } from '@angular/core';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { Attempt } from '../../../shared/models/domain.model';

export type PeriodFilter = 7 | 30 | 'all';

export interface ProgressOverview {
  assigned: number;
  completed: number;
  passed: number;
  unfinished: number;
  accuracyBySubject: Record<string, number>;
  totalPracticeMinutes: number;
  livesLost: number;
  recentActivity: Attempt[];
}

/**
 * Per-child progress aggregation (FR-046): assigned/completed/passed/
 * unfinished counts, accuracy, practice time, lives lost, filtered by the
 * last 7 days (default), 30 days, or all time.
 */
@Injectable({ providedIn: 'root' })
export class ProgressAggregationService {
  constructor(private readonly attempts: AttemptRepository) {}

  async overview(profileId: string, period: PeriodFilter = 7): Promise<ProgressOverview> {
    const all = await this.attempts.listForProfile(profileId);
    const cutoff = period === 'all' ? 0 : Date.now() - period * 24 * 60 * 60 * 1000;
    const inRange = all.filter((a) => new Date(a.startedAt).getTime() >= cutoff);

    const completed = inRange.filter((a) => a.status === 'completed' || a.status === 'timeUp' || a.status === 'tryAgain');
    const passed = inRange.filter((a) => a.passed);
    const unfinished = inRange.filter((a) => a.status === 'inProgress' || a.status === 'abandoned');

    const bySubjectAccuracy: Record<string, number[]> = {};
    let totalMinutes = 0;
    let livesLost = 0;
    for (const attempt of completed) {
      totalMinutes += this.minutesSpent(attempt);
      // An unlimited-lives exercise has nothing to "lose" here.
      if (attempt.exerciseSnapshot.lives !== 'unlimited' && attempt.livesRemaining !== 'unlimited') {
        livesLost += attempt.exerciseSnapshot.lives - attempt.livesRemaining;
      }
      const subjectKey = 'all'; // Exercise.subject would require a join; kept simple for this pass.
      (bySubjectAccuracy[subjectKey] ??= []).push(attempt.accuracy);
    }
    const accuracyBySubject: Record<string, number> = {};
    for (const [subject, values] of Object.entries(bySubjectAccuracy)) {
      accuracyBySubject[subject] = values.reduce((s, v) => s + v, 0) / values.length;
    }

    return {
      assigned: inRange.length,
      completed: completed.length,
      passed: passed.length,
      unfinished: unfinished.length,
      accuracyBySubject,
      totalPracticeMinutes: Math.round(totalMinutes),
      livesLost,
      recentActivity: [...inRange].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 20),
    };
  }

  private minutesSpent(attempt: Attempt): number {
    if (!attempt.completedAt) return 0;
    return (new Date(attempt.completedAt).getTime() - new Date(attempt.startedAt).getTime()) / 60_000;
  }
}
