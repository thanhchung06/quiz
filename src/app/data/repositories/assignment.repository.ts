import { Injectable } from '@angular/core';
import { db } from '../db';
import { Assignment } from '../../shared/models/domain.model';
import { BaseRepository, currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';

/**
 * Plain CRUD for Assignment (data-model.md §5). At most one `isPrimary`
 * Assignment may exist per (profileId, assignedDate) (FR-033) — enforced
 * here at write time so no caller can accidentally create a second one.
 */
@Injectable({ providedIn: 'root' })
export class AssignmentRepository extends BaseRepository<Assignment> {
  constructor() {
    super(db.assignments);
  }

  async findPrimaryFor(profileId: string, assignedDate: string): Promise<Assignment | undefined> {
    const matches = await db.assignments
      .where('[profileId+assignedDate]')
      .equals([profileId, assignedDate])
      .toArray();
    return matches.find((a) => a.isPrimary && !a.deletedAt);
  }

  async setPrimaryAssignment(
    profileId: string,
    exerciseId: string,
    assignedDate: string,
  ): Promise<Assignment> {
    const existing = await this.findPrimaryFor(profileId, assignedDate);
    if (existing) {
      await this.update(existing.id, { exerciseId });
      return { ...existing, exerciseId };
    }
    const assignment: Assignment = {
      ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
      profileId,
      exerciseId,
      assignedDate,
      isPrimary: true,
    };
    await this.create(assignment);
    return assignment;
  }
}
