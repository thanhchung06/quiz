import { seedDefaultCategories } from '../../src/app/data/migrations';
import { CATEGORY_SUGGESTIONS } from '../../src/app/features/quiz-bank/import/category-suggestions';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';

function fakes(existing: string[], seeded = false) {
  const names = [...existing];
  let flag = seeded;
  const categories = {
    findDuplicate: async (name: string) => (names.some((n) => n.toLowerCase() === name.toLowerCase()) ? ({ name } as never) : undefined),
    createCategory: jest.fn(async (name: string) => {
      names.push(name);
      return { name } as never;
    }),
  } as unknown as CategoryRepository & { createCategory: jest.Mock };
  const settings = {
    get: async () => ({ defaultCategoriesSeeded: flag }),
    update: async (p: { defaultCategoriesSeeded?: boolean }) => {
      flag = !!p.defaultCategoriesSeeded;
    },
  } as unknown as AppSettingsRepository;
  return { categories, settings, names };
}

describe('seedDefaultCategories', () => {
  it('creates every suggested category that is missing, skipping existing names', async () => {
    const f = fakes(['phân số']);
    await seedDefaultCategories(f.categories, f.settings);
    expect(f.categories.createCategory).toHaveBeenCalledTimes(CATEGORY_SUGGESTIONS.length - 1);
    expect(f.names.filter((n) => n.toLowerCase() === 'phân số')).toHaveLength(1);
  });

  it('runs only once, so deleted defaults are not re-added', async () => {
    const f = fakes([]);
    await seedDefaultCategories(f.categories, f.settings);
    f.categories.createCategory.mockClear();
    await seedDefaultCategories(f.categories, f.settings);
    expect(f.categories.createCategory).not.toHaveBeenCalled();
  });
});
