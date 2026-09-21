import { Injectable } from '@angular/core';
import { db } from '../db';
import { Attempt, ExerciseSnapshot, QuizItem } from '../../shared/models/domain.model';
import { BaseRepository, currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';

export interface StartAttemptInput {
  profileId: string;
  exerciseId: string;
  assignmentId?: string;
  exerciseSnapshot: ExerciseSnapshot;
  randomSeed: number;
  resolvedItemOrder: string[];
  answerOrderByItem: Record<string, string[]>;
  itemSnapshots: Record<string, QuizItem>;
  isScored: boolean;
  startedAt: string;
  deadlineAt: string;
  perQuestionSeconds?: Record<string, number>;
  currentQuestionDeadlineAt?: string;
}

/**
 * Attempt (data-model.md §6). A child may have at most one `inProgress`
 * Attempt at a time (edge case in spec.md); `ownerDeviceId` gates resume to
 * the device that started it (FR-063).
 */
@Injectable({ providedIn: 'root' })
export class AttemptRepository extends BaseRepository<Attempt> {
  constructor() {
    super(db.attempts);
  }

  /** Any device's in-progress attempt for this child (read-only visibility; FR-063). */
  async findInProgress(profileId: string): Promise<Attempt | undefined> {
    const matches = await db.attempts.where('[profileId+status]').equals([profileId, 'inProgress']).toArray();
    return matches.find((a) => !a.deletedAt);
  }

  /**
   * Only returns an in-progress attempt if THIS device started it (FR-063):
   * another device may see that an attempt exists but must never resume it.
   */
  async findInProgressOwnedByThisDevice(profileId: string): Promise<Attempt | undefined> {
    const attempt = await this.findInProgress(profileId);
    return attempt && attempt.ownerDeviceId === currentDeviceId() ? attempt : undefined;
  }

  async startAttempt(input: StartAttemptInput): Promise<Attempt> {
    const existing = await this.findInProgress(input.profileId);
    if (existing) {
      throw new Error(
        'A scored attempt is already in progress for this child (edge case: no second concurrent attempt).',
      );
    }
    const deviceId = currentDeviceId();
    const attempt: Attempt = {
      ...newSyncEnvelope(crypto.randomUUID(), deviceId),
      ...input,
      ownerDeviceId: deviceId,
      status: 'inProgress',
      livesRemaining: input.exerciseSnapshot.lives,
      score: 0,
      accuracy: 0,
      passed: false,
      starsAwarded: 0,
    };
    await this.create(attempt);
    return attempt;
  }

  async listForProfile(profileId: string): Promise<Attempt[]> {
    return db.attempts.where('profileId').equals(profileId).toArray();
  }
}
