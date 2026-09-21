import { Injectable } from '@angular/core';
import { db } from '../db';
import { Profile } from '../../shared/models/domain.model';
import { BaseRepository } from './base-repository';

/**
 * Exactly 3 Profile records exist for the app's lifetime (2 child + 1 parent,
 * FR-001, spec Assumptions) — there is no create/delete UI for profiles.
 * `credentialHash` is stripped by `toSyncable`/`toExportable` before this
 * entity ever leaves the device (FR-066).
 */
@Injectable({ providedIn: 'root' })
export class ProfileRepository extends BaseRepository<Profile> {
  constructor() {
    super(db.profiles);
  }

  async findByRoleAndName(role: Profile['role'], displayName?: string): Promise<Profile[]> {
    const all = await this.list();
    return all.filter((p) => p.role === role && (!displayName || p.displayName === displayName));
  }

  async updateCredential(id: string, credentialHash: string): Promise<void> {
    await this.update(id, { credentialHash } as Partial<Profile>);
  }

  /** Strips fields that must never be exported or synchronized (FR-066). */
  toSyncable(profile: Profile): Omit<Profile, 'credentialHash'> {
    const { credentialHash: _credentialHash, ...rest } = profile;
    return rest;
  }
}
