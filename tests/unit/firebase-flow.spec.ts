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
import { PointUsageRepository } from '../../src/app/data/repositories/point-usage.repository';
import { PointsRepository } from '../../src/app/data/repositories/points.repository';
import { PointsService } from '../../src/app/features/rewards/services/points.service';
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
const pointsService = new PointsService(points, results, usages);
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

    store.set('quiz-app.deviceId', 'pc');
    await quizItems.update('q7', { prompt: 'đã sửa' });
    await quizItems.softDelete('q8');
    store.set('quiz-app.deviceId', 'tablet');
    expect(await quizBank.sync()).toBe(true);
    expect(quizBank.received()).toBe(2);
    expect((await quizItems.getById('q7'))?.prompt).toBe('đã sửa');
    expect((await quizItems.list()).some((q) => q.id === 'q8')).toBe(false);
  }, 120_000);

  it('parent assigns; the child plays on another device; the finish updates everything at once and raises points', async () => {
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
    expect(await results.historyForChild(KID)).toHaveLength(1);
    expect(await points.get(KID)).toBe(50);

    // Parent: spends 20 points (one atomic write) — the records agree with the stored number.
    await becomeDevice('pc');
    await usages.use(KID, 20, 'Kẹo');
    expect(await points.get(KID)).toBe(30);
    expect(await pointsService.fromRecords(KID)).toBe(30);
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

  it('only the newest results are kept per child; history keeps every try', async () => {
    await becomeDevice('pc');
    await openApp();
    await quizItems.create(question(0));
    const exercise = await createExercise('Luyện', ['q0'], { allowPractice: true, practiceEarnsPoints: false });
    for (let i = 0; i < RESULTS_KEPT + 3; i++) {
      await play.startPractice(KID, exercise);
      await answerAll(1);
    }
    expect(await results.resultsForChild(KID)).toHaveLength(RESULTS_KEPT);
    expect(await results.historyForChild(KID)).toHaveLength(RESULTS_KEPT + 3);
    expect(await points.get(KID)).toBe(0); // practice without points
  }, 120_000);

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
    expect(await results.historyForChild(KID)).toHaveLength(1);
    expect(await points.get(KID)).toBe(40);
    expect(await db.quizItems.count()).toBe(3);

    await importer.restore(JSON.parse(JSON.stringify(backup)));
    expect(await results.historyForChild(KID)).toHaveLength(1);
    expect(await usages.listForChild(KID)).toHaveLength(1);
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
