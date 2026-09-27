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
import { DownloadApplierService } from '../../src/app/sync-engine/download-applier.service';
import { GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';
import { AnswerResult, Attempt, Category, Exercise, Profile, QuizItem } from '../../src/app/shared/models/domain.model';
import { SyncRunOptions, SyncScope } from '../../src/app/sync-engine/sync-client.service';
import { Uploader } from '../../src/app/sync-engine/upload-policy';

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
  const client = new SyncClientService(
    new BatchBuilderService(new ProfileRepository()),
    { sharedSecret: () => 'secret' } as unknown as GoogleAuthService,
    new DownloadApplierService(),
  );
  client.retryDelaysMs = [0, 0, 0];
  return client;
}

async function becomeDevice(id: string) {
  store.set('quiz-app.deviceId', id);
  await Promise.all(db.tables.map((t) => t.clear()));
}

const URL = 'https://script/exec';
const ALL: SyncScope[] = ['questions', 'data'];
const MOM: Uploader = { role: 'parent', profileId: 'mom' };
const KID: Uploader = { role: 'child', profileId: 'kid' };
/** What automatic sync does on app open (pull) and after changes (push). */
const autoPull = (extra: Partial<SyncRunOptions> = {}): SyncRunOptions => ({ scopes: ALL, push: false, pull: true, mode: 'changes', ...extra });
const autoPush = (uploader: Uploader): SyncRunOptions => ({ scopes: ALL, push: true, pull: false, mode: 'changes', uploader });
const mirror = (direction: 'push' | 'pull', uploader: Uploader | undefined = MOM, extra: Partial<SyncRunOptions> = {}): SyncRunOptions => ({
  scopes: ALL,
  push: direction === 'push',
  pull: direction === 'pull',
  mode: 'mirror',
  uploader,
  ...extra,
});

const category = (id: string, name: string): Category =>
  ({ ...newSyncEnvelope(id, 'x'), name, normalizedName: name.toLowerCase(), subject: 'math', status: 'active' }) as Category;
const question = (i: number, categoryId: string): QuizItem =>
  ({
    ...newSyncEnvelope(`q${i}`, 'pc'),
    subject: 'math', grade: 3, type: 'single-choice', prompt: `Câu ${i}: ${'nội dung dài '.repeat(20)}`,
    choices: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: [], difficulty: 2, points: 10, categoryId, shuffleChoices: true, reviewStatus: 'approved', status: 'active',
  }) as unknown as QuizItem;
const profile = (id: string, role: 'parent' | 'child', credentialHash = ''): Profile =>
  ({ ...newSyncEnvelope(id, 'x'), role, displayName: id, avatar: 'cat', credentialHash, preferences: { audioEnabled: true, reducedMotion: false, feedbackDelayMs: 0 }, createdAt: '' }) as Profile;
const attempt = (id: string, profileId: string): Attempt => ({ ...newSyncEnvelope(id, 'x'), profileId, exerciseId: 'ex', score: 5 }) as unknown as Attempt;
const answer = (id: string, attemptId: string): AnswerResult => ({ ...newSyncEnvelope(id, 'x'), attemptId, quizItemId: 'q0', isCorrect: true }) as unknown as AnswerResult;

/** What Google holds, read straight from the fake sheet through the script (DEBUG_DUMP). */
function google(tab: string): Record<string, { version: number; body: Record<string, unknown> }> {
  const text = doPost({ postData: { contents: JSON.stringify({ syncId: 'dump', sharedSecret: 'secret', action: 'DEBUG_DUMP', debugTabs: [tab] }) } } as never) as string;
  const rows = (JSON.parse(text).tabs[tab] ?? []) as Array<{ id: string; version: number; body: Record<string, unknown> }>;
  return Object.fromEntries(rows.map((r) => [r.id, { version: r.version, body: r.body }]));
}

