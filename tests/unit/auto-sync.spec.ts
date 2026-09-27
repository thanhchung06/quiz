import { AutoSyncService } from '../../src/app/sync-engine/auto-sync.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { SyncClientService } from '../../src/app/sync-engine/sync-client.service';
import { SessionService } from '../../src/app/core/auth/session.service';
import { Profile } from '../../src/app/shared/models/domain.model';

const child = { id: 'kid', role: 'child' } as Profile;
const parent = { id: 'mom', role: 'parent' } as Profile;

function setup(settings: object, loggedIn?: Profile) {
  localStorage.setItem('quiz-app.syncEndpoint', 'https://script/exec');
  const run = jest.fn(async () => 'success');
  let listener: (previous: Profile | undefined, current: Profile | undefined) => void = () => undefined;
  let current = loggedIn;
  const session = {
    currentProfile: () => current,
    onProfileChange: (l: typeof listener) => (listener = l),
  } as unknown as SessionService;
  const auto = new AutoSyncService(
    { get: async () => ({ storageMode: 'localOnly', ...settings }) } as unknown as AppSettingsRepository,
    { run } as unknown as SyncClientService,
    session,
  );
  const switchTo = (next: Profile | undefined) => {
    const previous = current;
    current = next;
    listener(previous, next);
  };
  return { auto, run, switchTo };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AutoSyncService', () => {
  it('uploads changes of whoever is logged in after an exercise, and does nothing when turned off', async () => {
    const on = setup({ autoSyncEnabled: true }, child);
    on.auto.request('attempt-finished');
    await settle();
    expect(on.run).toHaveBeenCalledWith('https://script/exec', {
      scopes: ['data'],
      push: true,
      pull: false,
      mode: 'changes',
      addedQuestionsOnly: false,
      uploader: { role: 'child', profileId: 'kid' },
    });

    const off = setup({ autoSyncEnabled: false }, parent);
    off.auto.request('assigned');
    await settle();
    expect(off.run).not.toHaveBeenCalled();
  });

  it('nothing goes up with nobody logged in', async () => {
    const { auto, run } = setup({ autoSyncEnabled: true });
    auto.request('close');
    await settle();
    expect(run).not.toHaveBeenCalled();
  });

  it('opening the app pulls from Google (with questions and added-only when ticked)', async () => {
    const { auto, run } = setup({ autoSyncEnabled: true, autoSyncQuestions: true, autoSyncAddedQuestionsOnly: true });
    auto.startLifecycleHooks();
    await settle();
    expect(run).toHaveBeenCalledWith('https://script/exec', {
      scopes: ['questions', 'data'],
      push: false,
      pull: true,
      mode: 'changes',
      addedQuestionsOnly: true,
      uploader: undefined,
    });
  });

  it('treats an older device set to the retired "automaticSync" mode as enabled', async () => {
    const { auto, run } = setup({ storageMode: 'automaticSync' }, parent);
    auto.request('assigned');
    await settle();
    expect(run).toHaveBeenCalled();
  });

  it('uploads on login, on logout (as the person leaving), and when the app is hidden or closed', async () => {
    const { auto, run, switchTo } = setup({ autoSyncEnabled: true });
    auto.startLifecycleHooks();
    await settle();
    run.mockClear();

    switchTo(child);
    await settle();
    switchTo(undefined);
    await settle();
    expect(run.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      expect.objectContaining({ push: true, pull: false, uploader: { role: 'child', profileId: 'kid' } }),
      expect.objectContaining({ push: true, pull: false, uploader: { role: 'child', profileId: 'kid' } }),
    ]);

    switchTo(parent);
    await settle();
    run.mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('https://script/exec', expect.objectContaining({ uploader: { role: 'parent', profileId: 'mom' } }));
  });
});
