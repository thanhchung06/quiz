import { Injectable } from '@angular/core';
import { db } from '../db';
import { Rotation } from '../../shared/models/domain.model';
import { BaseRepository, currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';
import { AssignmentRepository } from './assignment.repository';

function todayLocalDate(): string {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/**
 * Rotation (data-model.md §5a) plus the "today's exercise" resolution rule
 * that implements the FR-007/FR-033/FR-069 clarification: the dated primary
 * Assignment wins if one exists for today; otherwise the next exercise in
 * the child's enabled rotation is used, advancing the cursor only once that
 * exercise is actually started (not merely viewed).
 */
@Injectable({ providedIn: 'root' })
export class RotationRepository extends BaseRepository<Rotation> {
  constructor(private readonly assignments: AssignmentRepository) {
    super(db.rotations);
  }

  async getForProfile(profileId: string): Promise<Rotation | undefined> {
    const all = await this.list();
    return all.find((r) => r.profileId === profileId);
  }

  async ensureForProfile(profileId: string): Promise<Rotation> {
    const existing = await this.getForProfile(profileId);
    if (existing) return existing;
    const rotation: Rotation = {
      ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
      profileId,
      orderedExerciseIds: [],
      cursor: 0,
    };
    await this.create(rotation);
    return rotation;
  }

  async setOrderedExercises(profileId: string, orderedExerciseIds: string[]): Promise<void> {
    const rotation = await this.ensureForProfile(profileId);
    await this.update(rotation.id, { orderedExerciseIds });
  }

  /**
   * Resolves today's exercise for a child: dated Assignment first, else the
   * rotation entry at `cursor` (FR-007, FR-033, FR-069). Returns undefined
   * only if neither a dated assignment nor a non-empty rotation exists.
   */
  async resolveTodayExerciseId(profileId: string, date: string = todayLocalDate()): Promise<string | undefined> {
    const primary = await this.assignments.findPrimaryFor(profileId, date);
    if (primary) {
      return primary.exerciseId;
    }
    const rotation = await this.getForProfile(profileId);
    if (!rotation || rotation.orderedExerciseIds.length === 0) {
      return undefined;
    }
    const index = rotation.cursor % rotation.orderedExerciseIds.length;
    return rotation.orderedExerciseIds[index];
  }

  /** Advances the cursor; call only when the rotation-sourced exercise is actually started. */
  async advanceCursor(profileId: string): Promise<void> {
    const rotation = await this.getForProfile(profileId);
    if (!rotation || rotation.orderedExerciseIds.length === 0) return;
    const nextCursor = (rotation.cursor + 1) % rotation.orderedExerciseIds.length;
    await this.update(rotation.id, { cursor: nextCursor });
  }
}
