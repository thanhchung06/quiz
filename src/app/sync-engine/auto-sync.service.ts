import { Injectable } from '@angular/core';
import { Table } from 'dexie';
import { db } from '../data/db';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { SessionService } from '../core/auth/session.service';
import { Profile } from '../shared/models/domain.model';
import { SyncClientService, SyncScope } from './sync-client.service';
import { TABLE_BY_ENTITY } from './download-applier.service';
import { readAutoSyncSettings } from './storage-mode.service';
import { syncEndpointUrl } from './sync-endpoint';
import { Uploader } from './upload-policy';

export function uploaderOf(profile: Profile | undefined): Uploader | undefined {
  return profile ? { role: profile.role === 'child' ? 'child' : 'parent', profileId: profile.id } : undefined;
}

/** Saves this close together go up in one upload (a child answering questions, an import of many questions). */
export const PUSH_DELAY_MS = 2000;

/**
 * Automatic Sync (FR-055), for devices with "Tự động đồng bộ" ticked:
 *
 * - App opened: Google's data comes down and overwrites this device's copy —
 *   everything except questions, plus questions/categories when "Nhận cả câu
 *   hỏi" is ticked (optionally only newly added ones). The device may be
 *   shared by the parent and the children, so all of it is taken; local
 *   changes not uploaded yet are kept.
 * - Every local save: shortly after, what changed goes up — only what the
 *   person logged in may upload (see uploadPolicy). Nothing else triggers an
 *   upload: a change that couldn't go up (offline, nobody logged in, another
 *   child's) goes with the next save that can upload it.
 *
 * Fire-and-forget: never awaited on the child's login/play path; failures only
 * show on the Sync screen.
 */
@Injectable({ providedIn: 'root' })
export class AutoSyncService {
  private started = false;
  private pushTimer?: ReturnType<typeof setTimeout>;
  private pushing = false;
  private pushAgain = false;

  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly syncClient: SyncClientService,
    private readonly session: SessionService,
  ) {}

  /** Downloads once now (app opened), then uploads after every local save. */
  startLifecycleHooks(): void {
    if (this.started) return;
    this.started = true;
    void this.pullOnOpen().catch(() => undefined);
    this.watchLocalSaves();
  }

  /** Schedules an upload (callers normally don't need this: saves are watched). */
  schedulePush(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.pushNow(), PUSH_DELAY_MS);
  }

  /** Any record written as pendingUpload (a local change) schedules an upload; sync's own writes are 'synced' and don't. */
  private watchLocalSaves(): void {
    for (const tableName of Object.values(TABLE_BY_ENTITY)) {
      const table = db[tableName] as unknown as Table<{ syncStatus?: string }, string>;
      table.hook('creating', (_key, record) => {
        if (record.syncStatus === 'pendingUpload') this.schedulePush();
      });
      table.hook('updating', (changes, _key, record) => {
        const status = 'syncStatus' in changes ? (changes as { syncStatus?: string }).syncStatus : record.syncStatus;
        if (status === 'pendingUpload') this.schedulePush();
      });
    }
  }

  private async pushNow(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true; // a save during an upload: go again once it ends
      return;
    }
    this.pushing = true;
    try {
      const endpoint = syncEndpointUrl();
      const uploader = uploaderOf(this.session.currentProfile());
      if (!endpoint || !uploader || !readAutoSyncSettings(await this.settings.get()).enabled) return;
      await this.syncClient.run(endpoint, { scopes: ['questions', 'data'], push: true, pull: false, mode: 'changes', uploader });
    } catch {
      // shown on the Sync screen; the changes stay pending for the next save
    } finally {
      this.pushing = false;
      if (this.pushAgain) {
        this.pushAgain = false;
        this.schedulePush();
      }
    }
  }

  private async pullOnOpen(): Promise<void> {
    const endpoint = syncEndpointUrl();
    if (!endpoint) return;
    const auto = readAutoSyncSettings(await this.settings.get());
    if (!auto.enabled) return;
    const scopes: SyncScope[] = auto.includeQuestions ? ['questions', 'data'] : ['data'];
    await this.syncClient.run(endpoint, { scopes, push: false, pull: true, mode: 'changes', addedQuestionsOnly: auto.addedQuestionsOnly });
  }
}
