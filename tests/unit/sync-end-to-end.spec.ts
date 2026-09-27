/**
 * @jest-environment node
 *
 * Runs the real Apps Script sync code (apps-script/src) against an in-memory
 * spreadsheet with Google's 50,000-characters-per-cell limit, driven by the
 * app's real SyncClientService over a fake fetch — two "devices" in turn.
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';

// --- browser bits the app code touches -------------------------------------
const store = new Map<string, string>();
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

// --- fake Apps Script runtime ------------------------------------------------
function fakeSheet() {
  const grid: unknown[][] = [];
  const nonEmpty = (v: unknown) => v !== '' && v !== undefined && v !== null;
  return {
    getLastRow: () => {
      for (let r = grid.length; r > 0; r--) if ((grid[r - 1] ?? []).some(nonEmpty)) return r;
      return 0;
    },
    getLastColumn: () => grid.reduce((m, row) => Math.max(m, row.reduce((c, v, i) => (nonEmpty(v) ? i + 1 : c), 0)), 0),
    getRange: (row: number, col: number, numRows = 1, numCols = 1) => ({
      getValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => grid[row - 1 + r]?.[col - 1 + c] ?? '')),
      setValues: (values: unknown[][]) =>
        values.forEach((vals, r) =>
          vals.forEach((v, c) => {
            if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
            (grid[row - 1 + r] ??= [])[col - 1 + c] = v;
          }),
        ),
    }),
    appendRow: (values: unknown[]) => grid.push(values),
  };
}
const sheets = new Map<string, ReturnType<typeof fakeSheet>>();
const spreadsheet = {
  getSheetByName: (name: string) => sheets.get(name) ?? null,
  insertSheet: (name: string) => (sheets.set(name, fakeSheet()), sheets.get(name)!),
};
Object.assign(globalThis, {
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'secret' }) },
  ContentService: { createTextOutput: (text: string) => ({ setMimeType: () => text }), MimeType: { JSON: 'json' } },
});

import { doPost } from '../../apps-script/src/main';
import { db } from '../../src/app/data/db';
import { SyncClientService } from '../../src/app/sync-engine/sync-client.service';
import { BatchBuilderService } from '../../src/app/sync-engine/batch-builder.service';
import { ProfileRepository } from '../../src/app/data/repositories/profile.repository';
import { ConflictStateService } from '../../src/app/sync-engine/conflict-state.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { DownloadApplierService } from '../../src/app/sync-engine/download-applier.service';
import { GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';
import { Category, QuizItem } from '../../src/app/shared/models/domain.model';

global.fetch = jest.fn(async (_url, init) => {
  const text = doPost({ postData: { contents: String(init?.body) } } as never) as string;
  return { text: async () => text } as Response;
}) as unknown as typeof fetch;

/** When set, this request number is processed by the script but its response is lost in transit. */
let requestCount = 0;
let loseResponseOfRequest = -1;
const scriptFetch = global.fetch;
global.fetch = jest.fn(async (url, init) => {
  requestCount++;
  const response = await (scriptFetch as typeof fetch)(url, init);
  if (requestCount === loseResponseOfRequest) throw new TypeError('Failed to fetch');
  return response;
}) as unknown as typeof fetch;

function syncClient() {
  const conflicts = new ConflictStateService();
  const client = new SyncClientService(
      new BatchBuilderService(new ProfileRepository()),
      { sharedSecret: () => 'secret' } as unknown as GoogleAuthService,
      conflicts,
      new AppSettingsRepository(),
      new DownloadApplierService(),
  );
  client.retryDelaysMs = [0, 0, 0];
  return { client, conflicts };
}

async function becomeDevice(id: string) {
  store.set('quiz-app.deviceId', id);
  await Promise.all(db.tables.map((t) => t.clear()));
}

const category = (id: string, name: string): Category =>
  ({ ...newSyncEnvelope(id, 'x'), name, normalizedName: name.toLowerCase(), subject: 'math', status: 'active' }) as Category;
const question = (i: number, categoryId: string): QuizItem =>
  ({
    ...newSyncEnvelope(`q${i}`, 'pc'),
    subject: 'math', grade: 3, type: 'single-choice', prompt: `Câu ${i}: ${'nội dung dài '.repeat(20)}`,
    choices: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: [], difficulty: 2, points: 10, categoryId, shuffleChoices: true, reviewStatus: 'approved', status: 'active',
  }) as unknown as QuizItem;

describe('sync end to end (real Apps Script code, fake Sheet)', () => {
  it('first sync of 300+ records, edits afterwards, then a second device pulls everything without duplicate categories', async () => {
    // --- PC: 320 questions, one already edited twice before its first sync
    await becomeDevice('pc');
    await db.categories.add(category('pc-cat-phan-so', 'Phân số'));
    await db.quizItems.bulkAdd(Array.from({ length: 320 }, (_, i) => question(i, 'pc-cat-phan-so')));
    const repo = new QuizItemRepository();
    await repo.update('q0', { prompt: 'sửa lần 1' });
    await repo.update('q0', { prompt: 'sửa lần 2' }); // localVersion 3

    const pc = syncClient();
    // Request 1 is the pull; request 2, the first upload batch, commits on Google but its answer is lost.
    // The retry re-sends the same syncId, so the script must replay its stored result — not report conflicts.
    requestCount = 0;
    loseResponseOfRequest = 2;
    expect(await pc.client.syncNormally('https://script/exec')).toBe('success');
    loseResponseOfRequest = -1;
    expect(pc.conflicts.hasUnresolvedConflicts()).toBe(false);
    expect(await db.quizItems.where('id').anyOf(['q0', 'q319']).toArray()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'q0', syncStatus: 'synced', lastGoogleVersion: 3 })]),
    );
    expect((await db.quizItems.toArray()).every((q) => q.syncStatus === 'synced')).toBe(true);

    // Editing again after the first sync must not be rejected (Google version must match the client's).
    await repo.update('q0', { prompt: 'sửa lần 3' });
    expect(await pc.client.syncNormally('https://script/exec')).toBe('success');
    expect(pc.client.progress()).toEqual({ sent: 1, total: 1 }); // only the edited question goes up
    expect((await db.quizItems.get('q0'))?.syncStatus).toBe('synced');

    // --- Phone: fresh install that seeded its own "Phân số"
    await becomeDevice('phone');
    await db.categories.add(category('default-math-phan-so', 'Phân số'));
    const phone = syncClient();
    expect(await phone.client.syncNormally('https://script/exec')).toBe('success');

    expect(await db.quizItems.count()).toBe(320);
    expect((await db.quizItems.get('q0'))?.prompt).toBe('sửa lần 3');
    const cats = (await db.categories.toArray()).filter((c) => !c.deletedAt);
    expect(cats.map((c) => c.id)).toEqual(['pc-cat-phan-so']); // one shared category, not two
    expect(phone.conflicts.hasUnresolvedConflicts()).toBe(false);
    expect(phone.client.received()).toBeGreaterThanOrEqual(321);

    // A second sync on the phone has nothing to send and nothing new to receive.
    expect(await phone.client.syncNormally('https://script/exec')).toBe('success');
    expect(phone.client.received()).toBe(0);
    expect(phone.client.progress()).toEqual({ sent: 0, total: 0 });
  }, 180_000);
});
