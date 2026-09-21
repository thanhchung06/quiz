import { Injectable } from '@angular/core';
import { db } from '../../../../data/db';
import { QuizItemRepository } from '../../../../data/repositories/quiz-item.repository';
import { CategoryRepository, normalizeName } from '../../../../data/repositories/category.repository';
import { PackageValidatorService, CategoryResolution } from './package-validator.service';
import { QuizPackage, QuizPackageItem } from '../quiz-package.model';
import { AnswerRule, Choice, PassageContext, QuizItem, Subject } from '../../../../shared/models/domain.model';
import { newSyncEnvelope } from '../../../../shared/models/sync.model';
import { currentDeviceId } from '../../../../data/repositories/base-repository';

export interface CommitOptions {
  /** Quiz indexes to skip entirely (e.g., duplicates the parent chose to skip). */
  skipIndexes: Set<number>;
  /** index -> categoryId override chosen by the parent in the preview UI. */
  categoryMapping: Map<number, string>;
  /** Passage indexes (into pkg.passages) to skip entirely. */
  skipPassageIndexes?: Set<number>;
  /** passage index -> categoryId override chosen by the parent in the preview UI. */
  passageCategoryMapping?: Map<number, string>;
}

export interface CommitResult {
  importBatchId: string;
  savedIds: string[];
}

function toAnswerRule(item: QuizPackageItem): AnswerRule {
  if (item.type === 'short-text') {
    return { kind: 'text', acceptedAnswer: item.acceptedAnswer ?? '', caseSensitive: false, punctuationSensitive: false };
  }
  if (item.type === 'number') {
    return { kind: 'number', acceptedValue: item.acceptedAnswer ? Number(item.acceptedAnswer) : undefined, ...item.acceptedRange };
  }
  return { kind: 'choice', correctChoiceIds: item.correctAnswerIds ?? [] };
}

/**
 * Import commit (FR-028, FR-073–075): valid standalone items save even when
 * others are invalid; a passage commits as one atomic unit (all-or-nothing —
 * a reading text is useless with only some of its questions present). Every
 * saved item shares one importBatchId and saves as already approved — there
 * is no review-queue step (amended 2026-09-18; see migrations.ts for the
 * one-time cleanup of items imported before this change).
 */
@Injectable({ providedIn: 'root' })
export class ImportCommitService {
  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly categories: CategoryRepository,
    private readonly validator: PackageValidatorService,
  ) {}

  async commit(pkg: QuizPackage, validIndexes: number[], options: CommitOptions): Promise<CommitResult> {
    const importBatchId = crypto.randomUUID();
    const deviceId = currentDeviceId();
    const savedIds: string[] = [];
    const validation = await this.validator.validate(pkg);
    const normalized = validation.normalizedPackage;
    // Many items in one batch commonly propose the *same* new category (e.g.
    // 100 generated fraction items all proposing "Phân số"). Each item's
    // CategoryResolution was computed independently during validate(), before
    // any of them actually existed, so every one says isProposedNew — without
    // this cache, the 2nd+ item to reach resolveCategoryId would call
    // createCategory again and hit its (correct) duplicate-name rejection,
    // throwing and aborting the rest of the commit loop.
    const createdThisCommit = new Map<string, string>();
    const reviewStatus = 'approved';

    for (const index of validIndexes) {
      if (options.skipIndexes.has(index)) continue;
      const item = normalized.quizzes[index];
      // validIndexes already excludes any item that failed validateItem
      // (including a missing subject/grade), so both are guaranteed present here.
      const subject = item.subject as Subject;
      const grade = item.grade as number;

      const categoryId =
        options.categoryMapping.get(index) ??
        (await this.resolveCategoryId(validation.categoryResolutions.get(index), subject, createdThisCommit));
      if (!categoryId) continue;

      const choices: Choice[] | undefined = item.choices;
      const quizItem: QuizItem = {
        ...newSyncEnvelope(crypto.randomUUID(), deviceId),
        externalId: item.externalId,
        subject,
        grade,
        type: item.type,
        prompt: item.prompt,
        choices,
        answerRule: toAnswerRule(item),
        explanation: item.explanation,
        tags: item.tags ?? [],
        difficulty: item.difficulty ?? 2,
        points: item.points ?? 10,
        categoryId,
        shuffleChoices: item.shuffleChoices ?? true,
        reviewStatus,
        status: 'active',
        importBatchId,
      };
      await this.quizItems.create(quizItem);
      savedIds.push(quizItem.id);
    }

    for (const [index, passage] of (normalized.passages ?? []).entries()) {
      if (options.skipPassageIndexes?.has(index)) continue;
      const result = validation.passageResults.find((r) => r.index === index);
      if (!result || result.errors.length > 0) continue; // atomic: an invalid passage never partially imports

      const categoryId =
        options.passageCategoryMapping?.get(index) ??
        (await this.resolveCategoryId(validation.passageCategoryResolutions.get(index), passage.subject, createdThisCommit));
      if (!categoryId) continue;

      const passageId = crypto.randomUUID();
      const total = passage.questions.length;

      for (const [qIndex, q] of passage.questions.entries()) {
        // result.errors.length === 0 means every question passed validateItem
        // (including its subject/grade), so both are guaranteed present here.
        const passageContext: PassageContext = {
          passageId,
          title: passage.title,
          text: passage.text,
          order: qIndex + 1,
          total,
        };
        const quizItem: QuizItem = {
          ...newSyncEnvelope(crypto.randomUUID(), deviceId),
          externalId: q.externalId,
          subject: q.subject as Subject,
          grade: q.grade as number,
          type: q.type,
          prompt: q.prompt,
          choices: q.choices,
          answerRule: toAnswerRule(q),
          explanation: q.explanation,
          tags: q.tags ?? [],
          difficulty: q.difficulty ?? 2,
          points: q.points ?? 10,
          categoryId,
          shuffleChoices: q.shuffleChoices ?? true,
          reviewStatus,
          status: 'active',
          importBatchId,
          passage: passageContext,
        };
        await this.quizItems.create(quizItem);
        savedIds.push(quizItem.id);
      }
    }

    return { importBatchId, savedIds };
  }

  private async resolveCategoryId(
    resolution: CategoryResolution | undefined,
    fallbackSubject: Subject,
    createdThisCommit: Map<string, string>,
  ): Promise<string | undefined> {
    if (!resolution) return undefined;
    if (resolution.resolvedCategoryId) return resolution.resolvedCategoryId;
    if (resolution.isProposedNew) {
      const subject = (resolution.subject as Subject) ?? fallbackSubject;
      const cacheKey = `${subject}::${normalizeName(resolution.name)}`;
      const cached = createdThisCommit.get(cacheKey);
      if (cached) return cached;

      const created = await this.categories.createCategory(resolution.name, subject);
      createdThisCommit.set(cacheKey, created.id);
      return created.id;
    }
    return undefined;
  }

  /** Undo the most recent import batch, only if none of its items has been used in an attempt (FR-030). */
  async undoBatch(importBatchId: string): Promise<{ undone: boolean; reason?: string }> {
    const all = await this.quizItems.list();
    const batchItems = all.filter((i) => i.importBatchId === importBatchId);
    const batchItemIds = new Set(batchItems.map((i) => i.id));

    const anyUsed = await db.answerResults.filter((a) => batchItemIds.has(a.quizItemId)).first();
    if (anyUsed) {
      return { undone: false, reason: 'One or more items from this batch have already been used in an attempt.' };
    }

    for (const item of batchItems) {
      await this.quizItems.softDelete(item.id);
    }
    return { undone: true };
  }
}
