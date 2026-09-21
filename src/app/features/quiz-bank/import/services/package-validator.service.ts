import { Injectable } from '@angular/core';
import Ajv, { ValidateFunction } from 'ajv';
import { QUIZ_PACKAGE_SCHEMA } from './quiz-package.schema';
import { QuizPackage, QuizPackageItem, SUPPORTED_FORMAT_VERSIONS, normalizePackagePassages } from '../quiz-package.model';
import { CategoryRepository, normalizeName } from '../../../../data/repositories/category.repository';

export interface ItemValidation {
  index: number;
  errors: string[];
}

export interface PassageValidation {
  index: number; // index into pkg.passages
  errors: string[]; // passage-level plus every question's own errors, prefixed "Câu N: "
}

export interface CategoryResolution {
  externalKey?: string;
  name: string;
  subject: string;
  resolvedCategoryId?: string;
  isProposedNew: boolean;
  possibleDuplicateOf?: string;
  subjectMismatch: boolean;
}

/** Used when a package item/passage omits `category` entirely — resolved through the same lookup-or-propose path as any named category, per subject (FR-022). */
export const DEFAULT_CATEGORY_NAME = 'Khác';

export interface PackageValidationResult {
  formatVersionSupported: boolean;
  schemaErrors: string[];
  itemErrors: ItemValidation[];
  categoryResolutions: Map<number, CategoryResolution>;
  /** The package with every passage question's subject/grade/category defaulted — use this for commit, not the raw input. */
  normalizedPackage: QuizPackage;
  /** One entry per pkg.passages[index], in order; empty `errors` means that passage is importable as a whole unit. */
  passageResults: PassageValidation[];
  passageCategoryResolutions: Map<number, CategoryResolution>;
}

/**
 * Validates an imported JSON quiz package (FR-026): format version, required
 * fields, subject/grade/type validity, choice/correct-answer id integrity,
 * and category resolution (external key first, then normalized name+subject,
 * else propose a new category) per contracts/quiz-package-format.md.
 *
 * A `passages` group (FR-073–075) is validated as one atomic unit: if any of
 * its questions is invalid, the whole passage is reported invalid rather
 * than partially importing a reading text with some questions missing.
 */
@Injectable({ providedIn: 'root' })
export class PackageValidatorService {
  private readonly ajv = new Ajv({ allErrors: true });
  private readonly validateSchema: ValidateFunction = this.ajv.compile(QUIZ_PACKAGE_SCHEMA);

  constructor(private readonly categories: CategoryRepository) {}

  async validate(rawPkg: QuizPackage): Promise<PackageValidationResult> {
    const normalizedPackage = normalizePackagePassages(rawPkg);
    const schemaValid = this.validateSchema(normalizedPackage);
    const schemaErrors = schemaValid
      ? []
      : (this.validateSchema.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);

    const formatVersionSupported = SUPPORTED_FORMAT_VERSIONS.includes(normalizedPackage.formatVersion);

    const itemErrors: ItemValidation[] = [];
    const categoryResolutions = new Map<number, CategoryResolution>();
    const passageResults: PassageValidation[] = [];
    const passageCategoryResolutions = new Map<number, CategoryResolution>();

    if (formatVersionSupported && schemaValid) {
      for (const [index, item] of normalizedPackage.quizzes.entries()) {
        const errors = this.validateItem(item);
        if (errors.length > 0) itemErrors.push({ index, errors });

        // Falls back to 'math' only for category-resolution display purposes
        // on an item that's already missing subject — validateItem above
        // has already recorded that as its own error, excluding it from import.
        // An item with no category at all resolves to the default category
        // for its subject instead of being silently dropped at commit time
        // (FR-022, amended 2026-09-18 — see resolveCategoryId's `if (!categoryId) continue`).
        categoryResolutions.set(
          index,
          await this.resolveCategory(item.category ?? { name: DEFAULT_CATEGORY_NAME }, item.subject ?? 'math'),
        );
      }

      for (const [index, passage] of (normalizedPackage.passages ?? []).entries()) {
        const errors: string[] = [];
        if (!passage.title.trim()) errors.push('Cần có tiêu đề đoạn văn/bài toán.');
        if (!passage.text.trim()) errors.push('Cần có nội dung đoạn văn/bài toán.');
        if (passage.questions.length < 2) errors.push('Cần ít nhất 2 câu hỏi trong một đoạn văn/bài toán.');
        passage.questions.forEach((q, qIndex) => {
          for (const e of this.validateItem(q)) errors.push(`Câu ${qIndex + 1}: ${e}`);
        });
        passageResults.push({ index, errors });

        passageCategoryResolutions.set(
          index,
          await this.resolveCategory(passage.category ?? { name: DEFAULT_CATEGORY_NAME }, passage.subject),
        );
      }
    }

    return {
      formatVersionSupported,
      schemaErrors,
      itemErrors,
      categoryResolutions,
      normalizedPackage,
      passageResults,
      passageCategoryResolutions,
    };
  }

