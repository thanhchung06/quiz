/**
 * @jest-environment node
 *
 * The online-first data flow (specs/003-firebase/plan.md) end to end: the
 * app's real repositories and services on an in-memory stand-in for the
 * Firebase database, several "devices" in turn (each one clears its local
 * quiz-bank copy and settings; the server data stays).
 */
import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';

const store = new Map<string, string>();
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

import { db } from '../../src/app/data/db';
import { MemoryRemoteStore } from '../../src/app/remote/memory-remote-store';
import { increment } from '../../src/app/remote/remote-store';
import { encode } from '../../src/app/remote/record-codec';
import { QuizBankSyncService } from '../../src/app/remote/quiz-bank-sync.service';
import { StartupService } from '../../src/app/remote/startup.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { ProfileRepository } from '../../src/app/data/repositories/profile.repository';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { ExerciseRepository } from '../../src/app/data/repositories/exercise.repository';
import { AssignmentRepository } from '../../src/app/data/repositories/assignment.repository';
import { PlaySessionRepository } from '../../src/app/data/repositories/play-session.repository';
import { ResultRepository, RESULTS_KEPT } from '../../src/app/data/repositories/result.repository';
import { rowKey } from '../../src/app/remote/numbered-rows';
import { PointUsageRepository, USAGE_PAGE } from '../../src/app/data/repositories/point-usage.repository';
import { PointsRepository } from '../../src/app/data/repositories/points.repository';
import { PointsService } from '../../src/app/features/rewards/services/points.service';
import { ProgressAggregationService, RECENT_TRIES } from '../../src/app/features/dashboard/services/progress-aggregation.service';
import { AttemptResolverService } from '../../src/app/features/child-play/services/attempt-resolver.service';
import { PlayService } from '../../src/app/features/child-play/services/play.service';
import { BackupImportService } from '../../src/app/features/backup/services/import.service';
import { BackupExportService } from '../../src/app/features/backup/services/export.service';
import { CHILD_ONE_ID as KID, CHILD_TWO_ID as KID2 } from '../../src/app/data/seed';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';
import { Exercise, QuizItem } from '../../src/app/shared/models/domain.model';

const remote = new MemoryRemoteStore();
const settings = new AppSettingsRepository();
const profiles = new ProfileRepository(remote);
const quizItems = new QuizItemRepository(remote);
const categories = new CategoryRepository(remote, quizItems);
const exercises = new ExerciseRepository(remote);
const assignments = new AssignmentRepository(remote);
const sessions = new PlaySessionRepository(remote);
const results = new ResultRepository(remote);
const usages = new PointUsageRepository(remote);
const points = new PointsRepository(remote);
const pointsService = new PointsService(points);
const overview = new ProgressAggregationService(results, points);
const quizBank = new QuizBankSyncService(remote, settings);
const play = new PlayService(new AttemptResolverService(quizItems, quizBank, results), sessions, assignments, results);
const startup = new StartupService(remote, quizBank, profiles, categories, settings);
const importer = new BackupImportService(settings, remote, quizItems, categories, pointsService);
const exporter = new BackupExportService(settings, remote, assignments, sessions);

/** Another device: its own (empty) local copy and settings; the server stays. */
async function becomeDevice(id: string) {
  store.set('quiz-app.deviceId', id);
  await Promise.all(db.tables.map((t) => t.clear()));
}

async function openApp() {
  await startup.run();
  expect(startup.error()).toBeUndefined();
  expect(startup.state()).toBe('done');
}

