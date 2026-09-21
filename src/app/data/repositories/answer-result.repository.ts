import { Injectable } from '@angular/core';
import { db } from '../db';
import { AnswerResult } from '../../shared/models/domain.model';
import { currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';

export type NewAnswerResult = Omit<
  AnswerResult,
  keyof ReturnType<typeof newSyncEnvelope>
>;

/**
 * Append-only repository for AnswerResult (data-model.md §7, FR-062): one
 * immutable row per submitted answer, never edited after write.
 */
@Injectable({ providedIn: 'root' })
export class AnswerResultRepository {
  async append(input: NewAnswerResult): Promise<AnswerResult> {
    const record: AnswerResult = {
      ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
      ...input,
    };
    await db.answerResults.add(record);
    return record;
  }

  async listForAttempt(attemptId: string): Promise<AnswerResult[]> {
    return db.answerResults.where('attemptId').equals(attemptId).sortBy('submittedAt');
  }
}
