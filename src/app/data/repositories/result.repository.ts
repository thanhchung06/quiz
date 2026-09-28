import { Injectable } from '@angular/core';
import { db } from '../db';
import { enqueue } from '../outbox';
import { HistoryResult, PlayResult, PlaySession } from '../../shared/models/domain.model';
import { JsonRecord, RESULT_CIRCLE_SIZE } from '../../sync/protocol';

/**
 * Finished tries (plan §3.4): the full Result (Google keeps the last
 * RESULT_CIRCLE_SIZE, and so does this device) and the short HistoryResult
 * (kept forever).
 */
@Injectable({ providedIn: 'root' })
export class ResultRepository {
  async getById(id: string): Promise<PlayResult | undefined> {
    return db.results.get(id);
  }

  async resultsForChild(childId: string): Promise<PlayResult[]> {
    const all = await db.results.where('childId').equals(childId).toArray();
    return all.sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  }

  async historyForChild(childId: string): Promise<HistoryResult[]> {
    const all = await db.historyResults.where('childId').equals(childId).toArray();
    return all.sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  }

  async historyForAssignment(assignmentId: string): Promise<HistoryResult[]> {
    return db.historyResults.where('assignmentId').equals(assignmentId).toArray();
  }

  /**
   * The finish request (plan §3.9), queued as one group: the result and its
   * history line, the end of the session, and — when the child can't try
   * again — the removal of the assignment.
   */
  async recordFinish(result: PlayResult, history: HistoryResult, session: PlaySession, removeAssignment: boolean): Promise<void> {
    // Plain Dexie promise chains inside transactions (no await on other promises), so the transaction stays open under zone.js.
    await db.transaction('rw', [db.results, db.historyResults, db.sessions, db.assignments], () =>
      db.results
        .put(result)
        .then(() => db.historyResults.put(history))
        .then(() => db.sessions.delete(session.childId))
        .then(() => (removeAssignment && session.assignmentId ? db.assignments.delete(session.assignmentId) : undefined)),
    );
    await enqueue(
      { op: 'INSERT_RESULT', result: result as unknown as JsonRecord },
      { op: 'APPEND_HISTORY', history: history as unknown as JsonRecord },
      { op: 'END_SESSION', childId: session.childId, sessionId: session.id },
      ...(removeAssignment && session.assignmentId
        ? [{ op: 'REMOVE_ASSIGNMENT' as const, childId: session.childId, assignmentId: session.assignmentId }]
        : []),
    );
  }

  /** Google gave `resultId` to this result: keep the same circle as Google (drop what id N − size replaced). */
  async setResultId(id: string, resultId: number): Promise<void> {
    await db.results.update(id, { resultId });
    await db.results.where('resultId').belowOrEqual(resultId - RESULT_CIRCLE_SIZE).delete();
  }
}
