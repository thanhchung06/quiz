import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';

export interface WeakItem {
  quizItemId: string;
  prompt: string;
  missCount: number;
}

export interface WeakTag {
  tag: string;
  incorrectCount: number;
  totalResponses: number;
}

/**
 * Learning-needs detection (FR-048): items missed ≥2 times, and weak
 * tags/skills summarized only once ≥3 responses exist for them.
 */
@Injectable({ providedIn: 'root' })
export class WeakAreasService {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly quizItems: QuizItemRepository,
  ) {}

  async weakItems(profileId: string): Promise<WeakItem[]> {
    const attempts = await this.attempts.listForProfile(profileId);
    const attemptIds = attempts.map((a) => a.id);
    if (attemptIds.length === 0) return [];
    const answers = await db.answerResults.where('attemptId').anyOf(attemptIds).toArray();

    const missByItem = new Map<string, { count: number; prompt: string }>();
    for (const answer of answers) {
      if (answer.isCorrect) continue;
      const entry = missByItem.get(answer.quizItemId) ?? { count: 0, prompt: answer.quizItemSnapshot.prompt };
      entry.count += 1;
      missByItem.set(answer.quizItemId, entry);
    }

    return Array.from(missByItem.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([quizItemId, v]) => ({ quizItemId, prompt: v.prompt, missCount: v.count }))
      .sort((a, b) => b.missCount - a.missCount);
  }

  async weakTags(profileId: string): Promise<WeakTag[]> {
    const attempts = await this.attempts.listForProfile(profileId);
    const attemptIds = attempts.map((a) => a.id);
    if (attemptIds.length === 0) return [];
    const answers = await db.answerResults.where('attemptId').anyOf(attemptIds).toArray();

    const tagStats = new Map<string, { incorrect: number; total: number }>();
    for (const answer of answers) {
      const item = await this.quizItems.getById(answer.quizItemId);
      if (!item) continue;
      for (const tag of item.tags) {
        const entry = tagStats.get(tag) ?? { incorrect: 0, total: 0 };
        entry.total += 1;
        if (!answer.isCorrect) entry.incorrect += 1;
        tagStats.set(tag, entry);
      }
    }

    return Array.from(tagStats.entries())
      .filter(([, v]) => v.total >= 3 && v.incorrect > 0)
      .map(([tag, v]) => ({ tag, incorrectCount: v.incorrect, totalResponses: v.total }));
  }
}
