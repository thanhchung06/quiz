import { Injectable } from '@angular/core';
import { PointsRepository } from '../../../data/repositories/points.repository';

/**
 * "Tính lại điểm" (specs/003 §4): a child's points are set on every finish
 * and every point use from the two running totals; this sets them again from
 * the last history row and the last point use (two small reads).
 */
@Injectable({ providedIn: 'root' })
export class PointsService {
  constructor(private readonly points: PointsRepository) {}

  /** What the records add up to: totalEarned − totalUsed. */
  async fromRecords(childId: string): Promise<number> {
    const [earned, used] = await Promise.all([this.points.totalEarned(childId), this.points.totalUsed(childId)]);
    return earned - used;
  }

  async recompute(childId: string): Promise<number> {
    const total = await this.fromRecords(childId);
    await this.points.set(childId, total);
    return total;
  }
}
