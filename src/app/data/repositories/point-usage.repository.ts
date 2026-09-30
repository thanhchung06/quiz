import { Injectable } from '@angular/core';
import { PointUsage } from '../../shared/models/domain.model';
import { RemoteStore } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';
import { appendRow, lastRow } from '../../remote/numbered-rows';
import { PointsRepository } from './points.repository';

/** Point uses shown per page. */
export const USAGE_PAGE = 20;

/**
 * A parent trading a child's points for something (pointUsage/{childId}/{n}):
 * append-only and numbered, each row carrying totalUsed (the previous row's
 * + its points).
 */
@Injectable({ providedIn: 'root' })
export class PointUsageRepository {
  constructor(private readonly remote: RemoteStore) {}

  /** One page of uses, newest first: the last ones, or the ones before `beforeId`. */
  async page(childId: string, beforeId?: string, size = USAGE_PAGE): Promise<PointUsage[]> {
    return (await this.remote.list<StoredNode>(`pointUsage/${childId}`, { limitToLast: size, endBefore: beforeId }))
      .map((row) => decode<PointUsage>(row.value))
      .filter((u): u is PointUsage => !!u)
      .reverse();
  }

  /**
   * Records the use under the next number with its running total, and sets
   * the child's points from the totals, in one atomic write (redone at the
   * next number if another device took this one first).
   */
  async use(childId: string, points: number, note?: string): Promise<PointUsage> {
    let usage!: PointUsage;
    await appendRow(this.remote, `pointUsage/${childId}`, async (key, last) => {
      const totalUsed = PointsRepository.totalOf(last, 'totalUsed') + points;
      const totalEarned = PointsRepository.totalOf((await lastRow(this.remote, `history/${childId}`))?.value, 'totalEarned');
      usage = { id: key, childId, points, note, usedAt: new Date().toISOString(), totalUsed };
      const { totalUsed: _t, ...record } = usage;
      return {
        [`pointUsage/${childId}/${key}`]: encode(record, 'createdAt', { totalUsed }),
        [PointsRepository.path(childId)]: totalEarned - totalUsed,
      };
    });
    return usage;
  }
}
