import { Injectable } from '@angular/core';
import { currentDeviceId } from '../../../data/repositories/base-repository';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { RemoteStore } from '../../../remote/remote-store';
import { decode, StoredNode } from '../../../remote/record-codec';
import { Assignment, Category, Exercise, HistoryResult, PlayResult, PlaySession, PointUsage, Profile, QuizItem } from '../../../shared/models/domain.model';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { PlaySessionRepository } from '../../../data/repositories/play-session.repository';
import { BackupEnvelope } from './backup-format';

export type { BackupEnvelope } from './backup-format';

/** Full backup (FR-052, contracts/backup-format.md format 2.0): everything the family has on the server. */
@Injectable({ providedIn: 'root' })
export class BackupExportService {
  constructor(
    private readonly appSettings: AppSettingsRepository,
    private readonly remote: RemoteStore,
    private readonly assignments: AssignmentRepository,
    private readonly sessions: PlaySessionRepository,
  ) {}

  async exportAll(): Promise<BackupEnvelope> {
    const profiles = await this.records<Profile>('profiles');
    const children = profiles.filter((p) => p.role === 'child').map((p) => p.id);
    const perChild = async <T>(path: string) => (await Promise.all(children.map((c) => this.records<T>(`${path}/${c}`)))).flat();
    const sessions = (await Promise.all(children.map((c) => this.sessions.forChild(c)))).filter((s): s is PlaySession => !!s);
    const points = Object.fromEntries(await Promise.all(children.map(async (c) => [c, (await this.remote.get<number>(`points/${c}`)) ?? 0])));
    return {
      formatVersion: '2.0',
      exportedAt: new Date().toISOString(),
      exportedByDeviceId: currentDeviceId(),
      data: {
        profiles,
        categories: await this.records<Category>('categories'),
        quizItems: await this.records<QuizItem>('questions'),
        exercises: await this.records<Exercise>('exercises'),
        assignments: (await this.assignments.listAll()) as Assignment[],
        sessions,
        results: await perChild<PlayResult>('results'),
        historyResults: await perChild<HistoryResult>('history'),
        pointUsages: await perChild<PointUsage>('pointUsage'),
        points,
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

  private async records<T>(path: string): Promise<T[]> {
    return (await this.remote.list<StoredNode>(path)).map((row) => decode<T>(row.value)).filter((r): r is T => !!r);
  }
}