describe('sync end to end (real Apps Script code, fake Sheet)', () => {
  beforeEach(() => sheets.clear());

  it('parent and child each upload only their own data; opening the app takes what differs from Google', async () => {
    // --- PC (parent): questions, an exercise assigned to a new child, both profiles
    await becomeDevice('pc');
    await db.profiles.bulkAdd([profile('mom', 'parent', 'mom-hash'), profile('kid', 'child'), profile('kid2', 'child')]);
    await db.categories.add(category('cat', 'Phân số'));
    await db.quizItems.bulkAdd(Array.from({ length: 450 }, (_, i) => question(i, 'cat')));
    await db.exercises.add({ ...newSyncEnvelope('ex', 'pc'), title: 'Bài 1', items: [] } as unknown as Exercise);
    await db.assignments.add({ ...newSyncEnvelope('as1', 'pc'), profileId: 'kid', exerciseId: 'ex', isPrimary: false } as never);
    const pc = syncClient();
    // The first upload's answer is lost in transit: the retry (same syncId) must replay, not write twice.
    requestCount = 0;
    loseResponseOfRequest = 1;
    expect(await pc.run(URL, autoPush(MOM))).toBe('success');
    loseResponseOfRequest = -1;
    expect(Object.keys(google('QuizItem'))).toHaveLength(450);
    expect(Object.keys(google('Profile')).sort()).toEqual(['kid', 'kid2', 'mom']); // new child profiles go up with the parent
    expect(google('Profile')['mom'].body['credentialHash']).toBeUndefined();
    expect((await db.quizItems.toArray()).every((q) => q.syncStatus === 'synced')).toBe(true);

    // --- Tablet: opening the app takes everything
    await becomeDevice('tablet');
    const tablet = syncClient();
    expect(await tablet.run(URL, autoPull())).toBe('success');
    expect(await db.quizItems.count()).toBe(450);
    expect(tablet.received()).toBe(450 + 1 + 3 + 1 + 1);

    // Opening again with nothing new: one INDEX per scope, nothing fetched.
    requestCount = 0;
    expect(await tablet.run(URL, autoPull())).toBe('success');
    expect(requestCount).toBe(2);
    expect(tablet.received()).toBe(0);

    // The child plays: their own results go up; another child's results and a question edit don't.
    await db.attempts.bulkAdd([attempt('a-kid', 'kid'), attempt('a-kid2', 'kid2')]);
    await db.answerResults.bulkAdd([answer('r-kid', 'a-kid'), answer('r-kid2', 'a-kid2')]);
    await new QuizItemRepository().update('q5', { prompt: 'bé sửa' });
    await db.profiles.update('kid', { avatar: 'dog', localVersion: 2, syncStatus: 'pendingUpload' });
    expect(await tablet.run(URL, autoPush(KID))).toBe('success');
    expect(Object.keys(google('Attempt'))).toEqual(['a-kid']);
    expect(Object.keys(google('AnswerResult'))).toEqual(['r-kid']);
    expect(google('Profile')['kid'].body['avatar']).toBe('dog');
    expect(google('QuizItem')['q5'].body['prompt']).not.toBe('bé sửa');
    expect((await db.attempts.get('a-kid2'))?.syncStatus).toBe('pendingUpload');

    // --- PC: opening takes the child's results; the parent's own unsent edit is kept, then goes up.
    await becomeDevice('pc');
    await db.profiles.add(profile('mom', 'parent', 'mom-hash'));
    expect(await pc.run(URL, autoPull())).toBe('success');
    expect((await db.attempts.get('a-kid'))?.score).toBe(5);
    expect((await db.profiles.get('mom'))?.credentialHash).toBe('mom-hash'); // the login hash stays
    await new QuizItemRepository().update('q1', { prompt: 'mẹ sửa' });
    await db.quizItems.add(question(450, 'cat'));
    await db.attempts.update('a-kid', { score: 99, syncStatus: 'pendingUpload', localVersion: 5 }); // the parent never uploads results
    expect(await pc.run(URL, autoPull())).toBe('success');
    expect((await db.quizItems.get('q1'))?.prompt).toBe('mẹ sửa'); // pending: not overwritten
    expect(await pc.run(URL, autoPush(MOM))).toBe('success');
    expect(google('QuizItem')['q1'].body['prompt']).toBe('mẹ sửa');
    expect(google('Attempt')['a-kid'].body['score']).toBe(5);

    // --- Tablet with "only newly added questions": gets q450, ignores the edit of q1; keeps its own local data.
    await becomeDevice('tablet');
    await db.quizItems.bulkAdd(Array.from({ length: 450 }, (_, i) => question(i, 'cat')).map((q) => ({ ...q, syncStatus: 'synced', lastGoogleVersion: 1 }) as QuizItem));
    await db.attempts.add({ ...attempt('local-only', 'kid2'), syncStatus: 'synced' } as Attempt);
    expect(await tablet.run(URL, autoPull({ addedQuestionsOnly: true }))).toBe('success');
    expect(await db.quizItems.get('q450')).toBeDefined();
    expect((await db.quizItems.get('q1'))?.prompt).not.toBe('mẹ sửa');
    expect(await db.attempts.get('local-only')).toBeDefined(); // automatic sync never deletes local records
    expect(await tablet.run(URL, autoPull())).toBe('success');
    expect((await db.quizItems.get('q1'))?.prompt).toBe('mẹ sửa');
  }, 180_000);

  it('"Đồng bộ ngay" mirrors the chosen direction: no conflicts, children\'s results never removed by the parent', async () => {
    // --- PC: everything up
    await becomeDevice('pc');
    await db.profiles.add(profile('mom', 'parent', 'mom-hash'));
    await db.categories.add(category('cat', 'Phân số'));
    await db.quizItems.bulkAdd(Array.from({ length: 30 }, (_, i) => question(i, 'cat')));
    const pc = syncClient();
    expect(await pc.run(URL, mirror('push'))).toBe('success');
    expect(pc.lastSummary()).toEqual(expect.objectContaining({ sent: 32, toSend: 32, removed: 0 }));

    // A child's result reaches Google from the tablet.
    await becomeDevice('tablet');
    await db.attempts.add(attempt('a-kid', 'kid'));
    const tablet = syncClient();
    expect(await tablet.run(URL, autoPush(KID))).toBe('success');

    // --- Phone: takes everything; its own question disappears, its profile and a child's unsent result stay.
    await becomeDevice('phone');
    await db.profiles.add(profile('kid3', 'child', 'pin'));
    await db.quizItems.add(question(999, 'cat'));
    await db.attempts.add(attempt('unsent', 'kid3'));
    const phone = syncClient();
    expect(await phone.run(URL, mirror('pull'))).toBe('success');
    expect(await db.quizItems.get('q999')).toBeUndefined();
    expect(await db.quizItems.count()).toBe(30);
    expect(await db.attempts.get('a-kid')).toBeDefined();
    expect(await db.attempts.get('unsent')).toBeDefined(); // only kid3 may upload it
    expect((await db.profiles.get('kid3'))?.credentialHash).toBe('pin');
    expect(phone.lastSummary()).toEqual(expect.objectContaining({ removed: 1 }));

    // PC edits q1 and uploads; the phone's mirror push still wins, with no conflict, and prunes q2 —
    // but not the child's attempt, which the phone (parent) doesn't hold as its own.
    await becomeDevice('pc');
    expect(await pc.run(URL, mirror('pull'))).toBe('success');
    await new QuizItemRepository().update('q1', { prompt: 'bản của PC' });
    expect(await pc.run(URL, autoPush(MOM))).toBe('success');

    await becomeDevice('phone');
    expect(await phone.run(URL, mirror('pull'))).toBe('success');
    await new QuizItemRepository().update('q1', { prompt: 'bản của điện thoại' });
    await db.quizItems.update('q1', { lastGoogleVersion: 1 }); // stale — would once have been a conflict
    await db.quizItems.delete('q2');
    await db.attempts.clear();
    expect(await phone.run(URL, mirror('push'))).toBe('success');
    expect(phone.lastSummary()).toEqual(expect.objectContaining({ removed: 1 }));
    expect(google('QuizItem')['q1'].body['prompt']).toBe('bản của điện thoại');
    expect(google('QuizItem')['q2'].body['deletedAt']).toBeTruthy();
    expect(google('Attempt')['a-kid'].body['deletedAt']).toBeUndefined();

    // Mirror with only newly added questions: nothing pruned, nothing updated.
    await becomeDevice('pc');
    expect(await pc.run(URL, mirror('pull'))).toBe('success');
    expect((await db.quizItems.get('q1'))?.prompt).toBe('bản của điện thoại');
    expect((await db.quizItems.get('q2'))?.deletedAt).toBeTruthy();
    await db.quizItems.delete('q3');
    await db.quizItems.add(question(31, 'cat'));
    expect(await pc.run(URL, mirror('push', MOM, { scopes: ['questions'], addedQuestionsOnly: true }))).toBe('success');
    expect(pc.lastSummary()).toEqual(expect.objectContaining({ sent: 1, removed: 0 }));
    expect(google('QuizItem')['q3'].body['deletedAt']).toBeUndefined();
  }, 180_000);
});
