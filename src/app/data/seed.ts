import { db } from './db';
import { hashCredential } from '../core/auth/credential-hash';
import { newSyncEnvelope } from '../shared/models/sync.model';
import { Profile } from '../shared/models/domain.model';
import { currentDeviceId } from './repositories/base-repository';

export const CHILD_ONE_ID = 'profile-child-one';
export const CHILD_TWO_ID = 'profile-child-two';
export const PARENT_ID = 'profile-parent';

/**
 * Seeds exactly the 3 fixed profiles (FR-001, spec Assumptions) on first
 * launch. Names and credentials are the family's real, fixed values (hard
 * coded per explicit request) rather than placeholders — FR-006 still lets
 * the parent change them later from Settings if needed. Idempotent: does
 * nothing if profiles already exist.
 */
export async function seedFixedProfiles(): Promise<void> {
  const existing = await db.profiles.count();
  if (existing > 0) {
    return;
  }

  const deviceId = currentDeviceId();
  const defaults: Array<Pick<Profile, 'id' | 'role' | 'displayName' | 'avatar'> & { defaultCredential: string }> = [
    { id: CHILD_ONE_ID, role: 'child', displayName: 'Nam', avatar: 'avatar-1', defaultCredential: '19062016' },
    { id: CHILD_TWO_ID, role: 'child', displayName: 'Vũ', avatar: 'avatar-2', defaultCredential: '02042018' },
    { id: PARENT_ID, role: 'parent', displayName: 'Phụ huynh', avatar: 'avatar-parent', defaultCredential: 'chungmo200287' },
  ];

  for (const d of defaults) {
    const profile: Profile = {
      ...newSyncEnvelope(d.id, deviceId),
      role: d.role,
      displayName: d.displayName,
      avatar: d.avatar,
      credentialHash: await hashCredential(d.defaultCredential, d.id),
      preferences: { audioEnabled: true, reducedMotion: false, feedbackDelayMs: 1200 },
      createdAt: new Date().toISOString(),
    };
    await db.profiles.add(profile);
  }
}
