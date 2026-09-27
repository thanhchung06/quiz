import { Injectable, signal } from '@angular/core';
import { ProfileRepository } from '../../data/repositories/profile.repository';
import { Profile } from '../../shared/models/domain.model';
import { hashCredential } from './credential-hash';

export interface LoginResult {
  success: boolean;
  profile?: Profile;
}

/**
 * Session/auth core (FR-002–FR-005): a child logs in by picking their avatar
 * alone, no PIN — only the parent profile is password-protected; wrong
 * password never reveals which part was wrong (FR-003); a successful login
 * exposes only the selected profile's own data (FR-004).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _currentProfile = signal<Profile | undefined>(undefined);
  readonly currentProfile = this._currentProfile.asReadonly();
  private readonly listeners: Array<(previous: Profile | undefined, current: Profile | undefined) => void> = [];

  constructor(private readonly profiles: ProfileRepository) {}

  /** Called after every login/logout with who was and who is now logged in (automatic sync uses it). */
  onProfileChange(listener: (previous: Profile | undefined, current: Profile | undefined) => void): void {
    this.listeners.push(listener);
  }

  private setProfile(profile: Profile | undefined): void {
    const previous = this._currentProfile();
    this._currentProfile.set(profile);
    if (previous?.id !== profile?.id) for (const listener of this.listeners) listener(previous, profile);
  }

  async login(profileId: string, rawCredential: string): Promise<LoginResult> {
    const profile = await this.profiles.getById(profileId);
    if (!profile) {
      return { success: false };
    }
    // A child selecting their own avatar is credential enough — only the
    // parent profile still needs its password checked.
    if (profile.role === 'child') {
      this.setProfile(profile);
      return { success: true, profile };
    }
    const candidateHash = await hashCredential(rawCredential, profile.id);
    if (candidateHash !== profile.credentialHash) {
      return { success: false };
    }
    this.setProfile(profile);
    return { success: true, profile };
  }

  logout(): void {
    this.setProfile(undefined);
  }

  isLoggedIn(): boolean {
    return this._currentProfile() !== undefined;
  }

  requireCurrentProfile(): Profile {
    const profile = this._currentProfile();
    if (!profile) {
      throw new Error('No profile is logged in');
    }
    return profile;
  }
}
