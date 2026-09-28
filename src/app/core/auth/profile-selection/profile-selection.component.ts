import { Component, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { SessionService } from '../session.service';
import { Profile } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';
import { StartupSyncService } from '../../../sync/startup-sync.service';
import { PlayService } from '../../../features/child-play/services/play.service';
import { IconComponent } from '../../../shared/icon/icon.component';

@Component({
  selector: 'app-profile-selection',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './profile-selection.component.html',
  styleUrl: './profile-selection.component.scss',
})
export class ProfileSelectionComponent {
  readonly strings = vi;
  readonly profiles = signal<Profile[]>([]);
  readonly selected = signal<Profile | undefined>(undefined);
  readonly credential = signal('');
  readonly errorMessage = signal('');
  /** Login waits for the app-start pull from Google (plan §5). */
  readonly startup: StartupSyncService['state'];
  readonly startupError: StartupSyncService['error'];

  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly session: SessionService,
    private readonly startupSync: StartupSyncService,
    private readonly play: PlayService,
    private readonly router: Router,
  ) {
    this.startup = startupSync.state;
    this.startupError = startupSync.error;
    // Profiles (names, passwords) may have just come from Google.
    effect(() => {
      if (this.startup() === 'done') void this.loadProfiles();
    });
  }

  retryStartup(): void {
    void this.startupSync.run();
  }

  private async loadProfiles(): Promise<void> {
    const all = await this.profileRepo.list();
    // Deterministic order: children first (in creation order), parent last.
    this.profiles.set(all.sort((a, b) => (a.role === b.role ? 0 : a.role === 'child' ? -1 : 1)));
  }

  select(profile: Profile): void {
    if (this.startup() !== 'done') return;
    if (profile.role === 'child') {
      // No PIN step for a child — picking the avatar logs them straight in.
      void this.loginChild(profile);
      return;
    }
    this.selected.set(profile);
    this.credential.set('');
    this.errorMessage.set('');
  }

  private async loginChild(profile: Profile): Promise<void> {
    const result = await this.session.login(profile.id, '');
    if (!result.success) return;
    // An exercise left unfinished (on any device) continues right away.
    if (await this.play.resume(profile.id)) {
      await this.router.navigateByUrl(this.play.status() === 'inProgress' ? '/exercise/question' : '/exercise/result');
      return;
    }
    await this.router.navigateByUrl('/child-home');
  }

  cancelSelection(): void {
    this.selected.set(undefined);
    this.credential.set('');
    this.errorMessage.set('');
  }

  /** Only ever reached for the parent profile now — a child logs in straight from select() with no form. */
  async submitCredential(): Promise<void> {
    const profile = this.selected();
    if (!profile) return;
    const result = await this.session.login(profile.id, this.credential());
    if (!result.success) {
      this.errorMessage.set(this.strings.auth.wrongCredential);
      this.credential.set('');
      return;
    }
    await this.router.navigateByUrl('/dashboard');
  }
}
