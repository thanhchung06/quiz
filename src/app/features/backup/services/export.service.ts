import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { currentDeviceId } from '../../../data/repositories/base-repository';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { BackupEnvelope } from './backup-format';

export type { BackupEnvelope } from './backup-format';

/** Full local backup export (FR-052, contracts/backup-format.md format 2.0). */
@Injectable({ providedIn: 'root' })
export class BackupExportService {
  constructor(private readonly appSettings: AppSettingsRepository) {}

  async exportAll(): Promise<BackupEnvelope> {
    return {
      formatVersion: '2.0',
      exportedAt: new Date().toISOString(),
      exportedByDeviceId: currentDeviceId(),
      data: {
        profiles: await db.profiles.toArray(),
        categories: await db.categories.toArray(),
        quizItems: await db.quizItems.toArray(),
        exercises: await db.exercises.toArray(),
        assignments: await db.assignments.toArray(),
        sessions: await db.sessions.toArray(),
        results: await db.results.toArray(),
        historyResults: await db.historyResults.toArray(),
        pointUsages: await db.pointUsages.toArray(),
      },
    };
  }

  async exportAsFile(): Promise<void> {
    const envelope = await this.exportAll();
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz-app-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await this.appSettings.update({ backupMetadata: { ...(await this.appSettings.get()).backupMetadata, lastExportAt: new Date().toISOString() } });
  }
}
