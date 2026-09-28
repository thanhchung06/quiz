import { Injectable } from '@angular/core';
import { db } from '../db';
import { enqueue } from '../outbox';
import { PointUsage } from '../../shared/models/domain.model';
import { JsonRecord } from '../../sync/protocol';

/** A parent trading a child's points for something (plan §3.6): append-only. */
@Injectable({ providedIn: 'root' })
export class PointUsageRepository {
  async listForChild(childId: string): Promise<PointUsage[]> {
    const all = await db.pointUsages.where('childId').equals(childId).toArray();
    return all.sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }

  async use(childId: string, points: number, note?: string): Promise<PointUsage> {
    const usage: PointUsage = { id: crypto.randomUUID(), childId, points, note, usedAt: new Date().toISOString() };
    await db.pointUsages.add(usage);
    await enqueue({ op: 'APPEND_POINT_USAGE', usage: usage as unknown as JsonRecord });
    return usage;
  }
}
