import { Injectable } from '@angular/core';
import { db } from '../db';
import { AppSettings } from '../../shared/models/domain.model';

const DEFAULTS: AppSettings = {
  id: 'singleton',
  schemaVersion: 1,
  timerVisibility: true,
  audioEnabled: true,
  reducedMotion: false,
  feedbackDelayMs: 1200,
  storageMode: 'localOnly',
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
