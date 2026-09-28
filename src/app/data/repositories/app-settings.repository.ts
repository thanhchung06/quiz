import { Injectable } from '@angular/core';
import { db } from '../db';
import { AppSettings } from '../../shared/models/domain.model';
import { SYNC_DEFAULTS } from '../../sync-defaults.generated';

const DEFAULTS: AppSettings = {
  id: 'singleton',
  timerVisibility: true,
  audioEnabled: true,
  reducedMotion: false,
  feedbackDelayMs: 1200,
  // A build that carries the family's sync settings (config/sync-defaults.json) starts new installs syncing automatically.
  autoSyncEnabled: !!(SYNC_DEFAULTS.endpointUrl && SYNC_DEFAULTS.sharedSecret),
  autoSyncQuestions: false,
  autoSyncAddedQuestionsOnly: false,
  autoSyncExercises: true,
  backupMetadata: {},
};

@Injectable({ providedIn: 'root' })
export class AppSettingsRepository {
  async get(): Promise<AppSettings> {
    const existing = await db.appSettings.get('singleton');
    if (existing) {
      return existing;
    }
    await db.appSettings.add(DEFAULTS);
    return DEFAULTS;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const next = { ...current, ...patch };
    await db.appSettings.put(next);
    return next;
  }
}
