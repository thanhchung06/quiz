import { AutoSyncService } from '../../src/app/sync-engine/auto-sync.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { SyncClientService } from '../../src/app/sync-engine/sync-client.service';

function setup(storageMode: string) {
  localStorage.setItem('quiz-app.syncEndpoint', 'https://script/exec');
  const syncNormally = jest.fn(async () => 'success');
  const auto = new AutoSyncService(
    { get: async () => ({ storageMode }) } as unknown as AppSettingsRepository,
    { syncNormally } as unknown as SyncClientService,
  );
  return { auto, syncNormally };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AutoSyncService', () => {
  it('syncs only the data scope, and only on automatic-sync devices', async () => {
    const on = setup('automaticSync');
    on.auto.request('attempt-finished');
    await settle();
    expect(on.syncNormally).toHaveBeenCalledWith('https://script/exec', 'data');

    const manual = setup('manualSync');
    manual.auto.request('assigned');
    await settle();
    expect(manual.syncNormally).not.toHaveBeenCalled();
  });

  it('syncs when the app opens and whenever it is hidden or closed', async () => {
    const { auto, syncNormally } = setup('automaticSync');
    auto.startLifecycleHooks();
    await settle();
    expect(syncNormally).toHaveBeenCalledTimes(1); // opened

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(syncNormally).toHaveBeenCalledTimes(3);
  });
});
