import { Choice, QuizDifficulty, QuizItemType, Subject } from '../../../shared/models/domain.model';

/** An answer option in a package file; `imageUrl` (optional) takes the same forms as the question's `imageUrl`. */
export interface QuizPackageChoice {
  id: string;
  text: string;
  imageUrl?: string;
}

/** Package choices ↔ stored choices (the file says `imageUrl`, like the question; the app stores `imageRef`). */
export function choicesFromPackage(choices: QuizPackageChoice[] | undefined): Choice[] | undefined {
  return choices?.map((c) => (c.imageUrl?.trim() ? { id: c.id, text: c.text, imageRef: c.imageUrl.trim() } : { id: c.id, text: c.text }));
}

export function choicesToPackage(choices: Choice[] | undefined): QuizPackageChoice[] | undefined {
  return choices?.map((c) => (c.imageRef ? { id: c.id, text: c.text, imageUrl: c.imageRef } : { id: c.id, text: c.text }));
}

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
  /** Optional illustration shown with the prompt — an absolute http(s) URL, or a path/filename under the app's `assets/images/` folder (see shared/quiz-image). */
  imageUrl?: string;
  choices?: QuizPackageChoice[];
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
  /** Optional illustration shown with the passage text — same URL rules as QuizPackageItem.imageUrl. */
  imageUrl?: string;
  questions: QuizPackageItem[];
}

export interface QuizPackage {
  formatVersion: string;
  packageTitle?: string;
  language?: string;
  quizzes: QuizPackageItem[];
  passages?: QuizPackagePassage[];
  /** Informational only (in the downloadable template): common category names to pick from. Ignored on import. */
  suggestedCategories?: Array<{ subject: Subject; grades: number[]; name: string; examples: string }>;
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
