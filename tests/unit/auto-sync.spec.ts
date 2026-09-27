/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { AutoSyncService, PUSH_DELAY_MS } from '../../src/app/sync-engine/auto-sync.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { SyncClientService } from '../../src/app/sync-engine/sync-client.service';
import { SessionService } from '../../src/app/core/auth/session.service';
import { Profile, Reward } from '../../src/app/shared/models/domain.model';
import { db } from '../../src/app/data/db';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';

const store = new Map<string, string>([['quiz-app.syncEndpoint', 'https://script/exec']]);
(globalThis as Record<string, unknown>)['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };

const child = { id: 'kid', role: 'child' } as Profile;
const parent = { id: 'mom', role: 'parent' } as Profile;

// Dexie hooks are registered once per table, so one service watches the whole file; each test swaps what it sees.
let settings: object = {};
let loggedIn: Profile | undefined;
const run = jest.fn(async () => 'success');
const auto = new AutoSyncService(
  { get: async () => ({ storageMode: 'localOnly', ...settings }) } as unknown as AppSettingsRepository,
  { run } as unknown as SyncClientService,
  { currentProfile: () => loggedIn } as unknown as SessionService,
);
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
const waitForPush = async () => {
  await new Promise((resolve) => setTimeout(resolve, PUSH_DELAY_MS + 50));
  await settle();
};
const reward = (id: string): Reward => ({ ...newSyncEnvelope(id, 'x'), profileId: 'kid', type: 'star', key: id, earnedAt: '' }) as Reward;

describe('AutoSyncService', () => {
  beforeEach(() => {
    run.mockClear();
    settings = { autoSyncEnabled: true };
    loggedIn = undefined;
  });

  it('opening the app downloads (with questions, new-only, when ticked) and uploads nothing', async () => {
    settings = { autoSyncEnabled: true, autoSyncQuestions: true, autoSyncAddedQuestionsOnly: true };
    auto.startLifecycleHooks();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('https://script/exec', { scopes: ['questions', 'data'], push: false, pull: true, mode: 'changes', addedQuestionsOnly: true });
  });

  it('every local save uploads shortly after, as the person logged in; saves close together go up once', async () => {
    loggedIn = child;
    await db.rewards.add(reward('r1'));
    await db.rewards.add(reward('r2'));
    await db.rewards.update('r1', { key: 'edited', syncStatus: 'pendingUpload' });
    await waitForPush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('https://script/exec', {
      scopes: ['questions', 'data'],
      push: true,
      pull: false,
      mode: 'changes',
      uploader: { role: 'child', profileId: 'kid' },
    });
  }, 10_000);

  it("sync's own writes (synced records) upload nothing; neither do saves with nobody logged in or auto sync off", async () => {
    loggedIn = parent;
    await db.rewards.put({ ...reward('r3'), syncStatus: 'synced' });
    await db.rewards.update('r3', { lastGoogleVersion: 4, syncStatus: 'synced' });
    await waitForPush();
    expect(run).not.toHaveBeenCalled();

    loggedIn = undefined;
    await db.rewards.add(reward('r4'));
    await waitForPush();
    loggedIn = parent;
    settings = { autoSyncEnabled: false };
    await db.rewards.add(reward('r5'));
    await waitForPush();
    expect(run).not.toHaveBeenCalled();
  }, 10_000);

  it('a save during an upload triggers one more upload after it', async () => {
    loggedIn = parent;
    let finish: () => void = () => undefined;
    run.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve('success'))));
    await db.rewards.add(reward('r6'));
    await waitForPush(); // first upload running
    await db.rewards.add(reward('r7'));
    await waitForPush(); // asked while running: waits
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await waitForPush();
    expect(run).toHaveBeenCalledTimes(2);
  }, 15_000);
});
