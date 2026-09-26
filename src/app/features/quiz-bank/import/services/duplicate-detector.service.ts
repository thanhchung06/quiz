import { Injectable } from '@angular/core';
import { QuizItemRepository } from '../../../../data/repositories/quiz-item.repository';
import { QuizPackageItem, QuizPackagePassage } from '../quiz-package.model';

export interface PassageDuplicateMatch {
  index: number; // index into pkg.passages
  passageId: string; // the existing passage it matches
}

export interface DuplicateMatch {
  index: number;
  matchesExistingId: string;
  reason: 'externalId' | 'normalizedPrompt';
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * "Likely the same question": same prompt AND same set of option texts.
 * The options matter because generic prompts ("Câu nào dưới đây là câu
 * ghép?", "Câu chuyện muốn nói với em điều gì?") are reused across many
 * different questions.
 */
export function likelyDuplicateKey(prompt: string, choices: Array<{ text: string }> | undefined): string {
  const options = (choices ?? []).map((c) => normalizePrompt(c.text)).sort();
  return `${normalizePrompt(prompt)}\u0000${options.join('\u0000')}`;
}

/** Duplicate detection for import (FR-026): externalId match, then likely-duplicate prompt + options. */
@Injectable({ providedIn: 'root' })
export class DuplicateDetectorService {
  constructor(private readonly quizItems: QuizItemRepository) {}

  async findDuplicates(items: QuizPackageItem[]): Promise<DuplicateMatch[]> {
    const existing = await this.quizItems.list();
    const byExternalId = new Map(existing.filter((e) => e.externalId).map((e) => [e.externalId!, e.id]));
    // An app-created item has no externalId, so export writes its own id there instead — match that too, so an exported, hand-edited file re-imports as the same item.
    const ids = new Set(existing.map((e) => e.id));
    const byPrompt = new Map(existing.map((e) => [likelyDuplicateKey(e.prompt, e.choices), e.id]));

    const matches: DuplicateMatch[] = [];
    for (const [index, item] of items.entries()) {
      if (item.externalId && (byExternalId.has(item.externalId) || ids.has(item.externalId))) {
        matches.push({ index, matchesExistingId: byExternalId.get(item.externalId) ?? item.externalId, reason: 'externalId' });
        continue;
      }
      const normalized = likelyDuplicateKey(item.prompt, item.choices);
      if (byPrompt.has(normalized)) {
        matches.push({ index, matchesExistingId: byPrompt.get(normalized)!, reason: 'normalizedPrompt' });
      }
    }
    return matches;
  }

  /**
   * A file passage matches an existing one when any of its questions'
   * externalId is the id/externalId of an existing passage sub-question —
   * which is exactly what an exported (then hand-edited) file carries.
   */
  async findPassageDuplicates(passages: QuizPackagePassage[]): Promise<PassageDuplicateMatch[]> {
    const passageIdByKey = new Map<string, string>();
    for (const item of await this.quizItems.list()) {
      if (!item.passage) continue;
      passageIdByKey.set(item.id, item.passage.passageId);
      if (item.externalId) passageIdByKey.set(item.externalId, item.passage.passageId);
    }

    const matches: PassageDuplicateMatch[] = [];
    for (const [index, passage] of passages.entries()) {
      const passageId = passage.questions
        .map((q) => (q.externalId ? passageIdByKey.get(q.externalId) : undefined))
        .find((id) => id !== undefined);
      if (passageId) matches.push({ index, passageId });
    }
    return matches;
  }
}
