import { Injectable, signal } from '@angular/core';
import { db } from '../data/db';
import { OutboxEntry } from '../shared/models/domain.model';
import { nextSyncHash, RESULT_CIRCLE_SIZE, OpResult, SequencedSheet, SyncOp } from './protocol';
import { batchBySize, sendWrite, SyncError } from './sync-transport';

const TABLE_OF: Record<SequencedSheet, 'profiles' | 'categories' | 'quizItems' | 'exercises'> = {
  Profile: 'profiles',
  Category: 'categories',
  QuizItem: 'quizItems',
  Exercise: 'exercises',
};

/**
 * Sends queued writes (the outbox) to Google in order, right after they are
 * queued, and stores what Google gives back (updateSequence, result id, row).
 * A failure stops the queue and shows `error` — the app blocks with a "Thử
 * lại" button (SyncBlockerComponent) until a retry gets everything through
 * (plan §1: no offline while sync is on).
 */
@Injectable({ providedIn: 'root' })
export class SyncWriterService {
  private readonly _error = signal<string | undefined>(undefined);
  private readonly _pending = signal(0);
  /** Why the last send failed; undefined while all is well. */
  readonly error = this._error.asReadonly();
  /** Operations still waiting to reach Google. */
  readonly pending = this._pending.asReadonly();

  private running?: Promise<void>;
  private again = false;
  private watching = false;

  /** Sends whatever the outbox holds now, and again after every new write. */
  start(): void {
    if (this.watching) return;
    this.watching = true;
    db.outbox.hook('creating', () => {
      // After the adding transaction commits.
      setTimeout(() => void this.flush().catch(() => undefined), 0);
    });
    void this.flush().catch(() => undefined);
  }

  /** Sends until the outbox is empty; rejects (and sets `error`) when a send fails. Concurrent calls share one run. */
  flush(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.drain().finally(() => (this.running = undefined));
    return this.running;
  }

  /** "Thử lại". */
  retry(): Promise<void> {
    this._error.set(undefined);
    const waiters = this.retryWaiters.splice(0);
    const run = this.flush();
    waiters.forEach((resolve) => resolve());
    return run;
  }

  private readonly retryWaiters: Array<() => void> = [];

  /** Resolves once everything queued so far has reached Google, waiting through failures until a "Thử lại" gets it through. */
  async settle(): Promise<void> {
    for (;;) {
      try {
        await this.flush();
        return;
      } catch {
        await new Promise<void>((resolve) => this.retryWaiters.push(resolve));
      }
    }
  }

  /**
   * Sends these operations now (not through the outbox) — for "Đồng bộ ngay",
   * with progress. Results are applied locally like queued ones.
   */
  async sendNow(ops: SyncOp[], onProgress?: (sent: number) => void): Promise<OpResult[]> {
    const results: OpResult[] = [];
    for (const batch of batchBySize(ops)) {
      const response = await sendWrite(batch);
      const batchResults = response.results ?? [];
      await this.applyResults(batch, batchResults);
      await this.noteWrite(response.writeId);
      results.push(...batchResults);
      onProgress?.(results.length);
    }
    return results;
  }

  private async drain(): Promise<void> {
    do {
      this.again = false;
      for (;;) {
        const queued = await db.outbox.orderBy('seq').toArray();
        this._pending.set(queued.length);
        if (queued.length === 0) break;
        const [batch] = batchBySize(queued, undefined, undefined) as OutboxEntry[][];
        try {
          const response = await sendWrite(batch.map((entry) => entry.op));
          await this.applyResults(
            batch.map((entry) => entry.op),
            response.results ?? [],
          );
          await this.noteWrite(response.writeId);
          await db.outbox.bulkDelete(batch.map((entry) => entry.seq!));
          this._error.set(undefined);
        } catch (error) {
          this._error.set(error instanceof SyncError ? error.message : String(error));
          throw error;
        }
      }
    } while (this.again);
    this._pending.set(0);
  }

  /**
   * After a write that changed something: extend this device's hash chain with
   * its id, as Google did. If another device wrote in between, Google's chain
   * also holds that write, the two hashes differ, and the next app start pulls.
   */
  private async noteWrite(writeId: string | undefined): Promise<void> {
    if (!writeId) return;
    const settings = await db.appSettings.get('singleton');
    if (settings) await db.appSettings.update('singleton', { syncHash: nextSyncHash(settings.syncHash, writeId) });
  }

  /** Stores on the local copies what Google handed out for them. */
  private async applyResults(ops: SyncOp[], results: OpResult[]): Promise<void> {
    for (const [i, op] of ops.entries()) {
      const result = results[i];
      if (!result) continue;
      if (op.op === 'WRITE_RECORD' && result.updateSequence !== undefined) {
        await (db[TABLE_OF[op.sheet]] as unknown as { update(id: string, c: object): Promise<number> }).update(op.record.id, {
          updateSequence: result.updateSequence,
        });
      } else if (op.op === 'SET_TOTAL_POINTS' && result.updateSequence !== undefined) {
        await db.profiles.update(op.profileId, { updateSequence: result.updateSequence });
      } else if (op.op === 'INSERT_RESULT' && result.resultId !== undefined) {
        await db.results.update(op.result.id, { resultId: result.resultId });
        await db.results.where('resultId').belowOrEqual(result.resultId - RESULT_CIRCLE_SIZE).delete();
      } else if (op.op === 'APPEND_HISTORY' && result.row !== undefined) {
        await db.historyResults.update(op.history.id, { row: result.row });
      } else if (op.op === 'APPEND_POINT_USAGE' && result.row !== undefined) {
        await db.pointUsages.update(op.usage.id, { row: result.row });
      }
    }
  }
}
