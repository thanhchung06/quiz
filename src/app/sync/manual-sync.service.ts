import { Injectable, signal } from '@angular/core';
import { db } from '../data/db';
import { JsonRecord, SequencedSheet, SyncOp } from './protocol';
import { SyncReaderService } from './sync-reader.service';
import { SyncWriterService } from './sync-writer.service';
import { sendPing, SyncError } from './sync-transport';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';

export interface ManualSyncOptions {
  direction: 'push' | 'pull';
  skipQuestions: boolean;
  /** Push: only questions/categories never uploaded; pull: only those not on this device. Never updates or deletes them. */
  addedQuestionsOnly: boolean;
}

export interface ManualSyncSummary {
  ok: boolean;
  options: ManualSyncOptions;
  sent: number;
  toSend: number;
  received: number;
  removed: number;
  seconds: number;
  error?: string;
}

/**
 * "Đồng bộ ngay" (plan §5): one direction per run, everything rather than
 * just what changed.
 * - Máy này → Google: every local record goes up (safe to repeat — Google
 *   skips a UUID it already has); for questions, categories and exercises,
 *   what Google has and this device doesn't is marked deleted.
 * - Google → máy này: everything is read again from the start and overwrites
 *   this device; local records Google doesn't have are removed (never profiles).
 */
@Injectable({ providedIn: 'root' })
export class ManualSyncService {
  private readonly _progress = signal<{ sent: number; total: number } | undefined>(undefined);
  private readonly _summary = signal<ManualSyncSummary | undefined>(undefined);
  readonly progress = this._progress.asReadonly();
  readonly summary = this._summary.asReadonly();
  readonly received: SyncReaderService['received'];

  constructor(
    private readonly reader: SyncReaderService,
    private readonly writer: SyncWriterService,
    private readonly settings: AppSettingsRepository,
  ) {
    this.received = reader.received;
  }

  async run(options: ManualSyncOptions): Promise<ManualSyncSummary> {
    const started = Date.now();
    this._progress.set(undefined);
    let summary: ManualSyncSummary = { ok: true, options, sent: 0, toSend: 0, received: 0, removed: 0, seconds: 0 };
    try {
      await this.writer.flush();
      if (options.direction === 'push') {
        const { ops, prunes } = await this.pushOps(options);
        const total = ops.length + prunes.length;
        this._progress.set({ sent: 0, total });
        summary.toSend = ops.length;
        const results = await this.writer.sendNow([...ops, ...prunes], (sent) => this._progress.set({ sent, total }));
        summary.sent = Math.min(results.length, ops.length);
        summary.removed = results.reduce((sum, r) => sum + (r.removed ?? 0), 0);
      } else {
        const remote = (await sendPing()).syncId;
        await this.reader.pull({
          questions: !options.skipQuestions,
          addedQuestionsOnly: options.addedQuestionsOnly,
          exercises: true,
          mirror: true,
        });
        summary.received = this.reader.received();
        summary.removed = this.reader.removed();
        // A partial pull (without questions, or only new ones) doesn't make this device up to date.
        await this.settings.update({ lastSyncId: options.skipQuestions || options.addedQuestionsOnly ? undefined : remote });
      }
    } catch (error) {
      summary = { ...summary, ok: false, error: error instanceof SyncError ? error.message : String(error) };
      if (options.direction === 'push') summary.sent = this._progress()?.sent ?? 0;
    }
    summary.seconds = Math.round((Date.now() - started) / 1000);
    this._summary.set(summary);
    return summary;
  }

  private async pushOps(options: ManualSyncOptions): Promise<{ ops: SyncOp[]; prunes: SyncOp[] }> {
    const ops: SyncOp[] = [];
    const prunes: SyncOp[] = [];
    const records = async (sheet: SequencedSheet, table: 'profiles' | 'categories' | 'quizItems' | 'exercises', addedOnly: boolean, prune: boolean) => {
      const all = (await db[table].toArray()) as unknown as JsonRecord[];
      const selected = addedOnly ? all.filter((r) => r['updateSequence'] === undefined) : all;
      ops.push(...selected.map((record): SyncOp => ({ op: 'WRITE_RECORD', sheet, record })));
      if (prune && !addedOnly) prunes.push({ op: 'PRUNE', sheet, keepIds: all.map((r) => r.id) });
    };

    await records('Profile', 'profiles', false, false);
    if (!options.skipQuestions) {
      await records('Category', 'categories', options.addedQuestionsOnly, true);
      await records('QuizItem', 'quizItems', options.addedQuestionsOnly, true);
    }
    await records('Exercise', 'exercises', false, true);
    for (const assignment of await db.assignments.toArray()) {
      ops.push({ op: 'ADD_ASSIGNMENT', childId: assignment.childId, assignment: assignment as unknown as JsonRecord });
    }
    for (const history of await db.historyResults.toArray()) ops.push({ op: 'APPEND_HISTORY', history: history as unknown as JsonRecord });
    for (const usage of await db.pointUsages.toArray()) ops.push({ op: 'APPEND_POINT_USAGE', usage: usage as unknown as JsonRecord });
    const results = (await db.results.toArray()).sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
    for (const result of results) ops.push({ op: 'INSERT_RESULT', result: result as unknown as JsonRecord });
    for (const profile of await db.profiles.toArray()) {
      if (profile.role === 'child') ops.push({ op: 'SET_TOTAL_POINTS', profileId: profile.id, totalPoints: profile.totalPoints ?? 0 });
    }
    return { ops, prunes };
  }
}
