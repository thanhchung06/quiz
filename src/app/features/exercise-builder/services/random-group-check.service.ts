import { Injectable } from '@angular/core';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
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
    const candidates = (
      await this.quizItems.search({
        subject: group.subject,
        grade: group.grade,
        status: 'active',
        reviewStatus: 'approved',
      })
    ).filter((item) => {
      if (group.categoryIds.length > 0 && !group.categoryIds.includes(item.categoryId)) return false;
      if (group.tags.length > 0 && !group.tags.some((t) => item.tags.includes(t))) return false;
      // Legacy items predating the difficulty field default to 2/Trung bình, same as AttemptResolverService's own matching.
      const difficulty = item.difficulty ?? 2;
      if (difficulty < group.difficultyMin || difficulty > group.difficultyMax) return false;
      if (group.allowedTypes.length > 0 && !group.allowedTypes.includes(item.type)) return false;
      return true;
    });

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
