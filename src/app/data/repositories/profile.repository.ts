import { Injectable } from '@angular/core';
import { db } from '../db';
import { Profile } from '../../shared/models/domain.model';
import { BaseRepository } from './base-repository';
import { enqueue } from '../outbox';

/**
 * The fixed profiles (2 children + 1 parent, FR-001) — there is no create/
 * delete UI. The parent edits name/avatar/grade/preferences/password (a whole
 * record write); `totalPoints` only changes through setTotalPoints, its own
 * operation on Google so the two never overwrite each other (plan §3.1).
 */
@Injectable({ providedIn: 'root' })
export class ProfileRepository extends BaseRepository<Profile> {
  constructor() {
    super(db.profiles, 'Profile');
  }

  async findByRoleAndName(role: Profile['role'], displayName?: string): Promise<Profile[]> {
    const all = await this.list();
    return all.filter((p) => p.role === role && (!displayName || p.displayName === displayName));
  }

  async updatePassword(id: string, password: string): Promise<void> {
    await this.update(id, { password } as Partial<Profile>);
  }

  /** Stores a child's recomputed total and sends only that field to Google. */
  async setTotalPoints(id: string, totalPoints: number): Promise<void> {
    await db.profiles.update(id, { totalPoints });
    await enqueue({ op: 'SET_TOTAL_POINTS', profileId: id, totalPoints });
  }

  /** Seeded profiles go to Google only if Google doesn't have them yet (never overwriting another device's edits). */
  async createIfAbsentOnGoogle(profile: Profile): Promise<void> {
    await this.createDefault(profile);
  }
}
