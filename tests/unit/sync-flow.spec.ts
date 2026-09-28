/**
 * @jest-environment node
 *
 * The redesigned sync end to end (specs/002-sync-data-redesign/plan.md): the
 * app's real repositories and sync services, over a fake fetch, against the
 * real Apps Script code on an in-memory sheet — several "devices" in turn
 * (each one clears the local database and takes another device id).
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { resetSheets } from '../support/fake-apps-script';

// --- browser bits the app code touches -------------------------------------
const store = new Map<string, string>([
  ['quiz-app.syncEndpoint', 'https://script/exec'],
  ['quiz-app.sharedSecret', 'secret'],
]);
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

import { doPost, handle } from '../../apps-script/src/main';
import { db } from '../../src/app/data/db';
import { transportOptions } from '../../src/app/sync/sync-transport';
import { SyncWriterService } from '../../src/app/sync/sync-writer.service';
import { SyncReaderService } from '../../src/app/sync/sync-reader.service';
import { StartupSyncService } from '../../src/app/sync/startup-sync.service';
import { ManualSyncService } from '../../src/app/sync/manual-sync.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { ProfileRepository } from '../../src/app/data/repositories/profile.repository';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { ExerciseRepository } from '../../src/app/data/repositories/exercise.repository';
import { AssignmentRepository } from '../../src/app/data/repositories/assignment.repository';
import { PlaySessionRepository } from '../../src/app/data/repositories/play-session.repository';
import { ResultRepository } from '../../src/app/data/repositories/result.repository';
import { PointUsageRepository } from '../../src/app/data/repositories/point-usage.repository';
import { PointsService } from '../../src/app/features/rewards/services/points.service';
import { AttemptResolverService } from '../../src/app/features/child-play/services/attempt-resolver.service';
import { PlayService } from '../../src/app/features/child-play/services/play.service';
import { seedFixedProfiles, CHILD_ONE_ID as KID, CHILD_TWO_ID as KID2 } from '../../src/app/data/seed';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';
import { Exercise, QuizItem } from '../../src/app/shared/models/domain.model';
import { JsonRecord, ReadSpec, SyncResponse } from '../../src/app/sync/protocol';

/** When set, this request number is processed by the script but its answer is lost in transit. */
let requestCount = 0;
let loseAnswerOf = -1;
global.fetch = jest.fn(async (_url, init) => {
  requestCount++;
  const text = doPost({ postData: { contents: String(init?.body) } } as never) as string;
  if (requestCount === loseAnswerOf) throw new TypeError('Failed to fetch');
  return { status: 200, text: async () => text } as Response;
}) as unknown as typeof fetch;
transportOptions.retryDelaysMs = [0, 0, 0];

// --- the app, wired by hand ---------------------------------------------------
const settings = new AppSettingsRepository();
const profiles = new ProfileRepository();
const quizItems = new QuizItemRepository();
const categories = new CategoryRepository(quizItems);
const exercises = new ExerciseRepository();
const assignments = new AssignmentRepository();
const sessions = new PlaySessionRepository();
const results = new ResultRepository();
const usages = new PointUsageRepository();
const writer = new SyncWriterService();
const reader = new SyncReaderService();
const points = new PointsService(profiles, reader, writer);
const play = new PlayService(new AttemptResolverService(quizItems, reader), sessions, assignments, results, points);
const startup = new StartupSyncService(settings, reader, writer);
const manual = new ManualSyncService(reader, writer);
writer.start();

/** Starts a fresh install on another device: empty database, sync on (questions pulled only when asked). */
async function becomeDevice(id: string, options: { questions?: boolean; addedOnly?: boolean } = {}) {
  await writer.settle();
  store.set('quiz-app.deviceId', id);
  await Promise.all(db.tables.map((t) => t.clear()));
  await settings.update({
    autoSyncEnabled: true,
    autoSyncQuestions: options.questions ?? false,
    autoSyncAddedQuestionsOnly: options.addedOnly ?? false,
    autoSyncExercises: true,
  });
}

async function openApp() {
  await startup.run();
  expect(startup.error()).toBeUndefined();
  expect(startup.state()).toBe('done');
}

