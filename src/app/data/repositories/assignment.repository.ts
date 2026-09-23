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

  /** Every active (non-deleted) one-time — i.e. no `assignedDate` — assignment for this child. */
  async listOnetimeFor(profileId: string): Promise<Assignment[]> {
    const all = await this.list();
    return all.filter((a) => a.profileId === profileId && !a.assignedDate && !a.deletedAt);
  }

  /**
   * Assigns an exercise to a child with no specific day attached. Idempotent:
   * reuses an existing one-time assignment of the same exercise for the same
   * child rather than creating a duplicate.
   */
  async assignOnetime(profileId: string, exerciseId: string): Promise<Assignment> {
    const existing = (await this.listOnetimeFor(profileId)).find((a) => a.exerciseId === exerciseId);
    if (existing) return existing;

    const assignment: Assignment = {
      ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
      profileId,
      exerciseId,
      isPrimary: false,
    };
    await this.create(assignment);
    return assignment;
  }
}
