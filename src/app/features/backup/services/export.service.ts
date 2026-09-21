import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { currentDeviceId } from '../../../data/repositories/base-repository';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { ProfileRepository } from '../../../data/repositories/profile.repository';

export interface BackupEnvelope {
  formatVersion: string;
  appVersion: string;
  localSchemaVersion: number;
  exportedAt: string;
  exportedByDeviceId: string;
  data: {
    profiles: unknown[];
    categories: unknown[];
    quizItems: unknown[];
    exercises: unknown[];
    assignments: unknown[];
    rotations: unknown[];
    attempts: unknown[];
    answerResults: unknown[];
    rewards: unknown[];
    pointRedemptions: unknown[];
    deletedRecords: unknown[];
  };
}

/**
 * Full local backup export (FR-052, contracts/backup-format.md).
 * `Profile.credential` is stripped — same rule as sync (FR-066).
 */
@Injectable({ providedIn: 'root' })
export class BackupExportService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly appSettings: AppSettingsRepository,
  ) {}

  async exportAll(): Promise<BackupEnvelope> {
    const settings = await this.appSettings.get();
    const rawProfiles = await db.profiles.toArray();

    return {
      formatVersion: '1.0',
      appVersion: '0.0.0',
      localSchemaVersion: settings.schemaVersion,
      exportedAt: new Date().toISOString(),
      exportedByDeviceId: currentDeviceId(),
      data: {
        profiles: rawProfiles.map((p) => this.profiles.toSyncable(p)),
        categories: await db.categories.toArray(),
        quizItems: await db.quizItems.toArray(),
        exercises: await db.exercises.toArray(),
        assignments: await db.assignments.toArray(),
        rotations: await db.rotations.toArray(),
        attempts: await db.attempts.toArray(),
        answerResults: await db.answerResults.toArray(),
        rewards: await db.rewards.toArray(),
        pointRedemptions: await db.pointRedemptions.toArray(),
        deletedRecords: await db.deletedRecords.toArray(),
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
