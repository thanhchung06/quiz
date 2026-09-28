import { Injectable } from '@angular/core';
import { Exercise, ExerciseItem, QuizItem, RandomGroupConfig } from '../../../shared/models/domain.model';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { syncEnabled } from '../../../data/outbox';
import { SyncReaderService } from '../../../sync/sync-reader.service';
import { mulberry32, generateSeed, seededShuffle, seededSample } from '../../../shared/random/seeded-random';
import { db } from '../../../data/db';

export interface ResolvedAttemptPlan {
  randomSeed: number;
  resolvedItemOrder: string[]; // QuizItem ids
  answerOrderByItem: Record<string, string[]>;
  itemsById: Map<string, QuizItem>;
  /** quizItemId -> seconds allotted, only present for ids that actually have a per-question cap. */
  perQuestionSeconds: Record<string, number>;
}

/**
 * Resolves an Exercise's fixed items and random groups into a concrete play
 * order (FR-036), and a shuffled choice order per question (FR-038), using a
 * seeded PRNG so the exact resolution can be replayed from a stored seed on
 * resume (FR-036/FR-038).
 */
@Injectable({ providedIn: 'root' })
export class AttemptResolverService {
  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly reader: SyncReaderService,
  ) {}

  /**
   * Resolve a brand-new play (new seed, fresh random-group draw). A fixed
   * question this device doesn't have (question pull turned off) is fetched
   * from Google first, when sync is on; one that can't be found is skipped.
   */
  async resolveNew(exercise: Exercise, profileId: string): Promise<ResolvedAttemptPlan> {
    const fixedIds = exercise.items.flatMap((item) => (item.kind === 'fixed' ? [item.quizItemId] : []));
    const missing: string[] = [];
    for (const id of fixedIds) if (!(await this.quizItems.getById(id))) missing.push(id);
    if (missing.length > 0 && (await syncEnabled())) await this.reader.fetchByIds('QuizItem', missing);
    const seed = generateSeed();
    return this.resolveWithSeed(exercise, profileId, seed);
  }

  /** Recompute the exact same plan from a previously stored seed (attempt resume/replay). */
  async resolveWithSeed(exercise: Exercise, profileId: string, seed: number): Promise<ResolvedAttemptPlan> {
    const rng = mulberry32(seed);
    const usedIds = new Set<string>();
    const orderedIds: string[] = [];
    const itemsById = new Map<string, QuizItem>();
    // Only populated when questionTimingMode === 'custom' — id -> the
    // per-question seconds explicitly set on its originating ExerciseItem
    // (fixed) or RandomGroupConfig (random group). Items with no explicit
    // value are left out here, matching "custom means only items you gave
    // a time to get one" (see QuestionTimingMode doc on domain.model.ts).
    const customSecondsById = new Map<string, number>();

    const sortedItems = [...exercise.items].sort((a, b) => a.position - b.position);

    for (const item of sortedItems) {
      if (item.kind === 'fixed') {
        const quizItem = await this.quizItems.getById(item.quizItemId);
        if (quizItem && !usedIds.has(quizItem.id)) {
          // A per-exercise points override never mutates the bank item itself —
          // only this attempt's frozen snapshot, so other exercises using the
          // same QuizItem keep its own default points.
          const points = item.points ?? exercise.defaultQuestionPoints;
          const snapshot = points !== undefined ? { ...quizItem, points } : quizItem;
          orderedIds.push(snapshot.id);
          usedIds.add(snapshot.id);
          itemsById.set(snapshot.id, snapshot);
          if (item.timeLimitSeconds) customSecondsById.set(snapshot.id, item.timeLimitSeconds);
        }
      } else {
        const resolved = await this.resolveRandomGroup(item.randomGroup, usedIds, profileId, rng);
        for (const quizItem of resolved) {
          // Same per-exercise points override pattern as fixed items above —
          // never mutates the bank item, only this attempt's frozen snapshot.
          const points = item.randomGroup.pointsOverride ?? exercise.defaultQuestionPoints;
          const snapshot = points !== undefined ? { ...quizItem, points } : quizItem;
          orderedIds.push(snapshot.id);
          usedIds.add(snapshot.id);
          itemsById.set(snapshot.id, snapshot);
          if (item.randomGroup.timeLimitSeconds) customSecondsById.set(snapshot.id, item.randomGroup.timeLimitSeconds);
        }
      }
    }

    const answerOrderByItem: Record<string, string[]> = {};
    for (const id of orderedIds) {
      const quizItem = itemsById.get(id)!;
      if (quizItem.choices && quizItem.choices.length > 0) {
        answerOrderByItem[id] = quizItem.shuffleChoices
          ? seededShuffle(quizItem.choices, rng).map((c) => c.id)
          : quizItem.choices.map((c) => c.id);
      }
    }

    const perQuestionSeconds: Record<string, number> = {};
    const mode = exercise.questionTimingMode ?? 'none'; // older exercise records predate this field
    if (mode === 'distribute' && orderedIds.length > 0) {
      const perQuestion = Math.max(1, Math.round((exercise.timeLimitMinutes * 60) / orderedIds.length));
      for (const id of orderedIds) perQuestionSeconds[id] = perQuestion;
    } else if (mode === 'uniform') {
      if (exercise.defaultQuestionSeconds) for (const id of orderedIds) perQuestionSeconds[id] = exercise.defaultQuestionSeconds;
    } else if (mode === 'custom') {
      for (const id of orderedIds) {
        const seconds = customSecondsById.get(id) ?? exercise.defaultQuestionSeconds;
        if (seconds) perQuestionSeconds[id] = seconds;
      }
    }

    return { randomSeed: seed, resolvedItemOrder: orderedIds, answerOrderByItem, itemsById, perQuestionSeconds };
  }

  private async resolveRandomGroup(
    group: RandomGroupConfig,
    alreadyUsed: Set<string>,
    profileId: string,
    rng: () => number,
  ): Promise<QuizItem[]> {
    const candidates = (
      await this.quizItems.search({
        subject: group.subject,
        grade: group.grade,
        categoryId: undefined,
        status: 'active',
        reviewStatus: 'approved',
      })
    ).filter((item) => {
      if (alreadyUsed.has(item.id)) return false;
      // Passage sub-questions must only ever be added together as a fixed
      // block (see exercise-builder's addFixedItem) — never split apart by
      // a random draw pulling in some but not all of a passage's questions.
      if (item.passage) return false;
      if (group.categoryIds.length > 0 && !group.categoryIds.includes(item.categoryId)) return false;
      if (group.tags.length > 0 && !group.tags.some((t) => item.tags.includes(t))) return false;
      // Legacy items predating the difficulty field default to 2/Trung bình, same as every other place this field is read.
      const difficulty = item.difficulty ?? 2;
      if (difficulty < group.difficultyMin || difficulty > group.difficultyMax) return false;
      if (group.allowedTypes.length > 0 && !group.allowedTypes.includes(item.type)) return false;
      return true;
    });

    if (group.mode === 'fullyRandom') {
      return seededSample(candidates, group.count, rng);
    }

    if (group.mode === 'practiceWeakAreas') {
      const missCounts = await this.missedCounts(profileId, candidates.map((c) => c.id));
      const ranked = [...candidates].sort((a, b) => (missCounts.get(b.id) ?? 0) - (missCounts.get(a.id) ?? 0));
      const weak = ranked.filter((c) => (missCounts.get(c.id) ?? 0) > 0);
      const rest = seededShuffle(
        ranked.filter((c) => (missCounts.get(c.id) ?? 0) === 0),
        rng,
      );
      return [...weak, ...rest].slice(0, group.count);
    }

    // Balanced (default): spread the draw across distinct categories rather
    // than clustering on whichever category happens to sort first.
    const byCategory = new Map<string, QuizItem[]>();
    for (const item of candidates) {
      const bucket = byCategory.get(item.categoryId) ?? [];
      bucket.push(item);
      byCategory.set(item.categoryId, bucket);
    }
    const shuffledBuckets = seededShuffle([...byCategory.values()], rng).map((bucket) => seededShuffle(bucket, rng));
    const result: QuizItem[] = [];
    let index = 0;
    while (result.length < group.count && shuffledBuckets.some((b) => b.length > index)) {
      for (const bucket of shuffledBuckets) {
        if (bucket.length > index) {
          result.push(bucket[index]);
          if (result.length >= group.count) break;
        }
      }
      index++;
    }
    return result.slice(0, Math.min(group.count, candidates.length));
  }

  private async missedCounts(profileId: string, candidateIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (candidateIds.length === 0) return counts;
    const results = await db.results.where('childId').equals(profileId).toArray();
    const candidateIdSet = new Set(candidateIds);
    for (const result of results) {
      for (const [quizItemId, answer] of Object.entries(result.answers)) {
        if (answer.isCorrect || !candidateIdSet.has(quizItemId)) continue;
        counts.set(quizItemId, (counts.get(quizItemId) ?? 0) + 1);
      }
    }
    return counts;
  }
}
