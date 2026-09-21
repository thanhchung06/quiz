import { Injectable } from '@angular/core';
import { QuizItemRepository } from '../../../../data/repositories/quiz-item.repository';
import { QuizPackageItem } from '../quiz-package.model';

export interface DuplicateMatch {
  index: number;
  matchesExistingId: string;
  reason: 'externalId' | 'normalizedPrompt';
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Duplicate detection for import (FR-026): externalId match, then likely-duplicate prompt text. */
@Injectable({ providedIn: 'root' })
export class DuplicateDetectorService {
  constructor(private readonly quizItems: QuizItemRepository) {}

  async findDuplicates(items: QuizPackageItem[]): Promise<DuplicateMatch[]> {
    const existing = await this.quizItems.list();
    const byExternalId = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId!, e.id]));
    const byPrompt = new Map(existing.map((e) => [normalizePrompt(e.prompt), e.id]));

    const matches: DuplicateMatch[] = [];
    for (const [index, item] of items.entries()) {
      if (item.externalId && byExternalId.has(item.externalId)) {
        matches.push({ index, matchesExistingId: byExternalId.get(item.externalId)!, reason: 'externalId' });
        continue;
      }
      const normalized = normalizePrompt(item.prompt);
      if (byPrompt.has(normalized)) {
        matches.push({ index, matchesExistingId: byPrompt.get(normalized)!, reason: 'normalizedPrompt' });
      }
    }
    return matches;
  }
}
