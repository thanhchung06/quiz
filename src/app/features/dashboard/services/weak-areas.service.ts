import { Injectable } from '@angular/core';
import { ResultRepository } from '../../../data/repositories/result.repository';

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
 * Learning-needs detection (FR-048) from the detailed results: items missed
 * ≥2 times, and weak tags/skills summarized only once ≥3 responses exist.
 * Uses each result's own question copies, never the live bank.
 */
@Injectable({ providedIn: 'root' })
export class WeakAreasService {
  constructor(private readonly results: ResultRepository) {}

  async weakItems(childId: string): Promise<WeakItem[]> {
    const missByItem = new Map<string, { count: number; prompt: string }>();
    for (const result of await this.results.resultsForChild(childId)) {
      for (const [quizItemId, answer] of Object.entries(result.answers)) {
        if (answer.isCorrect) continue;
        const entry = missByItem.get(quizItemId) ?? { count: 0, prompt: result.itemSnapshots[quizItemId]?.prompt ?? '' };
        entry.count += 1;
        missByItem.set(quizItemId, entry);
      }
    }
    return Array.from(missByItem.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([quizItemId, v]) => ({ quizItemId, prompt: v.prompt, missCount: v.count }))
      .sort((a, b) => b.missCount - a.missCount);
  }

  async weakTags(childId: string): Promise<WeakTag[]> {
    const tagStats = new Map<string, { incorrect: number; total: number }>();
    for (const result of await this.results.resultsForChild(childId)) {
      for (const [quizItemId, answer] of Object.entries(result.answers)) {
        for (const tag of result.itemSnapshots[quizItemId]?.tags ?? []) {
          const entry = tagStats.get(tag) ?? { incorrect: 0, total: 0 };
          entry.total += 1;
          if (!answer.isCorrect) entry.incorrect += 1;
          tagStats.set(tag, entry);
        }
      }
    }
    return Array.from(tagStats.entries())
      .filter(([, v]) => v.total >= 3 && v.incorrect > 0)
      .map(([tag, v]) => ({ tag, incorrectCount: v.incorrect, totalResponses: v.total }));
  }
}
