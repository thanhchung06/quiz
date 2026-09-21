import { Injectable } from '@angular/core';
import { db } from '../db';
import { Exercise, ExerciseItem } from '../../shared/models/domain.model';
import { BaseRepository, currentDeviceId } from './base-repository';
import { newSyncEnvelope } from '../../shared/models/sync.model';

/**
 * Plain CRUD for Exercise + embedded ExerciseItem (data-model.md §4/§4a).
 * US1 only reads exercises to run an attempt; US2 extends this with
 * authoring operations (reorder, Mixed-subject validation, duplicate/archive).
 */
@Injectable({ providedIn: 'root' })
export class ExerciseRepository extends BaseRepository<Exercise> {
  constructor() {
    super(db.exercises);
  }

  async reorderItems(exerciseId: string, orderedItemIds: string[]): Promise<void> {
    const exercise = await this.getById(exerciseId);
    if (!exercise) return;
    const byId = new Map(exercise.items.map((i) => [i.id, i]));
    const reordered: ExerciseItem[] = orderedItemIds
      .map((id) => byId.get(id))
      .filter((i): i is ExerciseItem => !!i)
      .map((item, index) => ({ ...item, position: index }));
    await this.update(exerciseId, { items: reordered });
  }

  /** Mixed-subject requires the parent to explicitly select Mixed (FR-031). */
  validateSubject(subject: Exercise['subject'], itemSubjects: Array<'math' | 'language'>): string[] {
    const errors: string[] = [];
    const distinctSubjects = new Set(itemSubjects);
    if (subject !== 'mixed' && distinctSubjects.size > 1) {
      errors.push('An exercise mixing both subjects must explicitly be set to Mixed.');
    }
    if (subject !== 'mixed' && distinctSubjects.size === 1 && !distinctSubjects.has(subject)) {
      errors.push(`All items must match the exercise subject (${subject}) unless Mixed is selected.`);
    }
    return errors;
  }

  async createExercise(exercise: Omit<Exercise, keyof ReturnType<typeof newSyncEnvelope>>): Promise<Exercise> {
    const full: Exercise = { ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()), ...exercise };
    await this.create(full);
    return full;
  }

  async duplicate(exerciseId: string): Promise<Exercise | undefined> {
    const source = await this.getById(exerciseId);
    if (!source) return undefined;
    return this.createExercise({
      title: `${source.title} (bản sao)`,
      subject: source.subject,
      grade: source.grade,
      items: source.items,
      timeLimitMinutes: source.timeLimitMinutes,
      lives: source.lives,
      passingPercent: source.passingPercent,
      orderMode: source.orderMode,
      replayAllowed: source.replayAllowed,
      correctionReviewEnabled: source.correctionReviewEnabled,
      repeatSameQuestions: source.repeatSameQuestions,
      questionTimingMode: source.questionTimingMode ?? 'none',
      isDaily: source.isDaily ?? false,
      status: 'active',
    });
  }

  /** Only an exercise no active attempt currently uses may be archived/deleted (FR-034). */
  async isInUseByActiveAttempt(exerciseId: string): Promise<boolean> {
    const inProgress = await db.attempts.where('status').equals('inProgress').toArray();
    return inProgress.some((a) => a.exerciseId === exerciseId);
  }

  async archiveIfUnused(exerciseId: string): Promise<boolean> {
    if (await this.isInUseByActiveAttempt(exerciseId)) return false;
    await this.update(exerciseId, { status: 'archived' });
    return true;
  }
}
