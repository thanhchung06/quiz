import { Injectable } from '@angular/core';
import { HistoryResult, PlayResult, PlaySession } from '../../shared/models/domain.model';
import { RemoteStore } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';
import { appendRow, lastRow, rowKey, rowNumber } from '../../remote/numbered-rows';
import { PointsRepository } from './points.repository';

/** Full results kept per child (the one RESULTS_KEPT tries back is removed by each finish; history keeps everything). */
export const RESULTS_KEPT = 1000;

/**
 * Finished tries (specs/003 §2), numbered per child: history/{childId}/{n}
 * (short, append-only, forever, with running totals) and results/{childId}/{n}
 * (full detail, the last RESULTS_KEPT) — one number for both, which is also
 * the record's id. Reads ask the server for just what they show (the last
 * row, a date range, one assignment's last try), never the whole history.
 */
@Injectable({ providedIn: 'root' })
export class ResultRepository {
  constructor(private readonly remote: RemoteStore) {}

  async getById(childId: string, id: string): Promise<PlayResult | undefined> {
    return decode<PlayResult>(await this.remote.get<StoredNode>(`results/${childId}/${id}`));
  }

  /** The kept full results (at most RESULTS_KEPT), newest first. */
  async resultsForChild(childId: string): Promise<PlayResult[]> {
    return this.rows<PlayResult>(`results/${childId}`);
  }

  /** The child's last try (it carries the running totals), if any. */
  async latestHistory(childId: string): Promise<HistoryResult | undefined> {
    return decode<HistoryResult>((await lastRow(this.remote, `history/${childId}`))?.value);
  }

  /** The last `count` tries, newest first. */
  async recentHistory(childId: string, count: number): Promise<HistoryResult[]> {
    return this.rows<HistoryResult>(`history/${childId}`, { limitToLast: count });
  }

  /** Tries written at or after `since`, newest first. */
  async historySince(childId: string, since: Date): Promise<HistoryResult[]> {
    return this.rows<HistoryResult>(`history/${childId}`, { orderBy: 'createdAt', startAt: since.getTime() });
  }

  /** The last try of an assignment (among equal values the server orders by key, so this is the newest). */
  async lastTryOfAssignment(childId: string, assignmentId: string): Promise<HistoryResult | undefined> {
    return (await this.rows<HistoryResult>(`history/${childId}`, { orderBy: 'assignmentId', equalTo: assignmentId, limitToLast: 1 }))[0];
  }

  /** The last practice try (no assignment) of an exercise. */
  async lastPracticeTry(childId: string, exerciseId: string): Promise<HistoryResult | undefined> {
    return (await this.rows<HistoryResult>(`history/${childId}`, { orderBy: 'practiceOf', equalTo: exerciseId, limitToLast: 1 }))[0];
  }

  /** Whether the full result of try `id` is still kept, given the child's last try. */
  static isKept(id: string, latest: HistoryResult | undefined): boolean {
    return !!latest && rowNumber(id) > rowNumber(latest.id) - RESULTS_KEPT;
  }

  /**
   * The finish (plan §4), one atomic write under the next number n: the
   * history row with its running totals, the result, the removal of result
   * n − RESULTS_KEPT, the end of the session, the assignment gone when the
   * child can't try it again, and the child's points set from the totals. If
   * another device took n first, it is all refused and done again at n + 1.
   * Returns the result as stored (its id is n).
   */
  async recordFinish(result: PlayResult, history: HistoryResult, session: PlaySession, removeAssignment: boolean): Promise<PlayResult> {
    const c = session.childId;
    let stored = result;
    await appendRow(this.remote, `history/${c}`, async (key, last) => {
      const totalEarned = PointsRepository.totalOf(last, 'totalEarned') + (history.counted ? history.pointsEarned : 0);
      const totalStars = PointsRepository.totalOf(last, 'totalStars') + history.stars;
      const totalUsed = PointsRepository.totalOf((await lastRow(this.remote, `pointUsage/${c}`))?.value, 'totalUsed');
      stored = { ...result, id: key };
      const values: Record<string, unknown> = {
        [`history/${c}/${key}`]: encode({ ...history, id: key }, 'createdAt', { totalEarned, totalStars, ...ResultRepository.lookupFields(history) }),
        [`results/${c}/${key}`]: encode(stored, 'createdAt'),
        [`sessions/${c}`]: null,
        [PointsRepository.path(c)]: totalEarned - totalUsed,
      };
      const dropped = rowNumber(key) - RESULTS_KEPT;
      if (dropped >= 1) values[`results/${c}/${rowKey(dropped)}`] = null;
      if (removeAssignment && session.assignmentId) values[`assignments/${c}/${session.assignmentId}`] = null;
      return values;
    });
    return stored;
  }

  /** The indexed fields a history row is looked up by: its assignment, or the exercise it practised. */
  static lookupFields(history: HistoryResult): Record<string, string> {
    return history.assignmentId ? { assignmentId: history.assignmentId } : { practiceOf: history.exerciseId };
  }

  private async rows<T>(path: string, query?: Parameters<RemoteStore['list']>[1]): Promise<T[]> {
    return (await this.remote.list<StoredNode>(path, query))
      .map((row) => decode<T>(row.value))
      .filter((r): r is T => !!r)
      .reverse();
  }
}
