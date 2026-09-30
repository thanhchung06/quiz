import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { RemoteStore } from '../../../remote/remote-store';
import { encode, StoredNode } from '../../../remote/record-codec';
import { lastRow, rowKey } from '../../../remote/numbered-rows';
import { RESULTS_KEPT, ResultRepository } from '../../../data/repositories/result.repository';
import { HistoryResult, PointUsage } from '../../../shared/models/domain.model';
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
 * assignments and ongoing exercises are written as in the file. A child's
 * tries (history, results) and point uses are numbered lists with running
 * totals, so they are written only for a child the server has none of yet —
 * renumbered in order, with the totals worked out again and the last
 * RESULTS_KEPT results. Points are then set from the totals. A profile
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
    for (const { points: _points, ...p } of data.profiles) values.push([`profiles/${p.id}`, encode(p)]); // points are set from the totals below
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
      const [hasHistory, hasUsage] = await Promise.all([lastRow(this.remote, `history/${child}`), lastRow(this.remote, `pointUsage/${child}`)]);
      if (hasHistory || hasUsage) continue; // numbered lists can't be merged: a child's tries and uses come in only onto an empty server
      values.push(...numberedRows(child, data));
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

/**
 * A child's history, results and point uses as numbered rows: in their order
 * (by number when the file has numbered ids, else by time), from 1, with the
 * running totals; a result keeps its try's number, and only the last
 * RESULTS_KEPT are written.
 */
function numberedRows(child: string, data: BackupData): Array<[string, unknown]> {
  const rows: Array<[string, unknown]> = [];
  const inOrder = <T extends { id: string }>(list: T[], time: (r: T) => string) =>
    [...list].sort((a, b) => (isNumbered(a.id) && isNumbered(b.id) ? Number(a.id) - Number(b.id) : time(a).localeCompare(time(b))));

  const history = inOrder(
    data.historyResults.filter((h) => h.childId === child),
    (h) => h.attemptedAt,
  );
  const keyOf = new Map<string, string>();
  let totalEarned = 0;
  let totalStars = 0;
  history.forEach((h: HistoryResult, i) => {
    const key = rowKey(i + 1);
    keyOf.set(h.id, key);
    totalEarned += h.counted ? h.pointsEarned : 0;
    totalStars += h.stars;
    const { totalEarned: _e, totalStars: _s, ...record } = h;
    rows.push([`history/${child}/${key}`, encode({ ...record, id: key }, 'createdAt', { totalEarned, totalStars, ...ResultRepository.lookupFields(h) })]);
  });
  for (const r of data.results.filter((r) => r.childId === child)) {
    const key = keyOf.get(r.id);
    if (key && Number(key) > history.length - RESULTS_KEPT) rows.push([`results/${child}/${key}`, encode({ ...r, id: key }, 'createdAt')]);
  }

  let totalUsed = 0;
  inOrder(
    data.pointUsages.filter((u) => u.childId === child),
    (u) => u.usedAt,
  ).forEach((u: PointUsage, i) => {
    const key = rowKey(i + 1);
    totalUsed += u.points;
    const { totalUsed: _t, ...record } = u;
    rows.push([`pointUsage/${child}/${key}`, encode({ ...record, id: key }, 'createdAt', { totalUsed })]);
  });
  return rows;
}

function isNumbered(id: string): boolean {
  return /^[0-9]+$/.test(id);
}
