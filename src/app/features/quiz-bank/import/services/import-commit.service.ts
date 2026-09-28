import { Injectable } from '@angular/core';
import { db } from '../../../../data/db';
import { QuizItemRepository } from '../../../../data/repositories/quiz-item.repository';
import { CategoryRepository, normalizeName } from '../../../../data/repositories/category.repository';
import { PackageValidatorService, CategoryResolution } from './package-validator.service';
import { QuizPackage, QuizPackageItem, choicesFromPackage } from '../quiz-package.model';
import { AnswerRule, PassageContext, QuizItem, Subject } from '../../../../shared/models/domain.model';
import { newSyncEnvelope } from '../../../../shared/models/sync.model';
import { currentDeviceId } from '../../../../data/repositories/base-repository';
import { withImageRef } from '../../../../shared/quiz-image/quiz-image.component';

export interface CommitOptions {
  /** Quiz indexes to skip entirely (e.g., duplicates the parent chose to skip). */
  skipIndexes: Set<number>;
  /** index -> categoryId override chosen by the parent in the preview UI. */
  categoryMapping: Map<number, string>;
  /**
   * Quiz index -> existing QuizItem id to overwrite with the file's content
   * instead of adding a new item (the parent chose "update" for likely
   * duplicates, e.g. after editing an exported Excel sheet). The existing
   * id is kept, so exercises that reference it keep working; past attempts
   * are unaffected since they play from their own snapshots (FR-020).
   */
  replaceIndexes?: Map<number, string>;
  /** Passage index -> existing passageId to overwrite (see `replaceIndexes`); matched by its questions' externalIds. */
  replacePassages?: Map<number, string>;
  /** Passage indexes (into pkg.passages) to skip entirely. */
  skipPassageIndexes?: Set<number>;
  /** passage index -> categoryId override chosen by the parent in the preview UI. */
  passageCategoryMapping?: Map<number, string>;
}

export interface CommitResult {
  importBatchId: string;
  /** Newly created items only — the ones undoBatch can remove. */
  savedIds: string[];
  /** Existing items overwritten via `replaceIndexes`. */
  updatedIds: string[];
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

  /** Writes the import in atomic chunks rather than one request per question (see QuizBankRepository.inBatch). */
  async commit(pkg: QuizPackage, validIndexes: number[], options: CommitOptions): Promise<CommitResult> {
    return this.quizItems.inBatch(() => this.commitItems(pkg, validIndexes, options));
  }

  private async commitItems(pkg: QuizPackage, validIndexes: number[], options: CommitOptions): Promise<CommitResult> {
    const importBatchId = crypto.randomUUID();
    const deviceId = currentDeviceId();
    const savedIds: string[] = [];
    const updatedIds: string[] = [];
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

    for (const index of validIndexes) {
      if (options.skipIndexes.has(index)) continue;
      const item = normalized.quizzes[index];
      const categoryId =
        options.categoryMapping.get(index) ??
        (await this.resolveCategoryId(validation.categoryResolutions.get(index), item.subject as Subject, createdThisCommit));
      if (!categoryId) continue;

      const replaceId = options.replaceIndexes?.get(index);
      const existing = replaceId ? await this.quizItems.getById(replaceId) : undefined;
      const id = await this.upsertItem(item, categoryId, existing, { importBatchId, deviceId });
      (existing ? updatedIds : savedIds).push(id);
    }

    for (const [index, passage] of (normalized.passages ?? []).entries()) {
      if (options.skipPassageIndexes?.has(index)) continue;
      const result = validation.passageResults.find((r) => r.index === index);
      if (!result || result.errors.length > 0) continue; // atomic: an invalid passage never partially imports

      const categoryId =
        options.passageCategoryMapping?.get(index) ??
        (await this.resolveCategoryId(validation.passageCategoryResolutions.get(index), passage.subject, createdThisCommit));
      if (!categoryId) continue;

      // Replacing an existing passage keeps its passageId: questions whose
      // externalId matches one of its current sub-questions are updated in
      // place, new ones are added, and sub-questions no longer in the file
      // are removed — so the group stays one passage instead of duplicating.
      const replacePassageId = options.replacePassages?.get(index);
      const siblings = replacePassageId ? await this.quizItems.byPassage(replacePassageId) : [];
      const unmatched = new Map(siblings.map((s) => [s.id, s]));
      const passageId = replacePassageId ?? crypto.randomUUID();
      const total = passage.questions.length;

      for (const [qIndex, q] of passage.questions.entries()) {
        const passageContext: PassageContext = {
          passageId,
          title: passage.title,
          text: passage.text,
          imageUrl: passage.imageUrl?.trim() || undefined,
          order: qIndex + 1,
          total,
        };
        const existing = q.externalId
          ? [...unmatched.values()].find((s) => s.id === q.externalId || s.externalId === q.externalId)
          : undefined;
        if (existing) unmatched.delete(existing.id);
        const id = await this.upsertItem(q, categoryId, existing, { importBatchId, deviceId, passage: passageContext });
        (existing ? updatedIds : savedIds).push(id);
      }
      for (const leftover of unmatched.values()) {
        await this.quizItems.softDelete(leftover.id);
      }
    }

    return { importBatchId, savedIds, updatedIds };
  }

  /**
   * Creates a new QuizItem from a (normalized, validated) package item, or
   * overwrites `existing` in place — keeping its id, status and any other
   * media — when the parent chose to update duplicates. Only created items
   * get the importBatchId, since undo can only remove what this import added.
   */
  private async upsertItem(
    item: QuizPackageItem,
    categoryId: string,
    existing: QuizItem | undefined,
    context: { importBatchId: string; deviceId: string; passage?: PassageContext },
  ): Promise<string> {
    // Validation already rejected any item missing subject/grade (standalone or, after normalization, passage-nested).
    const content = {
      subject: item.subject as Subject,
      grade: item.grade as number,
      type: item.type,
      prompt: item.prompt,
      choices: choicesFromPackage(item.choices),
      answerRule: toAnswerRule(item),
      explanation: item.explanation,
      tags: item.tags ?? [],
      categoryId,
      ...(context.passage ? { passage: context.passage } : {}),
    };

    if (existing) {
      await this.quizItems.update(existing.id, {
        ...content,
        externalId: item.externalId ?? existing.externalId,
        media: withImageRef(existing.media, item.imageUrl),
        difficulty: item.difficulty ?? existing.difficulty ?? 2,
        points: item.points ?? existing.points,
        shuffleChoices: item.shuffleChoices ?? existing.shuffleChoices,
      });
      return existing.id;
    }

    const quizItem: QuizItem = {
      ...newSyncEnvelope(crypto.randomUUID(), context.deviceId),
      ...content,
      externalId: item.externalId,
      media: withImageRef(undefined, item.imageUrl),
      difficulty: item.difficulty ?? 2,
      points: item.points ?? 10,
      shuffleChoices: item.shuffleChoices ?? true,
      reviewStatus: 'approved',
      status: 'active',
      importBatchId: context.importBatchId,
    };
    await this.quizItems.create(quizItem);
    return quizItem.id;
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

  /**
   * Undo the most recent import batch (FR-030). Results and ongoing plays keep
   * their own copies of the questions, so removing them from the bank never
   * changes those.
   */
  async undoBatch(importBatchId: string): Promise<{ undone: boolean; reason?: string }> {
    const all = await this.quizItems.list();
    const batchItems = all.filter((i) => i.importBatchId === importBatchId);
    const deletedAt = new Date().toISOString();
    await this.quizItems.updateMany(batchItems.map((item) => ({ id: item.id, patch: { deletedAt } })));
    return { undone: true };
  }
}
