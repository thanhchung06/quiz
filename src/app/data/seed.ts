import { newSyncEnvelope } from '../shared/models/sync.model';
import { Profile } from '../shared/models/domain.model';
import { currentDeviceId } from './repositories/base-repository';
import { ProfileRepository } from './repositories/profile.repository';

export const CHILD_ONE_ID = 'profile-child-one';
export const CHILD_TWO_ID = 'profile-child-two';
export const PARENT_ID = 'profile-parent';

/**
 * Seeds exactly the 3 fixed profiles (FR-001, spec Assumptions) on first
 * launch. Names and passwords are the family's real, fixed values (hard coded
 * per explicit request) rather than placeholders — the parent can change them
 * later from Settings. Written to Firebase only if the family has no such
 * profile yet (runs at every app start; the ids are fixed).
 */
export async function seedFixedProfiles(profiles: ProfileRepository): Promise<void> {
  if ((await profiles.all()).length > 0) return;

  const deviceId = currentDeviceId();
  const defaults: Array<Pick<Profile, 'id' | 'role' | 'displayName' | 'avatar' | 'password'>> = [
    { id: CHILD_ONE_ID, role: 'child', displayName: 'Nam', avatar: 'avatar-1', password: '19062016' },
    { id: CHILD_TWO_ID, role: 'child', displayName: 'Vũ', avatar: 'avatar-2', password: '02042018' },
    { id: PARENT_ID, role: 'parent', displayName: 'Phụ huynh', avatar: 'avatar-parent', password: 'chungmo200287' },
  ];

  for (const d of defaults) {
    await profiles.createIfAbsent({
      ...newSyncEnvelope(d.id, deviceId),
      ...d,
      preferences: { audioEnabled: true, reducedMotion: false, feedbackDelayMs: 1200 },
      createdAt: new Date().toISOString(),
    });
  }
}