function google(read: ReadSpec): JsonRecord[] {
  const response = handle({ action: 'READ', sharedSecret: 'secret', deviceId: 'test', read }) as Extract<SyncResponse, { ok: true }>;
  return response.records ?? [];
}

const question = (i: number): QuizItem =>
  ({
    ...newSyncEnvelope(`q${i}`, 'pc'),
    subject: 'math', grade: 3, type: 'single-choice', prompt: `Câu ${i}`,
    choices: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: ['t'], difficulty: 2, points: 10, categoryId: 'cat', shuffleChoices: false, reviewStatus: 'approved', status: 'active',
  }) as unknown as QuizItem;

async function createExercise(title: string, questionIds: string[], extra: Partial<Exercise> = {}): Promise<Exercise> {
  return exercises.createExercise({
    title, subject: 'math', grade: 3,
    items: questionIds.map((quizItemId, position) => ({ id: `it-${quizItemId}`, position, kind: 'fixed', quizItemId })),
    timeLimitMinutes: 10, lives: 'unlimited', passingPercent: 60, orderMode: 'fixed', replayAllowed: false,
    correctionReviewEnabled: true, repeatSameQuestions: false, questionTimingMode: 'none', status: 'active',
    ...extra,
  });
}

/** Answers the current play: `correct` of them right, the rest wrong. */
async function answerAll(correct: number) {
  const total = play.totalQuestions();
  for (let i = play.currentIndex(); i < total; i++) {
    await play.submitAnswer([i < correct ? 'a' : 'b']);
  }
}

