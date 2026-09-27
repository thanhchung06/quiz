import { AutoSyncService } from '../../src/app/sync-engine/auto-sync.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { SyncClientService } from '../../src/app/sync-engine/sync-client.service';

function setup(settings: object) {
  localStorage.setItem('quiz-app.syncEndpoint', 'https://script/exec');
  const run = jest.fn(async () => 'success');
  const auto = new AutoSyncService(
    { get: async () => ({ storageMode: 'localOnly', ...settings }) } as unknown as AppSettingsRepository,
    { run } as unknown as SyncClientService,
  );
  return { auto, run };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AutoSyncService', () => {
  it('syncs data both ways when "Tự động đồng bộ" is ticked, and nothing when it is not', async () => {
    const on = setup({ autoSyncEnabled: true, autoSyncQuestions: false });
    on.auto.request('attempt-finished');
    await settle();
    expect(on.run).toHaveBeenCalledWith('https://script/exec', { scopes: ['data'], pull: true, push: true });

    const off = setup({ autoSyncEnabled: false });
    off.auto.request('assigned');
    await settle();
    expect(off.run).not.toHaveBeenCalled();
  });

  it('includes questions only when "Đồng bộ cả câu hỏi" is ticked too', async () => {
    const { auto, run } = setup({ autoSyncEnabled: true, autoSyncQuestions: true });
    auto.request('assigned');
    await settle();
    expect(run).toHaveBeenCalledWith('https://script/exec', { scopes: ['questions', 'data'], pull: true, push: true });
  });

  it('treats an older device set to the retired "automaticSync" mode as enabled', async () => {
    const { auto, run } = setup({ storageMode: 'automaticSync' });
    auto.request('assigned');
    await settle();
    expect(run).toHaveBeenCalled();
  });

  it('syncs when the app opens and whenever it is hidden or closed', async () => {
    const { auto, run } = setup({ autoSyncEnabled: true });
    auto.startLifecycleHooks();
    await settle();
    expect(run).toHaveBeenCalledTimes(1); // opened

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
