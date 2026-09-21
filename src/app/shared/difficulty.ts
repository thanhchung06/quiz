import { QuizDifficulty } from './models/domain.model';

/** Display names for the 5 difficulty levels (FR-017, amended 2026-09-18 — was a plain 1-3 number with no name). */
export const DIFFICULTY_LABELS: Record<QuizDifficulty, string> = {
  1: 'Dễ',
  2: 'Trung bình',
  3: 'Khó',
  4: 'Rất khó',
  5: 'Chuyên gia',
};

export const DIFFICULTY_LEVELS: Array<{ value: QuizDifficulty; label: string }> = (
  [1, 2, 3, 4, 5] as QuizDifficulty[]
).map((value) => ({ value, label: DIFFICULTY_LABELS[value] }));

/** A missing value (legacy data predating this field) defaults to 2/Trung bình, same as everywhere else this field is defaulted. */
export function difficultyLabel(value: QuizDifficulty | undefined): string {
  return DIFFICULTY_LABELS[value ?? 2];
}

/** Coerces an arbitrary numeric string (e.g. from a <select> change event) to a valid QuizDifficulty, defaulting to 2 (Trung bình) for anything out of range (FR-017). */
export function coerceDifficulty(value: string): QuizDifficulty {
  const n = Math.round(Number(value));
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 ? n : 2;
}
