import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { RemoteStore } from '../../../remote/remote-store';
import { encode, StoredNode } from '../../../remote/record-codec';
import { PointsService } from '../../rewards/services/points.service';
import { BackupData, BackupEnvelope, convertLegacyBackup, LegacyBackupEnvelope } from './backup-format';

export interface ImportSummary {
  counts: Record<string, number>;
  compatible: boolean;
  /** An old (pre-redesign) file, converted on import. */
  legacy: boolean;
}

/** Paths written per request (one atomic update each). */
const CHUNK = 200;

/**
 * Backup import (FR-052) into the family's server data: accepts the current
 * format (2.0) and old files (1.0, converted — see convertLegacyBackup). It
 * adds to what is there: profiles, questions, categories, exercises,
 * assignments and ongoing exercises are written as in the file; results,
 * history and point uses the server already has are left as they are (they can
 * never be changed). Points are then recomputed from the records. A profile
 * without a password in the file keeps the one the server has.
 */
@Injectable({ providedIn: 'root' })
export class BackupImportService {
  constructor(
    private readonly appSettings: AppSettingsRepository,
    private readonly remote: RemoteStore,
    private readonly quizItems: QuizItemRepository,
    private readonly categories: CategoryRepository,
    private readonly points: PointsService,
  ) {}

  async previewSummary(envelope: BackupEnvelope | LegacyBackupEnvelope): Promise<ImportSummary> {
    const data = await this.dataOf(envelope);
    if (!data) return { counts: {}, compatible: false, legacy: false };
    const counts = Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, (value as unknown[]).length]),
    );
    return { counts, compatible: true, legacy: envelope.formatVersion === '1.0' };
  }

  /** `onProgress(done, total)` after each written chunk. */
  async restore(envelope: BackupEnvelope | LegacyBackupEnvelope, onProgress?: (done: number, total: number) => void): Promise<void> {
    const data = await this.dataOf(envelope);
    if (!data) throw new Error('Tệp sao lưu không đúng định dạng.');

    const values: Array<[string, unknown]> = [];
    for (const p of data.profiles) values.push([`profiles/${p.id}`, encode(p)]);
    for (const e of data.exercises) values.push([`exercises/${e.id}`, encode(e)]);
    for (const a of data.assignments) {
      const { tries, ...rest } = a;
      values.push([`assignments/${a.childId}/${a.id}`, encode(rest, 'updatedAt', { tries: tries ?? 0 })]);
    }
    for (const s of data.sessions) {
      values.push([`sessions/${s.childId}`, encode(s, 'updatedAt', { progress: JSON.stringify({ sessionId: s.id, progress: s.progress }) })]);
    }
    const children = [...new Set([...data.historyResults, ...data.results, ...data.pointUsages].map((r) => r.childId))];
    for (const child of children) {
      const existing = async (path: string) => new Set((await this.remote.list<StoredNode>(`${path}/${child}`)).map((row) => row.key));
      const [hasResult, hasHistory, hasUsage] = await Promise.all([existing('results'), existing('history'), existing('pointUsage')]);
      for (const r of data.results.filter((r) => r.childId === child && !hasResult.has(r.id))) values.push([`results/${child}/${r.id}`, encode(r, 'createdAt')]);
      for (const h of data.historyResults.filter((h) => h.childId === child && !hasHistory.has(h.id))) values.push([`history/${child}/${h.id}`, encode(h, 'createdAt')]);
      for (const u of data.pointUsages.filter((u) => u.childId === child && !hasUsage.has(u.id))) values.push([`pointUsage/${child}/${u.id}`, encode(u, 'createdAt')]);
    }

    const total = values.length + data.categories.length + data.quizItems.length;
    let done = 0;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      await this.remote.update(Object.fromEntries(chunk));
      onProgress?.((done += chunk.length), total);
    }
    // Through the quiz bank repositories: they also update this device's copy and the quiz version.
    await this.categories.createMany(data.categories);
    onProgress?.((done += data.categories.length), total);
    await this.quizItems.createMany(data.quizItems);
    onProgress?.((done += data.quizItems.length), total);

    for (const profile of data.profiles.filter((p) => p.role === 'child')) await this.points.recompute(profile.id);
    await this.appSettings.update({ backupMetadata: { ...(await this.appSettings.get()).backupMetadata, lastImportAt: new Date().toISOString() } });
  }

  private async dataOf(envelope: BackupEnvelope | LegacyBackupEnvelope): Promise<BackupData | undefined> {
    const onServer = await this.remote.list<StoredNode>('profiles');
    const serverPasswords = new Map(onServer.map((row) => [row.key, (JSON.parse(row.value.json) as { password?: string }).password ?? '']));
    if (envelope?.formatVersion === '1.0') return convertLegacyBackup(envelope, serverPasswords);
    if (envelope?.formatVersion !== '2.0') return undefined;
    const data = envelope.data;
    return {
      ...data,
      profiles: data.profiles.map((p) => ({ ...p, password: p.password || serverPasswords.get(p.id) || '' })),
    };
  }
}
