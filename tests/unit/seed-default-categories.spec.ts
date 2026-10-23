import { seedDefaultCategories } from '../../src/app/data/migrations';
import { CATEGORY_SUGGESTIONS } from '../../src/app/features/quiz-bank/import/category-suggestions';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { AppSettings } from '../../src/app/shared/models/domain.model';

function fakes(existing: string[], initial: Partial<AppSettings> = {}) {
  const names = [...existing];
  let stored: Partial<AppSettings> = { ...initial };
  const categories = {
    findDuplicate: async (name: string) =>
      names.some((n) => n.toLowerCase() === name.toLowerCase()) ? ({ name } as never) : undefined,
    createCategory: jest.fn(async (name: string) => {
      names.push(name);
      return { name } as never;
    }),
  } as unknown as CategoryRepository & { createCategory: jest.Mock };
  const settings = {
    get: async () => stored,
    update: async (patch: Partial<AppSettings>) => {
      stored = { ...stored, ...patch };
    },
  } as unknown as AppSettingsRepository;
  return { categories, settings, names };
}

const englishSuggestions = CATEGORY_SUGGESTIONS.filter((s) => s.subject === 'english');

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

  it('a device seeded before Tiếng Anh existed gets only the Tiếng Anh defaults, once', async () => {
    expect(englishSuggestions.length).toBeGreaterThan(0);
    const f = fakes([], { defaultCategoriesSeeded: true });

    await seedDefaultCategories(f.categories, f.settings);
    expect(f.categories.createCategory.mock.calls.map((c) => c[1])).toEqual(englishSuggestions.map(() => 'english'));
    expect(f.names).toEqual(englishSuggestions.map((s) => s.name));

    f.categories.createCategory.mockClear();
    await seedDefaultCategories(f.categories, f.settings);
    expect(f.categories.createCategory).not.toHaveBeenCalled();
  });
});
