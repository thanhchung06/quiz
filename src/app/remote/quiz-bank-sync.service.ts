import { Injectable, signal } from '@angular/core';
import { Table } from 'dexie';
import { db } from '../data/db';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { Category, QuizItem } from '../shared/models/domain.model';
import { RemoteStore } from './remote-store';
import { decode, StoredNode } from './record-codec';

/** Records per request while pulling. */
const PAGE = 1000;

/**
 * Keeps this device's copy of the quiz bank (questions, categories) up to date
 * (specs/003-firebase/plan.md §3): at app start one small read of
 * meta/quizVersion; only if it moved are the questions and categories newer
 * than the last pull downloaded, page by page.
 */
@Injectable({ providedIn: 'root' })
export class QuizBankSyncService {
  private readonly _received = signal(0);
  /** Questions/categories received by the running (or last) pull. */
  readonly received = this._received.asReadonly();

  constructor(
    private readonly remote: RemoteStore,
    private readonly settings: AppSettingsRepository,
  ) {}

  /** Returns false when the device was already up to date (nothing pulled). */
  async sync(): Promise<boolean> {
    this._received.set(0);
    const version = await this.remote.get<number>('meta/quizVersion');
    const settings = await this.settings.get();
    if (version !== undefined && version === settings.quizVersion) return false;
    let pulledAt = settings.quizPulledAt ?? 0;
    pulledAt = Math.max(pulledAt, await this.pull('categories', db.categories, settings.quizPulledAt ?? 0));
    pulledAt = Math.max(pulledAt, await this.pull('questions', db.quizItems, settings.quizPulledAt ?? 0));
    // The version read before pulling: a write made meanwhile moves it again, and the next start pulls that.
    await this.settings.update({ quizVersion: version, quizPulledAt: pulledAt });
    return true;
  }

  /** "Tải lại toàn bộ câu hỏi": empties the local copy and downloads everything again. */
  async reloadAll(): Promise<void> {
    await db.categories.clear();
    await db.quizItems.clear();
    await this.settings.update({ quizVersion: undefined, quizPulledAt: 0 });
    await this.sync();
  }

  /** Questions an exercise needs that this device doesn't have (returns how many were found). */
  async fetchQuestions(ids: string[]): Promise<number> {
    const records = (await Promise.all(ids.map((id) => this.remote.get<StoredNode>(`questions/${id}`)))).map((node) => decode<QuizItem>(node));
    const found = records.filter((q): q is QuizItem => !!q);
    await db.quizItems.bulkPut(found);
    return found.length;
  }

  /** Pulls the records of `path` written after `after` (server ms); returns the newest time seen. */
  private async pull<T extends Category | QuizItem>(path: 'categories' | 'questions', table: Table<T, string>, after: number): Promise<number> {
    let cursor = { at: after, key: undefined as string | undefined };
    for (;;) {
      const page = await this.remote.list<StoredNode>(path, {
        orderBy: 'updatedAt',
        startAfter: cursor.at,
        startAfterKey: cursor.key,
        limitToFirst: PAGE,
      });
      const records = page.map((row) => decode<T>(row.value)).filter((r): r is T => !!r);
      await table.bulkPut(records);
      this._received.update((n) => n + records.length);
      if (page.length > 0) {
        const last = page[page.length - 1];
        cursor = { at: (last.value.updatedAt as number) ?? cursor.at, key: last.key };
      }
      if (page.length < PAGE) return cursor.at;
    }
  }
}
