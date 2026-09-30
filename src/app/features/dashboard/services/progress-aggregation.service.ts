import { Injectable } from '@angular/core';
import { ResultRepository } from '../../../data/repositories/result.repository';
import { PointsRepository } from '../../../data/repositories/points.repository';
import { HistoryResult } from '../../../shared/models/domain.model';

/** Tries the overview lists. */
export const RECENT_TRIES = 7;

export interface ProgressOverview {
  /** The child's spendable points. */
  points: number;
  /** The last RECENT_TRIES tries, newest first. */
  recentActivity: HistoryResult[];
}

/** Per-child overview (FR-046): points and the last tries — two small reads. */
@Injectable({ providedIn: 'root' })
export class ProgressAggregationService {
  constructor(
    private readonly results: ResultRepository,
    private readonly points: PointsRepository,
  ) {}

  async overview(childId: string): Promise<ProgressOverview> {
    const [points, recentActivity] = await Promise.all([this.points.get(childId), this.results.recentHistory(childId, RECENT_TRIES)]);
    return { points, recentActivity };
  }
}
