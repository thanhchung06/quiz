import { QuizItemRepository } from './repositories/quiz-item.repository';
import { CategoryRepository } from './repositories/category.repository';
import { AppSettingsRepository } from './repositories/app-settings.repository';
import { CATEGORY_SUGGESTIONS } from '../features/quiz-bank/import/category-suggestions';

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

/**
 * Creates the curriculum's common categories (CATEGORY_SUGGESTIONS — the same
 * names the import templates suggest) so the quiz form offers them from the
 * start. Runs once per device: a name that already exists (in any letter
 * case) is left alone, and after the first run nothing is re-added, so a
 * default the parent archives or deletes stays gone.
 */
export async function seedDefaultCategories(categories: CategoryRepository, settings: AppSettingsRepository): Promise<void> {
  if ((await settings.get()).defaultCategoriesSeeded) return;
  for (const suggestion of CATEGORY_SUGGESTIONS) {
    if (await categories.findDuplicate(suggestion.name, suggestion.subject)) continue;
    await categories.createCategory(suggestion.name, suggestion.subject, suggestion.examples);
  }
  await settings.update({ defaultCategoriesSeeded: true });
}
