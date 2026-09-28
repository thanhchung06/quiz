import { Injectable } from '@angular/core';
import { HistoryResult, PlayResult, PlaySession } from '../../shared/models/domain.model';
import { increment, RemoteStore } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';

/** Full results kept per child (older ones are pruned; history keeps everything). */
export const RESULTS_KEPT = 500;

/**
 * Finished tries (specs/003 §2): results/{childId}/{id} (full detail, the last
 * RESULTS_KEPT) and history/{childId}/{id} (short, append-only, forever).
 */
@Injectable({ providedIn: 'root' })
export class ResultRepository {
  constructor(private readonly remote: RemoteStore) {}

  async getById(childId: string, id: string): Promise<PlayResult | undefined> {
    return decode<PlayResult>(await this.remote.get<StoredNode>(`results/${childId}/${id}`));
  }

  async resultsForChild(childId: string): Promise<PlayResult[]> {
    return this.readAll<PlayResult>(`results/${childId}`);
  }

  async historyForChild(childId: string): Promise<HistoryResult[]> {
    return this.readAll<HistoryResult>(`history/${childId}`);
  }

  async historyForAssignment(childId: string, assignmentId: string): Promise<HistoryResult[]> {
    return (await this.historyForChild(childId)).filter((h) => h.assignmentId === assignmentId);
  }

  /**
   * The finish (plan §4), one atomic write: the result and its history line,
   * the end of the session, the assignment gone when the child can't try it
   * again, and the child's points raised when the try counts.
   */
  async recordFinish(result: PlayResult, history: HistoryResult, session: PlaySession, removeAssignment: boolean): Promise<void> {
    const c = session.childId;
    const values: Record<string, unknown> = {
      [`results/${c}/${result.id}`]: encode(result, 'createdAt'),
      [`history/${c}/${history.id}`]: encode(history, 'createdAt'),
      [`sessions/${c}`]: null,
    };
    if (removeAssignment && session.assignmentId) values[`assignments/${c}/${session.assignmentId}`] = null;
    if (history.counted && history.pointsEarned > 0) values[`points/${c}`] = increment(history.pointsEarned);
    await this.remote.update(values);
    await this.prune(c);
  }

  /** Keeps the newest RESULTS_KEPT full results of a child. */
  private async prune(childId: string): Promise<void> {
    const all = await this.remote.list<StoredNode>(`results/${childId}`, { orderBy: 'createdAt' });
    const extra = all.length - RESULTS_KEPT;
    if (extra <= 0) return;
    await this.remote.update(Object.fromEntries(all.slice(0, extra).map((row) => [`results/${childId}/${row.key}`, null])));
  }

  private async readAll<T extends { attemptedAt: string }>(path: string): Promise<T[]> {
    return (await this.remote.list<StoredNode>(path))
      .map((row) => decode<T>(row.value))
      .filter((r): r is T => !!r)
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  }
}
