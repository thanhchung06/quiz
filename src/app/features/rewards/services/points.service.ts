import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { syncEnabled } from '../../../data/outbox';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { SyncReaderService } from '../../../sync/sync-reader.service';
import { SyncWriterService } from '../../../sync/sync-writer.service';

/**
 * A child's total points (plan §3.7): counted HistoryResult points minus
 * PointUsage points, computed on the device, stored in the child's profile.
 * With sync on, what this device wrote goes up first and both sheets are
 * pulled to their latest row, so the total includes every other device's
 * entries too; then only the total is sent (Google never adds anything up).
 */
@Injectable({ providedIn: 'root' })
export class PointsService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly reader: SyncReaderService,
    private readonly writer: SyncWriterService,
  ) {}

  async recompute(childId: string): Promise<number> {
    if (await syncEnabled()) {
      await this.writer.settle();
      await this.reader.pullHistoryAndUsage();
    }
    const total = await PointsService.computeLocal(childId);
    await this.profiles.setTotalPoints(childId, total);
    return total;
  }

  static async computeLocal(childId: string): Promise<number> {
    const earned = (await db.historyResults.where('childId').equals(childId).toArray())
      .filter((h) => h.counted)
      .reduce((sum, h) => sum + h.pointsEarned, 0);
    const used = (await db.pointUsages.where('childId').equals(childId).toArray()).reduce((sum, u) => sum + u.points, 0);
    return earned - used;
  }
}
