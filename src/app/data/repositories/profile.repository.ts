import { Injectable } from '@angular/core';
import { Profile } from '../../shared/models/domain.model';
import { RemoteRecordRepository } from './base-repository';
import { RemoteStore } from '../../remote/remote-store';
import { decode, encode, StoredNode } from '../../remote/record-codec';

/**
 * The fixed profiles (2 children + 1 parent, FR-001), stored in Firebase — no
 * create/delete UI. Only the parent edits them. A child's points are stored
 * beside the profile (PointsRepository), and a profile edit leaves them as they are.
 */
@Injectable({ providedIn: 'root' })
export class ProfileRepository extends RemoteRecordRepository<Profile> {
  protected override readonly storedApart = ['points'];

  constructor(remote: RemoteStore) {
    super(remote, 'profiles');
  }

  async findByRoleAndName(role: Profile['role'], displayName?: string): Promise<Profile[]> {
    const all = await this.list();
    return all.filter((p) => p.role === role && (!displayName || p.displayName === displayName));
  }

  async updatePassword(id: string, password: string): Promise<void> {
    await this.update(id, { password } as Partial<Profile>);
  }

  /** Seeded profiles: written only if Firebase doesn't have them yet. */
  async createIfAbsent(profile: Profile): Promise<void> {
    if (!decode<Profile>(await this.remote.get<StoredNode>(`profiles/${profile.id}`))) {
      await this.remote.update({ [`profiles/${profile.id}`]: encode(profile) });
    }
  }
}
