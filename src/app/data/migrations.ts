import { CategoryRepository } from './repositories/category.repository';
import { AppSettingsRepository } from './repositories/app-settings.repository';
import { CATEGORY_SUGGESTIONS } from '../features/quiz-bank/import/category-suggestions';
import { Subject } from '../shared/models/domain.model';
import { SUBJECTS } from '../shared/subjects';

/**
 * Creates the curriculum's common categories (CATEGORY_SUGGESTIONS — the same
 * names the import templates suggest) so the quiz form offers them from the
 * start. Runs once per device and subject: a name that already exists (in
 * any letter case) is left alone, and a subject seeded before is never
 * seeded again, so a default the parent archives or deletes stays gone —
 * while a subject added later (Tiếng Anh) still gets its defaults.
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
  const current = await settings.get();
  const seeded = new Set<Subject>(current.defaultCategorySubjects ?? (current.defaultCategoriesSeeded ? ['math', 'language'] : []));
  if (SUBJECTS.every((s) => seeded.has(s))) return;
  for (const suggestion of CATEGORY_SUGGESTIONS) {
    if (seeded.has(suggestion.subject)) continue;
    if (await categories.findDuplicate(suggestion.name, suggestion.subject)) continue;
    await categories.createCategory(suggestion.name, suggestion.subject, suggestion.examples, defaultCategoryId(suggestion.subject, suggestion.name), true);
  }
  await settings.update({ defaultCategoriesSeeded: true, defaultCategorySubjects: [...SUBJECTS] });
}
