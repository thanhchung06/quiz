import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { SyncClientService } from './sync-client.service';
import { StorageMode } from '../shared/models/domain.model';

/**
 * Storage-mode logic (FR-055): Local Only / Manual Sync / Automatic Sync.
 * Automatic Sync may run at app start and after a completed exercise, but
 * never blocks child login or exercise play — callers fire it without
 * awaiting its result on those paths.
 */
@Injectable({ providedIn: 'root' })
export class StorageModeService {
  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly syncClient: SyncClientService,
  ) {}

  async getMode(): Promise<StorageMode> {
    return (await this.settings.get()).storageMode;
  }

  async setMode(mode: StorageMode): Promise<void> {
    await this.settings.update({ storageMode: mode });
  }

  /** Fire-and-forget: call on app start and after exercise completion. Never awaited by callers on the play path. */
  triggerAutomaticSyncIfEnabled(endpointUrl: string | undefined): void {
    if (!endpointUrl) return;
    void this.settings.get().then((settings) => {
      if (settings.storageMode === 'automaticSync') {
        void this.syncClient.syncNormally(endpointUrl);
      }
    });
  }
}
