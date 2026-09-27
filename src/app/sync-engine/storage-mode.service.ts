import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { AppSettings } from '../shared/models/domain.model';

export interface AutoSyncSettings {
  enabled: boolean;
  includeQuestions: boolean;
  /** With includeQuestions: only take questions this device doesn't have yet, ignore edits to existing ones. */
  addedQuestionsOnly: boolean;
}

/** An older device may only have the retired storageMode: "automaticSync" there means enabled. */
export function readAutoSyncSettings(settings: AppSettings): AutoSyncSettings {
  return {
    enabled: settings.autoSyncEnabled ?? settings.storageMode === 'automaticSync',
    includeQuestions: settings.autoSyncQuestions ?? false,
    addedQuestionsOnly: settings.autoSyncAddedQuestionsOnly ?? false,
  };
}

/**
 * Automatic-sync settings (FR-055). Data is always stored on the device; the
 * parent only chooses whether it also syncs automatically, and whether that
 * automatic sync includes questions. What it does is in AutoSyncService.
 */
@Injectable({ providedIn: 'root' })
export class StorageModeService {
  constructor(private readonly settings: AppSettingsRepository) {}

  async getAutoSync(): Promise<AutoSyncSettings> {
    return readAutoSyncSettings(await this.settings.get());
  }

  async setAutoSync(value: AutoSyncSettings): Promise<void> {
    const includeQuestions = value.enabled && value.includeQuestions;
    await this.settings.update({
      autoSyncEnabled: value.enabled,
      autoSyncQuestions: includeQuestions,
      autoSyncAddedQuestionsOnly: includeQuestions && value.addedQuestionsOnly,
    });
  }
}
