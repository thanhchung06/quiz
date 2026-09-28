import { Injectable } from '@angular/core';
import { ResultRepository } from '../../../data/repositories/result.repository';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { PlayResult } from '../../../shared/models/domain.model';

export type PeriodFilter = 7 | 30 | 'all';

export interface ProgressOverview {
  /** Assignments the child still has. */
  assigned: number;
  completed: number;
  passed: number;
  /** Given up. */
  unfinished: number;
  totalPracticeMinutes: number;
  livesLost: number;
  recentActivity: PlayResult[];
}

/**
 * Per-child progress (FR-046) from the detailed results this device holds
 * (Google keeps the last 1000): completed / passed / given-up counts, practice
 * time and lives lost, for the last 7 days (default), 30 days, or all.
 */
@Injectable({ providedIn: 'root' })
export class ProgressAggregationService {
  constructor(
    private readonly results: ResultRepository,
    private readonly assignments: AssignmentRepository,
  ) {}

  async overview(childId: string, period: PeriodFilter = 7): Promise<ProgressOverview> {
    const all = await this.results.resultsForChild(childId);
    const cutoff = period === 'all' ? '' : new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();
    const inRange = all.filter((r) => r.attemptedAt >= cutoff);
    const finished = inRange.filter((r) => r.status !== 'abandoned');

    let minutes = 0;
    let livesLost = 0;
    for (const r of finished) {
      minutes += Math.max(0, new Date(r.attemptedAt).getTime() - new Date(r.startedAt).getTime()) / 60_000;
      const lives = r.exerciseSnapshot.lives;
      if (lives !== 'unlimited' && r.livesRemaining !== 'unlimited') livesLost += lives - r.livesRemaining;
    }

    return {
      assigned: (await this.assignments.listForChild(childId)).length,
      completed: finished.length,
      passed: finished.filter((r) => r.stars >= 1).length,
      unfinished: inRange.length - finished.length,
      totalPracticeMinutes: Math.round(minutes),
      livesLost,
      recentActivity: inRange.slice(0, 20),
    };
  }
}
