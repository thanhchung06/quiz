import { Injectable } from '@angular/core';
import { PointUsage } from '../../shared/models/domain.model';
import { increment, RemoteStore } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';

/** A parent trading a child's points for something (pointUsage/{childId}/{id}): append-only. */
@Injectable({ providedIn: 'root' })
export class PointUsageRepository {
  constructor(private readonly remote: RemoteStore) {}

  async listForChild(childId: string): Promise<PointUsage[]> {
    return (await this.remote.list<StoredNode>(`pointUsage/${childId}`))
      .map((row) => decode<PointUsage>(row.value))
      .filter((u): u is PointUsage => !!u)
      .sort((a, b) => b.usedAt.localeCompare(a.usedAt));
  }

  /** Records the use and lowers the child's points, in one atomic write. */
  async use(childId: string, points: number, note?: string): Promise<PointUsage> {
    const usage: PointUsage = { id: crypto.randomUUID(), childId, points, note, usedAt: new Date().toISOString() };
    await this.remote.update({
      [`pointUsage/${childId}/${usage.id}`]: encode(usage, 'createdAt'),
      [`points/${childId}`]: increment(-points),
    });
    return usage;
  }
}
