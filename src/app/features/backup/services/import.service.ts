import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { BackupEnvelope } from './export.service';

export interface ImportSummary {
  counts: Record<keyof BackupEnvelope['data'], number>;
  compatible: boolean;
}

const SUPPORTED_FORMAT_VERSIONS = ['1.0'];

/**
 * Backup import (FR-052, contracts/backup-format.md): validates format/
 * schema version, shows a summary, and replaces local data only after
 * explicit confirmation, all-or-nothing within one transaction.
 */
@Injectable({ providedIn: 'root' })
export class BackupImportService {
  constructor(private readonly appSettings: AppSettingsRepository) {}

  async previewSummary(envelope: BackupEnvelope): Promise<ImportSummary> {
    const settings = await this.appSettings.get();
    const compatible =
      SUPPORTED_FORMAT_VERSIONS.includes(envelope.formatVersion) &&
      envelope.localSchemaVersion <= settings.schemaVersion;

    const counts = Object.fromEntries(
      Object.entries(envelope.data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]),
    ) as ImportSummary['counts'];

    return { counts, compatible };
  }

  /** Replaces all local collections in one Dexie transaction (all-or-nothing). */
  async restore(envelope: BackupEnvelope): Promise<void> {
    const summary = await this.previewSummary(envelope);
    if (!summary.compatible) {
      throw new Error('Backup format/schema version is not compatible with this installation.');
    }

    await db.transaction(
      'rw',
      [
        db.profiles,
        db.categories,
        db.quizItems,
        db.exercises,
        db.assignments,
        db.rotations,
        db.attempts,
        db.answerResults,
        db.rewards,
        db.pointRedemptions,
        db.deletedRecords,
      ],
      async () => {
        const existingProfiles = await db.profiles.toArray();
        const credentialByProfileId = new Map(existingProfiles.map((p) => [p.id, p.credentialHash]));

        await Promise.all([
          db.categories.clear(),
          db.quizItems.clear(),
          db.exercises.clear(),
          db.assignments.clear(),
          db.rotations.clear(),
          db.attempts.clear(),
          db.answerResults.clear(),
          db.rewards.clear(),
          db.pointRedemptions.clear(),
          db.deletedRecords.clear(),
          db.profiles.clear(),
        ]);

        // Existing device credentials are preserved rather than overwritten
        // by the backup (contracts/backup-format.md import behavior).
        const restoredProfiles = (envelope.data.profiles as Array<Record<string, unknown>>).map((p) => ({
          ...p,
          credentialHash: credentialByProfileId.get(p['id'] as string) ?? '',
        }));

        await Promise.all([
          db.profiles.bulkAdd(restoredProfiles as never[]),
          db.categories.bulkAdd(envelope.data.categories as never[]),
          db.quizItems.bulkAdd(envelope.data.quizItems as never[]),
          db.exercises.bulkAdd(envelope.data.exercises as never[]),
          db.assignments.bulkAdd(envelope.data.assignments as never[]),
          db.rotations.bulkAdd(envelope.data.rotations as never[]),
          db.attempts.bulkAdd(envelope.data.attempts as never[]),
          db.answerResults.bulkAdd(envelope.data.answerResults as never[]),
          db.rewards.bulkAdd(envelope.data.rewards as never[]),
          // Older backups predate this field — restore them as having no redemption history rather than throwing.
          db.pointRedemptions.bulkAdd((envelope.data.pointRedemptions ?? []) as never[]),
          db.deletedRecords.bulkAdd(envelope.data.deletedRecords as never[]),
        ]);
      },
    );

    await this.appSettings.update({ backupMetadata: { ...(await this.appSettings.get()).backupMetadata, lastImportAt: new Date().toISOString() } });
  }
}
