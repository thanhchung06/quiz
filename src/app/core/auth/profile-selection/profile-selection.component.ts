import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { SessionService } from '../session.service';
import { Profile } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';

@Component({
  selector: 'app-profile-selection',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './profile-selection.component.html',
  styleUrl: './profile-selection.component.scss',
})
export class ProfileSelectionComponent {
  readonly strings = vi;
  readonly profiles = signal<Profile[]>([]);
  readonly selected = signal<Profile | undefined>(undefined);
  readonly credential = signal('');
  readonly errorMessage = signal('');

  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly session: SessionService,
    private readonly router: Router,
  ) {
    void this.loadProfiles();
  }

  private async loadProfiles(): Promise<void> {
    const all = await this.profileRepo.list();
    // Deterministic order: children first (in creation order), parent last.
    this.profiles.set(all.sort((a, b) => (a.role === b.role ? 0 : a.role === 'child' ? -1 : 1)));
  }

  select(profile: Profile): void {
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
