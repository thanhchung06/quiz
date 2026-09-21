import { QuizItemRepository } from './repositories/quiz-item.repository';

/**
 * One-time cleanup for the 2026-09-18 removal of the import approval step:
 * every quiz item is now always approved on import, so the "needs review"
 * status can never be newly created — but any item imported before this
 * change may still carry it. Runs on every app start; a no-op once nothing
 * is left pending (checked first, so this never touches an already-clean DB).
 */
export async function approveAllPendingQuizItems(quizItems: QuizItemRepository): Promise<void> {
  const pending = await quizItems.search({ reviewStatus: 'needsReview' });
  if (pending.length === 0) return;
  await Promise.all(pending.map((item) => quizItems.update(item.id, { reviewStatus: 'approved' })));
}
