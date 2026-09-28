import { Injectable } from '@angular/core';
import Dexie from 'dexie';
import { db } from '../../../data/db';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { PointsService } from '../../rewards/services/points.service';
import { BackupData, BackupEnvelope, convertLegacyBackup, LegacyBackupEnvelope } from './backup-format';

export interface ImportSummary {
  counts: Record<string, number>;
  compatible: boolean;
  /** An old (pre-redesign) file, converted on import. */
  legacy: boolean;
}

/**
 * Backup import (FR-052): accepts the current format (2.0) and old files
 * (1.0, converted — see convertLegacyBackup), shows a summary, and replaces
 * local data only after confirmation, all-or-nothing within one transaction.
 * Profiles keep the password this device has when the file has none.
 */
@Injectable({ providedIn: 'root' })
export class BackupImportService {
  constructor(private readonly appSettings: AppSettingsRepository) {}

  async previewSummary(envelope: BackupEnvelope | LegacyBackupEnvelope): Promise<ImportSummary> {
    const data = await this.dataOf(envelope);
    if (!data) return { counts: {}, compatible: false, legacy: false };
    const counts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, (value as unknown[]).length]));
    return { counts, compatible: true, legacy: envelope.formatVersion === '1.0' };
  }

  async restore(envelope: BackupEnvelope | LegacyBackupEnvelope): Promise<void> {
    const data = await this.dataOf(envelope);
    if (!data) throw new Error('Backup format is not compatible with this installation.');
    const tables = [
      db.profiles,
      db.categories,
      db.quizItems,
      db.exercises,
      db.assignments,
      db.sessions,
      db.results,
      db.historyResults,
      db.pointUsages,
    ];
    // Plain Dexie promise chain (no await inside), so the transaction stays open under zone.js.
    await db.transaction('rw', tables, () =>
      tables
        .reduce((chain, table) => chain.then(() => table.clear()), Dexie.Promise.resolve())
        .then(() => db.profiles.bulkAdd(data.profiles))
        .then(() => db.categories.bulkAdd(data.categories))
        .then(() => db.quizItems.bulkAdd(data.quizItems))
        .then(() => db.exercises.bulkAdd(data.exercises))
        .then(() => db.assignments.bulkAdd(data.assignments))
        .then(() => db.sessions.bulkAdd(data.sessions))
        .then(() => db.results.bulkAdd(data.results))
        .then(() => db.historyResults.bulkAdd(data.historyResults))
        .then(() => db.pointUsages.bulkAdd(data.pointUsages)),
    );
    for (const profile of data.profiles.filter((p) => p.role === 'child')) {
      await db.profiles.update(profile.id, { totalPoints: await PointsService.computeLocal(profile.id) });
    }
    await this.appSettings.update({
      backupMetadata: { ...(await this.appSettings.get()).backupMetadata, lastImportAt: new Date().toISOString() },
      syncHash: undefined,
    });
  }

  private async dataOf(envelope: BackupEnvelope | LegacyBackupEnvelope): Promise<BackupData | undefined> {
    const localPasswords = new Map((await db.profiles.toArray()).map((p) => [p.id, p.password]));
    if (envelope?.formatVersion === '1.0') return convertLegacyBackup(envelope, localPasswords);
    if (envelope?.formatVersion !== '2.0') return undefined;
    const data = envelope.data;
    return {
      ...data,
      profiles: data.profiles.map((p) => ({ ...p, password: p.password || localPasswords.get(p.id) || '' })),
    };
  }
}
