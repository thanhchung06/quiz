import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { StorageMode } from '../shared/models/domain.model';

/**
 * Storage-mode setting (FR-055): Local Only / Manual Sync / Automatic Sync.
 * What Automatic Sync does is in AutoSyncService.
 */
@Injectable({ providedIn: 'root' })
export class StorageModeService {
  constructor(private readonly settings: AppSettingsRepository) {}

  async getMode(): Promise<StorageMode> {
    return (await this.settings.get()).storageMode;
  }

  async setMode(mode: StorageMode): Promise<void> {
    await this.settings.update({ storageMode: mode });
  }
}
