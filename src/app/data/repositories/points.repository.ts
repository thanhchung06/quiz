import { Injectable } from '@angular/core';
import { RemoteStore } from '../../remote/remote-store';
import { lastRow } from '../../remote/numbered-rows';

/**
 * A child's spendable points (specs/003 §2), stored on the profile
 * (profiles/{childId}/points). They are never added to or taken from: every
 * finish and every point use sets them to totalEarned (the last history row)
 * − totalUsed (the last point use), so they can always be checked against
 * those two rows.
 */
@Injectable({ providedIn: 'root' })
export class PointsRepository {
  constructor(private readonly remote: RemoteStore) {}

  static path(childId: string): string {
    return `profiles/${childId}/points`;
  }

  async get(childId: string): Promise<number> {
    return (await this.remote.get<number>(PointsRepository.path(childId))) ?? 0;
  }

  async set(childId: string, points: number): Promise<void> {
    await this.remote.update({ [PointsRepository.path(childId)]: points });
  }

  /** Counted points of all the child's tries (the last history row's running total). */
  async totalEarned(childId: string): Promise<number> {
    return PointsRepository.totalOf((await lastRow(this.remote, `history/${childId}`))?.value, 'totalEarned');
  }

  /** Points the parent has used (the last point use's running total). */
  async totalUsed(childId: string): Promise<number> {
    return PointsRepository.totalOf((await lastRow(this.remote, `pointUsage/${childId}`))?.value, 'totalUsed');
  }

  static totalOf(row: Record<string, unknown> | undefined, field: 'totalEarned' | 'totalStars' | 'totalUsed'): number {
    const value = row?.[field];
    return typeof value === 'number' ? value : 0;
  }
}
