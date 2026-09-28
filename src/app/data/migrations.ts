import { CategoryRepository } from './repositories/category.repository';
import { AppSettingsRepository } from './repositories/app-settings.repository';
import { CATEGORY_SUGGESTIONS } from '../features/quiz-bank/import/category-suggestions';

/**
 * Creates the curriculum's common categories (CATEGORY_SUGGESTIONS — the same
 * names the import templates suggest) so the quiz form offers them from the
 * start. Runs once per device: a name that already exists (in any letter
 * case) is left alone, and after the first run nothing is re-added, so a
 * default the parent archives or deletes stays gone.
 */
/**
 * The same id on every device (e.g. "default-math-phan-so"), so two devices
 * that each seeded the defaults end up with one shared category after sync
 * instead of two lookalikes.
 */
export function defaultCategoryId(subject: string, name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `default-${subject}-${slug}`;
}

export async function seedDefaultCategories(categories: CategoryRepository, settings: AppSettingsRepository): Promise<void> {
  if ((await settings.get()).defaultCategoriesSeeded) return;
  for (const suggestion of CATEGORY_SUGGESTIONS) {
    if (await categories.findDuplicate(suggestion.name, suggestion.subject)) continue;
    await categories.createCategory(suggestion.name, suggestion.subject, suggestion.examples, defaultCategoryId(suggestion.subject, suggestion.name), true);
  }
  await settings.update({ defaultCategoriesSeeded: true });
}
