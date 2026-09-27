import { Injectable } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { SessionService } from '../core/auth/session.service';
import { Profile } from '../shared/models/domain.model';
import { SyncClientService, SyncScope } from './sync-client.service';
import { readAutoSyncSettings } from './storage-mode.service';
import { syncEndpointUrl } from './sync-endpoint';
import { Uploader } from './upload-policy';

export type AutoSyncReason = 'open' | 'close' | 'attempt-finished' | 'assigned' | 'login' | 'logout';

export function uploaderOf(profile: Profile | undefined): Uploader | undefined {
  return profile ? { role: profile.role === 'child' ? 'child' : 'parent', profileId: profile.id } : undefined;
}

/**
 * Automatic Sync (FR-055), for devices with "Tự động đồng bộ" ticked — the
 * data scope, plus questions/categories only if "Đồng bộ cả câu hỏi" is ticked:
 *
 * - App opened: what changed here goes up, then Google's copy comes down and
 *   overwrites this device's (records changed here but not uploadable by
 *   whoever is logged in are kept).
 * - Login, logout, app closed/hidden, exercise finished, work assigned: what
 *   changed here goes up — only what the person logged in (or the one just
 *   logging out) may upload, see uploadPolicy.
 *
 * Fire-and-forget: never awaited on the child's login/play path; failures only
 * show on the Sync screen, and pending changes simply go up next time.
 */
@Injectable({ providedIn: 'root' })
export class AutoSyncService {
  private started = false;

  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly syncClient: SyncClientService,
    private readonly session: SessionService,
  ) {}

  /** `profile`: whose data may go up; defaults to whoever is logged in now. */
  request(reason: AutoSyncReason, profile: Profile | undefined = this.session.currentProfile()): void {
    void this.run(reason, profile).catch(() => undefined);
  }

  /** Syncs once now (app opened), on every login/logout, and whenever the app is hidden/closed (switching away on a phone counts). */
  startLifecycleHooks(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    this.request('open');

    this.session.onProfileChange((previous, current) => {
      if (previous) this.request('logout', previous); // what they did goes up under their own name
      if (current) this.request('login', current);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.request('close');
    });
    window.addEventListener('pagehide', () => this.request('close'));
  }

  private async run(reason: AutoSyncReason, profile: Profile | undefined): Promise<void> {
    const endpoint = syncEndpointUrl();
    if (!endpoint) return;
    const auto = readAutoSyncSettings(await this.settings.get());
    if (!auto.enabled) return;
    const uploader = uploaderOf(profile);
    const pull = reason === 'open';
    if (!pull && !uploader) return; // nothing may go up with nobody logged in
    const scopes: SyncScope[] = auto.includeQuestions ? ['questions', 'data'] : ['data'];
    await this.syncClient.run(endpoint, {
      scopes,
      push: !!uploader,
      pull,
      mode: 'changes',
      addedQuestionsOnly: auto.addedQuestionsOnly,
      uploader,
    });
  }
}
