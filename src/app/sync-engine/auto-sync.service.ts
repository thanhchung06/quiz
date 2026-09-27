import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { SyncClientService } from './sync-client.service';
import { syncEndpointUrl } from './sync-endpoint';

export type AutoSyncReason = 'open' | 'close' | 'attempt-finished' | 'assigned';

/**
 * Automatic Sync (FR-055), for devices set to "Đồng bộ tự động": syncs the
 * data scope — everything except questions/categories, which only move with
 * the "Đồng bộ câu hỏi" button — when the app is opened or closed, after an
 * exercise ends, and after the parent assigns work. Fire-and-forget: never
 * awaited on the child's login/play path, and failures only show on the Sync
 * screen; pending changes simply go up next time.
 */
@Injectable({ providedIn: 'root' })
export class AutoSyncService {
  private started = false;

  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly syncClient: SyncClientService,
  ) {}

  request(_reason: AutoSyncReason): void {
    void this.run().catch(() => undefined);
  }

  /** Syncs once now (app opened) and whenever the app is hidden/closed (switching away on a phone counts). */
  startLifecycleHooks(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    this.request('open');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.request('close');
    });
    window.addEventListener('pagehide', () => this.request('close'));
  }

  private async run(): Promise<void> {
    const endpoint = syncEndpointUrl();
    if (!endpoint) return;
    if ((await this.settings.get()).storageMode !== 'automaticSync') return;
    await this.syncClient.syncNormally(endpoint, 'data');
  }
}