const question = (i: number): QuizItem =>
  ({
    ...newSyncEnvelope(`q${i}`, 'pc'),
    subject: 'math', grade: 3, type: 'single-choice', prompt: `Câu ${i}`,
    choices: [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: [], difficulty: 2, points: 10, categoryId: 'cat', shuffleChoices: false, reviewStatus: 'approved', status: 'active',
  }) as unknown as QuizItem;

async function createExercise(title: string, ids: string[], extra: Partial<Exercise> = {}): Promise<Exercise> {
  return exercises.createExercise({
    title, subject: 'math', grade: 3,
    items: ids.map((quizItemId, position) => ({ id: `it-${quizItemId}`, position, kind: 'fixed', quizItemId })),
    timeLimitMinutes: 10, lives: 'unlimited', passingPercent: 60, orderMode: 'fixed', replayAllowed: false,
    correctionReviewEnabled: true, repeatSameQuestions: false, questionTimingMode: 'none', status: 'active',
    ...extra,
  });
}

/** A question write made by another device (its own local copy isn't this test's). */
async function otherDeviceWrites(...records: QuizItem[]) {
  await remote.update({
    'meta/quizVersion': increment(1),
    ...Object.fromEntries(records.map((r) => [`questions/${r.id}`, encode(r)])),
  });
}

/** Every row of a numbered list (tests only: the app never reads a whole list). */
async function allRows(path: string) {
  return remote.list<Record<string, unknown>>(path);
}

async function answerAll(correct: number) {
  for (let i = play.currentIndex(); i < play.totalQuestions(); i++) await play.submitAnswer([i < correct ? 'a' : 'b']);
}

describe('online-first data (Firebase layout, in-memory database)', () => {
  beforeEach(() => {
    remote.root = {};
    remote.failNext = 0;
  });

  it('first start seeds the profiles and default categories once; later starts read one number for the quiz bank', async () => {
    await becomeDevice('pc');
    await openApp();
    expect((await profiles.list()).map((p) => p.id).sort()).toEqual(['profile-child-one', 'profile-child-two', 'profile-parent']);
    expect(await db.categories.count()).toBeGreaterThan(5);
    expect(remote.root['meta']).toBeDefined();

    // Another device: takes the categories from the server, creates nothing.
    await becomeDevice('tablet');
    const before = JSON.stringify(remote.root);
    await openApp();
    expect(await db.categories.count()).toBeGreaterThan(5);
    expect(JSON.stringify(remote.root)).toBe(before);

    // Nothing changed: the quiz bank check is a single read.
    remote.calls = 0;
    expect(await quizBank.sync()).toBe(false);
    expect(remote.calls).toBe(1);
  });

  it('quiz bank: a question write moves the version; other devices pull only what is newer, page by page', async () => {
    await becomeDevice('pc');
    await openApp();
    // 2,500 questions written in chunks of 200 that share one server time each — paging must not skip any.
    await quizItems.createMany(Array.from({ length: 2500 }, (_, i) => question(i)));

    await becomeDevice('tablet');
    await openApp();
    expect(await db.quizItems.count()).toBe(2500);

    await otherDeviceWrites({ ...question(7), prompt: 'đã sửa' }, { ...question(8), deletedAt: new Date().toISOString() });
    expect(await quizBank.sync()).toBe(true);
    expect(quizBank.received()).toBe(2);
    expect((await quizItems.getById('q7'))?.prompt).toBe('đã sửa');
    expect((await quizItems.list()).some((q) => q.id === 'q8')).toBe(false);
  }, 120_000);

  it("a device's own question writes (an import) don't make its next start download them again", async () => {
    await becomeDevice('pc');
    await openApp();
    await quizItems.createMany(Array.from({ length: 450 }, (_, i) => question(i))); // 3 atomic chunks
    remote.calls = 0;
    expect(await quizBank.sync()).toBe(false);
    expect(remote.calls).toBe(1);

    // Several questions saved together (a passage, a group's grade, "create several") — one write, still no re-download.
    await quizItems.inBatch(async () => {
      await quizItems.update('q1', { grade: 4 });
      await quizItems.softDelete('q2');
      await quizItems.create(question(900));
    });
    await quizItems.updateMany([{ id: 'q3', patch: { grade: 5 } }, { id: 'q4', patch: { grade: 5 } }]);
    remote.calls = 0;
    expect(await quizBank.sync()).toBe(false);
    expect(remote.calls).toBe(1);

    // But when another device wrote in between, the next start does pull (nothing is missed).
    await becomeDevice('tablet');
    await openApp();
    await otherDeviceWrites(question(1000)); // another device writes…
    await quizItems.create(question(1001)); // …then this one: it must not treat itself as up to date
    expect(await quizBank.sync()).toBe(true);
    expect(await quizItems.getById('q1000')).toBeDefined();
  }, 120_000);

  it('parent assigns; the child plays on another device; the finish updates everything at once and sets points from the totals', async () => {
    await becomeDevice('pc');
    await openApp();
    for (let i = 0; i < 5; i++) await quizItems.create(question(i));
    const exercise = await createExercise('Bài 1', ['q0', 'q1', 'q2', 'q3', 'q4'], { repeatLimit: 2 });
    await assignments.assign(KID, exercise, { deadline: new Date(Date.now() + 86_400_000).toISOString() });

    // Tablet: no local questions yet (fresh copy is pulled at start; drop it to test fetching on demand).
    await becomeDevice('tablet');
    await openApp();
    await db.quizItems.clear();
    const [mine] = await assignments.listForChild(KID);
    expect(mine).toMatchObject({ exerciseId: exercise.id, tries: 0 });

    await play.startAssignment(KID, mine);
    expect(await db.quizItems.count()).toBe(5); // fetched just for this exercise
    expect(await sessions.forChild(KID)).toBeDefined();
    expect((await assignments.getById(KID, mine.id))?.tries).toBe(1);
    await answerAll(4);
    expect(play.result()).toMatchObject({ score: 40, stars: 2, bonus: 10, pointsEarned: 50, counted: true, late: false, tryNumber: 1 });

    expect(await sessions.forChild(KID)).toBeUndefined();
    expect(await assignments.listForChild(KID)).toEqual([]); // passed → removed
    expect(play.result()?.id).toBe(rowKey(1));
    expect(await results.latestHistory(KID)).toMatchObject({ id: rowKey(1), totalEarned: 50, totalStars: 2 });
    expect(await results.getById(KID, rowKey(1))).toMatchObject({ score: 40 });
    expect(await points.get(KID)).toBe(50);
    expect(remote.root['points']).toBeUndefined(); // points live on the profile
    expect((await profiles.getById(KID))?.points).toBe(50);

    // Parent: spends 20 points (one atomic write) — the stored number is set from the totals.
    await becomeDevice('pc');
    expect(await usages.use(KID, 20, 'Kẹo')).toMatchObject({ id: rowKey(1), totalUsed: 20 });
    expect(await points.get(KID)).toBe(30);
    expect(await pointsService.fromRecords(KID)).toBe(30);

    // A profile edit leaves the points alone.
    await profiles.update(KID, { displayName: 'Bé Na' });
    expect(await profiles.getById(KID)).toMatchObject({ displayName: 'Bé Na', points: 30 });
  }, 60_000);

  it('a failed try keeps the assignment while tries are left; the session continues on another device; late progress is ignored', async () => {
    await becomeDevice('pc');
    await openApp();
    for (let i = 0; i < 4; i++) await quizItems.create(question(i));
    const exercise = await createExercise('Bài 2', ['q0', 'q1', 'q2', 'q3'], { repeatLimit: 2, passingPercent: 75 });
    await assignments.assign(KID2, exercise);

    await becomeDevice('tablet');
    await openApp();
    let [a] = await assignments.listForChild(KID2);
    await play.startAssignment(KID2, a);
    await answerAll(2);
    expect(play.result()).toMatchObject({ stars: 0, counted: false, tryNumber: 1 });
    [a] = await assignments.listForChild(KID2);
    expect(a.tries).toBe(1);
    expect(await play.triesLeft(a)).toBe(1);
    expect(await points.get(KID2)).toBe(0);

    await play.startAssignment(KID2, a);
    const secondSession = play.session()!;
    await play.submitAnswer(['a']);
    await play.submitAnswer(['a']);

    await becomeDevice('phone');
    await openApp();
    expect(await play.resume(KID2)).toBe(true);
    expect(play.currentIndex()).toBe(2);
    await answerAll(0);
    expect(play.result()).toMatchObject({ tryNumber: 2, correctCount: 2 });
    expect(await assignments.listForChild(KID2)).toEqual([]); // no tries left → removed

    // A progress write that arrives after the session ended can't bring it back.
    await sessions.saveProgress(secondSession, secondSession.progress);
    expect(await sessions.forChild(KID2)).toBeUndefined();
  });

  it('only the newest results are kept per child (each finish removes the one RESULTS_KEPT back); history keeps every try', async () => {
    await becomeDevice('pc');
    await openApp();
    await quizItems.create(question(0));
    const exercise = await createExercise('Luyện', ['q0'], { allowPractice: true, practiceEarnsPoints: false });
    for (let i = 0; i < RESULTS_KEPT + 3; i++) {
      await play.startPractice(KID, exercise);
      await answerAll(1);
    }
    const kept = await allRows(`results/${KID}`);
    expect(kept).toHaveLength(RESULTS_KEPT);
    expect(kept[0].key).toBe(rowKey(4));
    expect(await allRows(`history/${KID}`)).toHaveLength(RESULTS_KEPT + 3);
    const latest = await results.latestHistory(KID);
    expect(latest).toMatchObject({ id: rowKey(RESULTS_KEPT + 3), tryNumber: RESULTS_KEPT + 3, totalEarned: 0, totalStars: 3 * (RESULTS_KEPT + 3) });
    expect(ResultRepository.isKept(rowKey(4), latest)).toBe(true);
    expect(ResultRepository.isKept(rowKey(3), latest)).toBe(false);
    expect(await points.get(KID)).toBe(0); // practice without points
  }, 240_000);

  it('a finish or a point use whose number another device took first is written again at the next number, totals included', async () => {
    await becomeDevice('pc');
    await openApp();
    await quizItems.create(question(0));
    const exercise = await createExercise('Luyện', ['q0'], { allowPractice: true, practiceEarnsPoints: true });
    await play.startPractice(KID, exercise);
    await answerAll(1);
    const earned = play.result()!.pointsEarned;
    expect(earned).toBeGreaterThan(0);
    expect(await points.get(KID)).toBe(earned);

    /** Makes another device write `row` at `path` just before this device's first write there. */
    const takenFirst = (path: string, row: Record<string, unknown>) => {
      remote.beforeUpdate = (values) => {
        if (!Object.keys(values).some((k) => k.startsWith(path.split('/').slice(0, 2).join('/')))) return;
        remote.beforeUpdate = undefined;
        void remote.update({ [path]: row });
      };
    };

    // Another device finishes a try (100 points) between this one's read and write: it takes number 2.
    await play.startPractice(KID, exercise);
    takenFirst(`history/${KID}/${rowKey(2)}`, { json: '{}', createdAt: 1, totalEarned: earned + 100, totalStars: 6 });
    await answerAll(1);
    expect(play.result()?.id).toBe(rowKey(3));
    expect(await results.latestHistory(KID)).toMatchObject({ id: rowKey(3), totalEarned: 2 * earned + 100, totalStars: 9 });
    expect(await points.get(KID)).toBe(2 * earned + 100);

    takenFirst(`pointUsage/${KID}/${rowKey(1)}`, { json: '{}', createdAt: 1, totalUsed: 5 });
    expect(await usages.use(KID, 10)).toMatchObject({ id: rowKey(2), totalUsed: 15 });
    expect(await points.get(KID)).toBe(2 * earned + 100 - 15);
  });

  it('small reads: daily "played today", practice try number, the overview, point uses a page at a time', async () => {
    await becomeDevice('pc');
    await openApp();
    await quizItems.create(question(0));
    const daily = await createExercise('Hàng ngày', ['q0'], { isDaily: true });
    const practice = await createExercise('Luyện', ['q0'], { allowPractice: true });
    await assignments.assign(KID, daily);
    const [a] = await assignments.listForChild(KID);
    expect(await play.triesLeft(a)).toBe('unlimited');
    for (let i = 0; i < 3; i++) {
      await play.startPractice(KID, practice);
      await answerAll(1);
    }
    expect(await play.triesLeft(a)).toBe('unlimited'); // practice tries don't count for the daily one
    await play.startAssignment(KID, a);
    await answerAll(1);
    expect(await play.triesLeft((await assignments.listForChild(KID))[0])).toBe(0);
    await play.startPractice(KID, practice);
    expect(play.session()?.tryNumber).toBe(4);
    await answerAll(1);

    const o = await overview.overview(KID);
    expect(o.points).toBe(await points.get(KID));
    expect(o.recentActivity.map((h) => h.id)).toEqual([rowKey(5), rowKey(4), rowKey(3), rowKey(2), rowKey(1)]);
    expect(RECENT_TRIES).toBe(7);
    expect((await results.historySince(KID, new Date(Date.now() - 60_000))).map((h) => h.id)[0]).toBe(rowKey(5));

    for (let i = 0; i < USAGE_PAGE + 5; i++) await usages.use(KID, 1);
    const first = await usages.page(KID);
    expect(first).toHaveLength(USAGE_PAGE);
    expect(first[0].id).toBe(rowKey(USAGE_PAGE + 5));
    const second = await usages.page(KID, first.at(-1)!.id);
    expect(second.map((u) => u.id)).toEqual([rowKey(5), rowKey(4), rowKey(3), rowKey(2), rowKey(1)]);
  });

  it('export → import on an empty server; importing again adds nothing twice', async () => {
    await becomeDevice('pc');
    await openApp();
    for (let i = 0; i < 3; i++) await quizItems.create(question(i));
    const exercise = await createExercise('Bài 3', ['q0', 'q1', 'q2']);
    await assignments.assign(KID, exercise);
    const [a] = await assignments.listForChild(KID);
    await play.startAssignment(KID, a);
    await answerAll(3);
    await usages.use(KID, 5);
    const backup = await exporter.exportAll();
    expect(backup.data.historyResults).toHaveLength(1);
    expect(backup.data.points).toEqual({ [KID]: 40, [KID2]: 0 }); // 30 + 15 bonus − 5

    remote.root = {};
    await becomeDevice('new-pc');
    await openApp();
    await importer.restore(JSON.parse(JSON.stringify(backup)));
    expect(await allRows(`history/${KID}`)).toHaveLength(1);
    expect(await results.latestHistory(KID)).toMatchObject({ id: rowKey(1), totalEarned: 45 });
    expect(await results.getById(KID, rowKey(1))).toBeDefined();
    expect(await usages.page(KID)).toMatchObject([{ id: rowKey(1), totalUsed: 5 }]);
    expect(await points.get(KID)).toBe(40);
    expect(await db.quizItems.count()).toBe(3);

    await importer.restore(JSON.parse(JSON.stringify(backup)));
    expect(await allRows(`history/${KID}`)).toHaveLength(1);
    expect(await usages.page(KID)).toHaveLength(1);
    expect(await points.get(KID)).toBe(40);
  });

  it('app start shows the error when the server cannot be reached; a retry gets through', async () => {
    await becomeDevice('pc');
    remote.failNext = 1;
    await startup.run();
    expect(startup.state()).toBe('error');
    expect(startup.error()).toContain('offline');
    await openApp();
  });
});
