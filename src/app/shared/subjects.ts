import { CategorySubject, Exercise, Subject } from './models/domain.model';

/** Every subject a question can belong to, in the order screens list them. */
export const SUBJECTS: readonly Subject[] = ['math', 'language', 'english'];

export const SUBJECT_LABELS: Record<Subject, string> = { math: 'Toán', language: 'Tiếng Việt', english: 'Tiếng Anh' };

/** A category marked 'both' is shared by every subject. */
export const CATEGORY_SUBJECT_LABELS: Record<CategorySubject, string> = { ...SUBJECT_LABELS, both: 'Tất cả các môn' };

export const EXERCISE_SUBJECT_LABELS: Record<Exercise['subject'], string> = { ...SUBJECT_LABELS, mixed: 'Kết hợp' };

/** Whether a category can hold questions of this subject. */
export function categoryFitsSubject(categorySubject: CategorySubject, subject: Subject): boolean {
  return categorySubject === subject || categorySubject === 'both';
}
