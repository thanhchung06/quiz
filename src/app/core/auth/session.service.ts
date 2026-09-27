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

  constructor(private readonly profiles: ProfileRepository) {}

  async login(profileId: string, rawCredential: string): Promise<LoginResult> {
    const profile = await this.profiles.getById(profileId);
    if (!profile) {
      return { success: false };
    }
    // A child selecting their own avatar is credential enough — only the
    // parent profile still needs its password checked.
    if (profile.role === 'child') {
      this._currentProfile.set(profile);
      return { success: true, profile };
    }
    const candidateHash = await hashCredential(rawCredential, profile.id);
    if (candidateHash !== profile.credentialHash) {
      return { success: false };
    }
    this._currentProfile.set(profile);
    return { success: true, profile };
  }

  logout(): void {
    this._currentProfile.set(undefined);
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