describe('sync redesign end to end (real Apps Script code, fake Sheet)', () => {
  beforeEach(() => resetSheets());

  it('parent assigns, the child plays on another device, results and points reach every device', async () => {
    // --- PC: parent's questions, an exercise, an assignment for Nam
    await becomeDevice('pc');
    await seedFixedProfiles(profiles);
    await categories.createCategory('Phân số', 'math', undefined, 'cat');
    for (let i = 0; i < 5; i++) await quizItems.create(question(i));
    const exercise = await createExercise('Bài 1', ['q0', 'q1', 'q2', 'q3', 'q4'], { repeatLimit: 2 });
    const assignment = await assignments.assign(KID, exercise, { deadline: new Date(Date.now() + 86_400_000).toISOString() });
    await writer.settle();
    expect(google({ mode: 'ALL', sheet: 'Profile' })).toHaveLength(3);
    expect((await quizItems.getById('q0'))?.updateSequence).toBe(1); // Google's number, stored locally

    // --- Tablet: opening the app takes profiles, assignments, exercises — not questions (setting off)
    await becomeDevice('tablet');
    await openApp();
    expect(await db.quizItems.count()).toBe(0);
    const [mine] = await assignments.listForChild(KID);
    expect(mine.exerciseSnapshot.title).toBe('Bài 1');
    expect((await profiles.getById('profile-parent'))?.password).toBe('chungmo200287'); // parent can log in here

    // Nam plays: the missing questions are fetched just for this exercise. 4/5 right, pass 60% → 2 stars.
    await play.startAssignment(KID, mine);
    expect(await db.quizItems.count()).toBe(5);
    await writer.settle();
    expect(google({ mode: 'ALL', sheet: 'Session' })).toHaveLength(1);
    await answerAll(4);
    expect(play.status()).toBe('completed');
    const result = play.result()!;
    expect(result).toMatchObject({ score: 40, stars: 2, bonus: 10, pointsEarned: 50, counted: true, late: false, tryNumber: 1 });
    await writer.settle();
    await points.recompute(KID);
    await writer.settle();

    expect(google({ mode: 'ALL', sheet: 'Session' })).toEqual([]); // ended
    expect(google({ mode: 'ALL', sheet: 'Assignment' })[0]['assignments']).toEqual([]); // passed → removed
    expect(google({ mode: 'ROWS_AFTER', sheet: 'HistoryResult', after: 0 })).toHaveLength(1);
    expect(google({ mode: 'RESULTS_AFTER', after: 0 })[0]).toMatchObject({ id: result.id, resultId: 1 });
    expect(google({ mode: 'ALL', sheet: 'Profile' }).find((p) => p.id === KID)?.['totalPoints']).toBe(50);
    expect((await results.getById(result.id))?.resultId).toBe(1);

    // --- PC: the parent sees the result and spends 20 of Nam's points
    await becomeDevice('pc');
    await openApp();
    expect((await results.resultsForChild(KID))[0].stars).toBe(2);
    expect((await profiles.getById(KID))?.totalPoints).toBe(50);
    await usages.use(KID, 20, 'Kẹo');
    await points.recompute(KID);
    await writer.settle();
    expect(google({ mode: 'ALL', sheet: 'Profile' }).find((p) => p.id === KID)?.['totalPoints']).toBe(30);
    expect(assignment.id).toBe(mine.id);
  }, 60_000);

  it('a failed try uses up the assignment only when no tries are left; the session continues on another device', async () => {
    await becomeDevice('pc');
    await seedFixedProfiles(profiles);
    await categories.createCategory('Phân số', 'math', undefined, 'cat');
    for (let i = 0; i < 4; i++) await quizItems.create(question(i));
    const exercise = await createExercise('Bài 2', ['q0', 'q1', 'q2', 'q3'], { repeatLimit: 2, passingPercent: 75 });
    await assignments.assign(KID2, exercise);
    await writer.settle();

    // Tablet: try 1 fails (2/4 < 75%) — one try left, the assignment stays; no points.
    await becomeDevice('tablet', { questions: true });
    await openApp();
    let [a] = await assignments.listForChild(KID2);
    await play.startAssignment(KID2, a);
    await answerAll(2);
    expect(play.result()).toMatchObject({ stars: 0, counted: false, tryNumber: 1 });
    await writer.settle();
    [a] = await assignments.listForChild(KID2);
    expect(a.tries).toBe(1);
    expect(await play.triesLeft(a)).toBe(1);

    // Try 2 starts on the tablet; two answers in, the app is closed.
    await play.startAssignment(KID2, a);
    await play.submitAnswer(['a']);
    await play.submitAnswer(['a']);
    await writer.settle();

    // Phone: the same child continues where they left off.
    await becomeDevice('phone', { questions: true });
    await openApp();
    expect(await play.resume(KID2)).toBe(true);
    expect(play.currentIndex()).toBe(2);
    await answerAll(0); // both remaining wrong → 2/4 again
    expect(play.result()).toMatchObject({ tryNumber: 2, correctCount: 2, stars: 0 });
    await writer.settle();
    expect(google({ mode: 'ALL', sheet: 'Assignment' })[0]['assignments']).toEqual([]); // no tries left → removed
    expect(google({ mode: 'ROWS_AFTER', sheet: 'HistoryResult', after: 0 }).map((h) => h['tryNumber'])).toEqual([1, 2]);
  }, 60_000);

  it('a lost answer is retried without duplicating anything; giving up counts as a try', async () => {
    await becomeDevice('pc');
    await seedFixedProfiles(profiles);
    for (let i = 0; i < 2; i++) await quizItems.create(question(i));
    const exercise = await createExercise('Bài 3', ['q0', 'q1'], { repeatLimit: 'unlimited', allowPractice: true, practiceEarnsPoints: true });
    await assignments.assign(KID, exercise);
    await writer.settle();

    await becomeDevice('tablet', { questions: true });
    await openApp();
    const [a] = await assignments.listForChild(KID);
    await play.startAssignment(KID, a);
    await play.submitAnswer(['a']);
    await writer.settle();

    // Giving up (to start practice instead): recorded, never passes; the unlimited assignment stays.
    await play.abandon(KID);
    expect(play.result()).toMatchObject({ status: 'abandoned', counted: false });
    // The finish request is processed by Google but its answer is lost: the retry must not add a second row.
    requestCount = 0;
    loseAnswerOf = 1;
    await writer.settle();
    loseAnswerOf = -1;
    expect(google({ mode: 'ROWS_AFTER', sheet: 'HistoryResult', after: 0 })).toHaveLength(1);
    expect(google({ mode: 'RESULTS_AFTER', after: 0 })).toHaveLength(1);
    expect(google({ mode: 'ALL', sheet: 'Assignment' })[0]['assignments']).toHaveLength(1);

    // Practice earns points when the exercise says so (2/2 → 3 stars: 20 + 10).
    await play.startPractice(KID, (await exercises.getById(exercise.id))!);
    await answerAll(2);
    expect(play.result()).toMatchObject({ assignmentId: undefined, stars: 3, pointsEarned: 30, counted: true });
    await writer.settle();
    expect(await points.recompute(KID)).toBe(30);
  }, 60_000);

  it('questions: incremental by updateSequence, "only new ones", and "Đồng bộ ngay" in both directions', async () => {
    await becomeDevice('pc');
    await seedFixedProfiles(profiles);
    for (let i = 0; i < 3; i++) await quizItems.create(question(i));
    await writer.settle();

    // Phone takes the questions; the PC then edits q1 and adds q3.
    await becomeDevice('phone', { questions: true });
    await openApp();
    expect(await db.quizItems.count()).toBe(3);
    const phoneCopy = await db.quizItems.toArray();

    await becomeDevice('pc');
    await openApp();
    await db.quizItems.bulkPut(phoneCopy); // the PC still has them (same as the phone)
    await quizItems.update('q1', { prompt: 'đã sửa' });
    await quizItems.create(question(3));
    await writer.settle();

    // Phone with "only new questions": gets q3, ignores the edit.
    await becomeDevice('phone', { questions: true, addedOnly: true });
    await db.quizItems.bulkPut(phoneCopy);
    await openApp();
    expect(await db.quizItems.count()).toBe(4);
    expect((await quizItems.getById('q1'))?.prompt).toBe('Câu 1');
    // (Storing q3 raised the local maximum past that edit: by the agreed rule it now only comes with a full
    // "Đồng bộ ngay" pull.) Without the option, later edits come too — records above the local maximum.
    store.set('quiz-app.deviceId', 'pc');
    await quizItems.update('q2', { prompt: 'sửa sau' });
    await writer.settle();
    store.set('quiz-app.deviceId', 'phone');
    await settings.update({ autoSyncAddedQuestionsOnly: false });
    await openApp();
    expect((await quizItems.getById('q2'))?.prompt).toBe('sửa sau');
    expect((await quizItems.getById('q1'))?.prompt).toBe('Câu 1');
    await manual.run({ direction: 'pull', skipQuestions: false, addedQuestionsOnly: false });
    expect((await quizItems.getById('q1'))?.prompt).toBe('đã sửa');

    // "Đồng bộ ngay" Máy này → Google from a device without q0: Google marks it deleted.
    await db.quizItems.delete('q0');
    const pushed = await manual.run({ direction: 'push', skipQuestions: false, addedQuestionsOnly: false });
    expect(pushed.ok).toBe(true);
    expect(pushed.removed).toBe(1);
    expect(google({ mode: 'BY_ID', sheet: 'QuizItem', ids: ['q0'] })[0]['deletedAt']).toBeTruthy();

    // "Đồng bộ ngay" Google → máy này on a device with a question Google doesn't have: it goes; profiles stay.
    await becomeDevice('tablet');
    await seedFixedProfiles(profiles);
    await writer.settle();
    await db.quizItems.add(question(99)); // only on this device (never sent)
    const pulled = await manual.run({ direction: 'pull', skipQuestions: false, addedQuestionsOnly: false });
    expect(pulled.ok).toBe(true);
    expect(await quizItems.getById('q99')).toBeUndefined();
    expect((await quizItems.getById('q0'))?.deletedAt).toBeTruthy();
    expect(await db.profiles.count()).toBe(3);
  }, 60_000);

  it('app start with an unreachable Google shows the error; a retry gets through', async () => {
    await becomeDevice('pc');
    const realFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    await startup.run();
    expect(startup.state()).toBe('error');
    expect(startup.error()).toContain('Không kết nối');
    global.fetch = realFetch;
    await openApp();
  });
});
