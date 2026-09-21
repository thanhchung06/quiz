import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileRepository } from '../../data/repositories/profile.repository';
import { hashCredential } from '../auth/credential-hash';
import { Profile } from '../../shared/models/domain.model';
import { IconComponent } from '../../shared/icon/icon.component';

/**
 * Parent-facing screen to edit display name, avatar, and local credential
 * per profile (FR-006). Full avatar-picker UI is a later polish item; this
 * covers the required editable fields.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  readonly profiles = signal<Profile[]>([]);
  readonly savedMessage = signal('');

  constructor(private readonly profileRepo: ProfileRepository) {
    void this.load();
  }

  private async load(): Promise<void> {
    this.profiles.set(await this.profileRepo.list());
  }

  async saveDisplayName(profile: Profile, displayName: string): Promise<void> {
    await this.profileRepo.update(profile.id, { displayName });
    await this.load();
    this.flashSaved();
  }

  async saveCredential(profile: Profile, rawCredential: string): Promise<void> {
    if (!rawCredential) return;
    const hash = await hashCredential(rawCredential, profile.id);
    await this.profileRepo.updateCredential(profile.id, hash);
    this.flashSaved();
  }

  private flashSaved(): void {
    this.savedMessage.set('Đã lưu.');
    setTimeout(() => this.savedMessage.set(''), 2000);
  }
}
