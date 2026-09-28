import { Injectable } from '@angular/core';
import { PointsRepository } from '../../../data/repositories/points.repository';
import { PointUsageRepository } from '../../../data/repositories/point-usage.repository';
import { ResultRepository } from '../../../data/repositories/result.repository';

/**
 * "Tính lại điểm" (specs/003 §4): a child's points are normally kept up to
 * date by atomic +/− on every counted try and every point use; this rebuilds
 * them from the records — counted history points minus points used.
 */
@Injectable({ providedIn: 'root' })
export class PointsService {
  constructor(
    private readonly points: PointsRepository,
    private readonly results: ResultRepository,
    private readonly usages: PointUsageRepository,
  ) {}

  /** What the records add up to. */
  async fromRecords(childId: string): Promise<number> {
    const earned = (await this.results.historyForChild(childId)).filter((h) => h.counted).reduce((sum, h) => sum + h.pointsEarned, 0);
    const used = (await this.usages.listForChild(childId)).reduce((sum, u) => sum + u.points, 0);
    return earned - used;
  }

  async recompute(childId: string): Promise<number> {
    const total = await this.fromRecords(childId);
    await this.points.set(childId, total);
    return total;
  }
}
