import { Injectable } from '@angular/core';
import { PackageValidatorService } from './package-validator.service';
import { DuplicateDetectorService, PassageDuplicateMatch } from './duplicate-detector.service';
import { normalizeName } from '../../../../data/repositories/category.repository';
import { QuizPackage } from '../quiz-package.model';

export interface PassagePreviewEntry {
  index: number; // index into pkg.passages
  title: string;
  questionCount: number;
  valid: boolean;
  errors: string[];
  proposedCategory?: { name: string; subject: string; possibleDuplicateOf?: string; subjectMismatch: boolean };
}

export interface GradeTypeCount {
  grade: number;
  type: string;
  count: number;
}

export interface ImportPreview {
  totalItems: number; // standalone quizzes + every question across every passage
  validIndexes: number[];
  invalidItems: Array<{ index: number; errors: string[] }>;
  likelyDuplicates: Array<{ index: number; matchesExistingId: string; reason: string }>;
  /** Deduped by (normalized name, subject) — many items commonly propose the same new category (not least the default-category fallback), so this is one row per distinct category, with a count of how many items proposed it. */
  proposedCategories: Array<{ index: number; name: string; subject: string; possibleDuplicateOf?: string; subjectMismatch: boolean; count: number }>;
  skipped: number[];
  /** Passages that match one already in the bank (by their questions' externalIds) — skipped, or replaced as a whole. */
  passageDuplicates: PassageDuplicateMatch[];
  /** Passages import as an atomic unit each (FR-073–075) — not folded into the flat item lists above. */
  passages: PassagePreviewEntry[];
  /** Every question in the file (standalone + passage questions), grouped by grade then type — shown instead of listing every individual item. */
  gradeTypeBreakdown: GradeTypeCount[];
}

/**
 * Import preview (FR-027): total/valid/invalid/duplicate/proposed-category
 * counts shown before anything is saved, per contracts/quiz-package-format.md.
 */
@Injectable({ providedIn: 'root' })
export class ImportPreviewService {
  constructor(
    private readonly validator: PackageValidatorService,
    private readonly duplicates: DuplicateDetectorService,
  ) {}

  async buildPreview(pkg: QuizPackage): Promise<ImportPreview> {
    const validation = await this.validator.validate(pkg);
    const normalized = validation.normalizedPackage;
    const duplicateMatches = validation.formatVersionSupported
      ? await this.duplicates.findDuplicates(normalized.quizzes)
      : [];

    const passageDuplicates = validation.formatVersionSupported
      ? await this.duplicates.findPassageDuplicates(normalized.passages ?? [])
      : [];

    const invalidIndexes = new Set(validation.itemErrors.map((e) => e.index));
    const validIndexes = normalized.quizzes.map((_, i) => i).filter((i) => !invalidIndexes.has(i));

    const proposedByKey = new Map<string, { index: number; name: string; subject: string; possibleDuplicateOf?: string; subjectMismatch: boolean; count: number }>();
    for (const [index, resolution] of validation.categoryResolutions.entries()) {
      if (!resolution.isProposedNew) continue;
      const key = `${resolution.subject}::${normalizeName(resolution.name)}`;
      const existing = proposedByKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        proposedByKey.set(key, {
          index,
          name: resolution.name,
          subject: resolution.subject,
          possibleDuplicateOf: resolution.possibleDuplicateOf,
          subjectMismatch: resolution.subjectMismatch,
          count: 1,
        });
      }
    }
    const proposedCategories = Array.from(proposedByKey.values());

    const passages: PassagePreviewEntry[] = (normalized.passages ?? []).map((passage, index) => {
      const result = validation.passageResults.find((r) => r.index === index);
      const categoryResolution = validation.passageCategoryResolutions.get(index);
      return {
        index,
        title: passage.title,
        questionCount: passage.questions.length,
        valid: (result?.errors.length ?? 0) === 0,
        errors: result?.errors ?? [],
        proposedCategory:
          categoryResolution?.isProposedNew
            ? {
                name: categoryResolution.name,
                subject: categoryResolution.subject,
                possibleDuplicateOf: categoryResolution.possibleDuplicateOf,
                subjectMismatch: categoryResolution.subjectMismatch,
              }
            : undefined,
      };
    });

    const questionsInPassages = (normalized.passages ?? []).reduce((sum, p) => sum + p.questions.length, 0);

    // Items missing a grade are inherently invalid (already reflected in the
    // Không hợp lệ count) and skipped here rather than bucketed under a
    // meaningless "undefined" grade.
    const breakdownCounts = new Map<string, number>();
    for (const item of normalized.quizzes) {
      if (item.grade === undefined) continue;
      const key = `${item.grade}|${item.type}`;
      breakdownCounts.set(key, (breakdownCounts.get(key) ?? 0) + 1);
    }
    for (const passage of normalized.passages ?? []) {
      for (const q of passage.questions) {
        if (q.grade === undefined) continue;
        const key = `${q.grade}|${q.type}`;
        breakdownCounts.set(key, (breakdownCounts.get(key) ?? 0) + 1);
      }
    }
    const gradeTypeBreakdown: GradeTypeCount[] = Array.from(breakdownCounts.entries())
      .map(([key, count]) => {
        const [grade, type] = key.split('|');
        return { grade: Number(grade), type, count };
      })
      .sort((a, b) => a.grade - b.grade || a.type.localeCompare(b.type));

    return {
      totalItems: normalized.quizzes.length + questionsInPassages,
      validIndexes,
      invalidItems: validation.itemErrors,
      likelyDuplicates: duplicateMatches,
      proposedCategories,
      skipped: [],
      passageDuplicates,
      passages,
      gradeTypeBreakdown,
    };
  }

  /**
   * `itemLabel` adds a human-readable location to each invalid item (e.g. an
   * Excel row); `fileProblems` are issues found while reading the file itself.
   */
  downloadErrorReport(
    preview: ImportPreview,
    extras: { itemLabel?: (index: number) => string; fileProblems?: string[] } = {},
  ): string {
    return JSON.stringify(
      {
        fileProblems: extras.fileProblems?.length ? extras.fileProblems : undefined,
        invalidItems: preview.invalidItems.map((item) =>
          extras.itemLabel ? { location: extras.itemLabel(item.index), ...item } : item,
        ),
        invalidPassages: preview.passages.filter((p) => !p.valid),
      },
      null,
      2,
    );
  }
}
