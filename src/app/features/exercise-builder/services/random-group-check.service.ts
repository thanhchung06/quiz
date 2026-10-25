import { Injectable } from '@angular/core';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { groupByPassage } from '../../../shared/random/passage-draw';
import { RandomGroupConfig } from '../../../shared/models/domain.model';

export interface SatisfiabilityResult {
  satisfiable: boolean;
  matchingCount: number;
  message: string;
}

/**
 * Warns the parent at save time if the current bank cannot supply enough
 * matching Approved items for a configured random group (FR-036).
 */
@Injectable({ providedIn: 'root' })
export class RandomGroupCheckService {
  constructor(private readonly quizItems: QuizItemRepository) {}

  async checkSatisfiable(group: RandomGroupConfig): Promise<SatisfiabilityResult> {
    const approved = await this.quizItems.search({
      subject: group.subject,
      grade: group.grade,
      status: 'active',
      reviewStatus: 'approved',
    });
    const matches = (item: (typeof approved)[number]): boolean => {
      if (group.categoryIds.length > 0 && !group.categoryIds.includes(item.categoryId)) return false;
      if (group.tags.length > 0 && !group.tags.some((t) => item.tags.includes(t))) return false;
      // Legacy items predating the difficulty field default to 2/Trung bình, same as AttemptResolverService's own matching.
      const difficulty = item.difficulty ?? 2;
      if (difficulty < group.difficultyMin || difficulty > group.difficultyMax) return false;
      if (group.allowedTypes.length > 0 && !group.allowedTypes.includes(item.type)) return false;
      return true;
    };

    if (group.passageDraw) {
      const passages = groupByPassage(approved).filter((g) => g.some(matches));
      const questions = passages.reduce((sum, g) => sum + g.length, 0);
      const { by, value } = group.passageDraw;
      const ok = by === 'passages' ? passages.length >= value : questions >= value;
      return {
        satisfiable: ok,
        matchingCount: by === 'passages' ? passages.length : questions,
        message: ok
          ? ''
          : by === 'passages'
            ? `Only ${passages.length} matching passage(s) available, but this group requests ${value}.`
            : `Matching passages hold only ${questions} question(s) in total, but this group requests at least ${value}.`,
      };
    }

    const candidates = approved.filter((item) => !item.passage && matches(item));
    const satisfiable = candidates.length >= group.count;
    return {
      satisfiable,
      matchingCount: candidates.length,
      message: satisfiable
        ? ''
        : `Only ${candidates.length} matching approved item(s) available, but this group requests ${group.count}.`,
    };
  }
}