  private validateItem(item: QuizPackageItem): string[] {
    const errors: string[] = [];
    if (!item.subject) errors.push('subject is required.');
    if (!item.grade) errors.push('grade is required.');
    const choiceBased = ['single-choice', 'multiple-choice', 'true-false', 'match-pairs'].includes(item.type);

    if (choiceBased) {
      if (!item.choices || item.choices.length < 2) {
        errors.push('Choice-based questions require at least 2 choices.');
      }
      if (!item.correctAnswerIds || item.correctAnswerIds.length < 1) {
        errors.push('Choice-based questions require at least 1 correct answer id.');
      } else {
        const ids = new Set((item.choices ?? []).map((c) => c.id));
        for (const id of item.correctAnswerIds) {
          if (!ids.has(id)) errors.push(`correctAnswerIds references unknown choice id "${id}".`);
        }
      }
    }

    if (item.type === 'short-text' && !item.acceptedAnswer) {
      errors.push('short-text questions require acceptedAnswer.');
    }
    if (item.type === 'number' && !item.acceptedAnswer && !item.acceptedRange) {
      errors.push('number questions require acceptedAnswer or acceptedRange.');
    }

    return errors;
  }

  private async resolveCategory(
    ref: { externalKey?: string; name: string; subject?: string },
    itemSubject: string,
  ): Promise<CategoryResolution> {
    const all = await this.categories.list();

    if (ref.externalKey) {
      const byKey = all.find((c) => c.id === ref.externalKey);
      if (byKey) {
        return {
          externalKey: ref.externalKey,
          name: ref.name,
          subject: ref.subject ?? itemSubject,
          resolvedCategoryId: byKey.id,
          isProposedNew: false,
          subjectMismatch: (ref.subject ?? itemSubject) !== byKey.subject && byKey.subject !== 'both',
        };
      }
    }

    const normalized = normalizeName(ref.name);
    const byName = all.find((c) => c.normalizedName === normalized);
    if (byName) {
      return {
        externalKey: ref.externalKey,
        name: ref.name,
        subject: ref.subject ?? itemSubject,
        resolvedCategoryId: byName.id,
        isProposedNew: false,
        subjectMismatch: (ref.subject ?? itemSubject) !== byName.subject && byName.subject !== 'both',
      };
    }

    const possibleDuplicate = all.find((c) => this.isSimilar(c.normalizedName, normalized));
    return {
      externalKey: ref.externalKey,
      name: ref.name,
      subject: ref.subject ?? itemSubject,
      isProposedNew: true,
      possibleDuplicateOf: possibleDuplicate?.id,
      subjectMismatch: false,
    };
  }

  private isSimilar(a: string, b: string): boolean {
    return a === b || a.includes(b) || b.includes(a);
  }
}
