import { Choice, QuizDifficulty, QuizItemType, Subject } from '../../../shared/models/domain.model';

export interface QuizPackageCategoryRef {
  externalKey?: string;
  name: string;
  subject?: Subject;
}

export interface QuizPackageItem {
  externalId?: string;
  /**
   * Required for a top-level `quizzes[]` entry. May be omitted for a
   * `passages[].questions[]` entry, in which case it is inherited from the
   * passage — see `normalizePackagePassages`, which fills it in before
   * validation/commit ever inspect the item, so downstream code can treat
   * it as present once normalized.
   */
  subject?: Subject;
  grade?: number;
  /** Optional — an item with no category falls back to a default category per subject rather than being dropped (FR-022, amended 2026-09-18; see PackageValidatorService's default-category resolution). */
  category?: QuizPackageCategoryRef;
  tags?: string[];
  difficulty?: QuizDifficulty;
  type: QuizItemType;
  prompt: string;
  choices?: Choice[];
  correctAnswerIds?: string[];
  acceptedAnswer?: string;
  acceptedRange?: { min: number; max: number };
  shuffleChoices?: boolean;
  explanation?: string;
  points?: number;
}

/**
 * A shared reading passage / problem statement with several sub-questions
 * (formatVersion 1.1+, see contracts/quiz-package-format.md). Each entry in
 * `questions` is a normal QuizPackageItem; `subject`/`grade`/`category` may
 * be omitted on a question and are inherited from the passage.
 */
export interface QuizPackagePassage {
  externalKey?: string;
  subject: Subject;
  grade: number;
  category?: QuizPackageCategoryRef;
  title: string;
  text: string;
  questions: QuizPackageItem[];
}

export interface QuizPackage {
  formatVersion: string;
  packageTitle?: string;
  language?: string;
  quizzes: QuizPackageItem[];
  passages?: QuizPackagePassage[];
}

export const SUPPORTED_FORMAT_VERSIONS = ['1.0', '1.1'];

/**
 * Fills in each passage question's subject/grade/category from its parent
 * passage when the question itself omits them, so every question (top-level
 * or passage-nested) is uniformly self-contained before validation/commit
 * ever inspect it. Returns a new package; never mutates the input.
 */
export function normalizePackagePassages(pkg: QuizPackage): QuizPackage {
  if (!pkg.passages || pkg.passages.length === 0) return pkg;
  return {
    ...pkg,
    passages: pkg.passages.map((passage) => ({
      ...passage,
      questions: passage.questions.map((q) => ({
        ...q,
        subject: q.subject ?? passage.subject,
        grade: q.grade ?? passage.grade,
        category: q.category ?? passage.category,
      })),
    })),
  };
}
