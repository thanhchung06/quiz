import { QuizItemType } from './models/domain.model';

export type QuestionTypeGroupKey = 'choice' | 'true-false' | 'input';

/**
 * The parent-facing question-type choices used when adding random questions
 * to an exercise: "multiple choice" covers both choice types, "input" covers
 * both typed-answer types. match-pairs is deliberately absent — it has no
 * child-play screen yet, so it should never be drawn at random.
 */
export const QUESTION_TYPE_GROUPS: ReadonlyArray<{ key: QuestionTypeGroupKey; label: string; types: QuizItemType[] }> = [
  { key: 'choice', label: 'Trắc nghiệm', types: ['single-choice', 'multiple-choice'] },
  { key: 'true-false', label: 'Đúng/Sai', types: ['true-false'] },
  { key: 'input', label: 'Nhập đáp án', types: ['short-text', 'number'] },
];

export function typesForGroups(keys: ReadonlySet<QuestionTypeGroupKey>): QuizItemType[] {
  return QUESTION_TYPE_GROUPS.filter((g) => keys.has(g.key)).flatMap((g) => g.types);
}

/** Label for a RandomGroupConfig.allowedTypes list; an empty list (older groups) means any type. */
export function allowedTypesLabel(allowedTypes: QuizItemType[]): string {
  if (allowedTypes.length === 0) return 'Mọi loại câu hỏi';
  const labels = QUESTION_TYPE_GROUPS.filter((g) => g.types.some((t) => allowedTypes.includes(t))).map((g) => g.label);
  return labels.length === QUESTION_TYPE_GROUPS.length ? 'Mọi loại câu hỏi' : labels.join(', ');
}
