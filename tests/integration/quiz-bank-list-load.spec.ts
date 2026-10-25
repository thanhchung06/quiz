/**
 * Load time of the quiz bank management screen on a large bank:
 * 3 subjects × 5 grades × 100 categories × 20 questions = 30,000 questions, 1,500 categories.
 * Seeds a real Dexie (fake-indexeddb), then times each stage the screen goes through:
 * reading the local copy, building the tree, first render, and opening one category.
 * Timings are printed; the assertions are loose ceilings that catch a regression, not targets.
 */
import './structured-clone-polyfill';
import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { db } from '../../src/app/data/db';
import { QuizBankListComponent } from '../../src/app/features/quiz-bank/quiz-bank-list/quiz-bank-list.component';
import { QuizExportService } from '../../src/app/features/quiz-bank/export/export.service';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { QuizBankSyncService } from '../../src/app/remote/quiz-bank-sync.service';
import { RemoteStore } from '../../src/app/remote/remote-store';
import { Category, QuizItem, Subject } from '../../src/app/shared/models/domain.model';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';

const SUBJECTS: Subject[] = ['math', 'language', 'english'];
const GRADES = [1, 2, 3, 4, 5];
const CATEGORIES_PER_GRADE = 100;
const ITEMS_PER_CATEGORY = 20;
const deviceId = 'perf-test-device';

async function timed<T>(label: string, work: () => Promise<T> | T): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await work();
  const ms = performance.now() - start;
  console.log(`[quiz-bank-list load] ${label}: ${ms.toFixed(0)} ms`);
  return { result, ms };
}

describe('quiz bank list load time (30,000 questions, 1,500 categories)', () => {
  beforeAll(async () => {
    const categories: Category[] = [];
    const items: QuizItem[] = [];
    for (const subject of SUBJECTS) {
      for (const grade of GRADES) {
        for (let c = 0; c < CATEGORIES_PER_GRADE; c++) {
          const categoryId = `cat-${subject}-${grade}-${c}`;
          categories.push({
            ...newSyncEnvelope(categoryId, deviceId),
            name: `Danh mục ${subject} lớp ${grade} số ${c}`,
            normalizedName: `danh muc ${subject} ${grade} ${c}`,
            subject,
            status: 'active',
          });
          for (let q = 0; q < ITEMS_PER_CATEGORY; q++) {
            items.push({
              ...newSyncEnvelope(`q-${categoryId}-${q}`, deviceId),
              subject,
              grade,
              type: 'number',
              prompt: `Câu hỏi thử ${q} của ${categoryId}`,
              answerRule: { kind: 'number', acceptedValue: q },
              tags: [`tag-${q % 5}`],
              difficulty: ((q % 3) + 1) as 1 | 2 | 3,
              points: 10,
              categoryId,
              shuffleChoices: false,
              reviewStatus: 'approved',
              status: 'active',
            });
          }
        }
      }
    }
    await timed('seed local database', async () => {
      await db.categories.bulkAdd(categories);
      await db.quizItems.bulkAdd(items);
    });
  }, 120_000);

  it('counts and loads without reading every question', async () => {
    const quizItems = new QuizItemRepository({} as RemoteStore);
    const counts = await timed('categoryCounts (index keys only)', () => quizItems.categoryCounts());
    const node = await timed('byNode (one category)', () => quizItems.byNode('math', 1, 'cat-math-1-0'));
    expect(counts.result).toHaveLength(1_500);
    expect(counts.result.every((c) => c.count === ITEMS_PER_CATEGORY)).toBe(true);
    expect(node.result).toHaveLength(ITEMS_PER_CATEGORY);
    // No time ceiling: fake-indexeddb walks index keys far slower than a browser does.
  }, 60_000);

  it('leaves soft-deleted questions out of the counts', async () => {
    const quizItems = new QuizItemRepository({} as RemoteStore);
    await db.quizItems.update('q-cat-math-1-0-0', { deletedAt: new Date().toISOString() });
    const counts = await quizItems.categoryCounts();
    expect(counts.find((c) => c.categoryId === 'cat-math-1-0')?.count).toBe(ITEMS_PER_CATEGORY - 1);
    expect(await quizItems.byNode('math', 1, 'cat-math-1-0')).toHaveLength(ITEMS_PER_CATEGORY - 1);
    await db.quizItems.update('q-cat-math-1-0-0', { deletedAt: undefined });
  }, 120_000);

  it('renders collapsed, opens one node per level, and caches opened nodes', async () => {
    const sync = { sync: jest.fn(async () => false) };
    TestBed.configureTestingModule({
      imports: [QuizBankListComponent],
      providers: [
        provideRouter([]),
        { provide: RemoteStore, useValue: {} },
        { provide: QuizBankSyncService, useValue: sync },
        { provide: QuizExportService, useValue: {} },
      ],
    });
    TestBed.inject(Router);

    const fixture = TestBed.createComponent(QuizBankListComponent);
    const component = fixture.componentInstance;

    await timed('component reload() (counts + categories)', () => component.reload());
    const tree = await timed('tree() computed (1,500 nodes)', () => component.tree());
    expect(tree.result.reduce((n, s) => n + s.grades.reduce((m, g) => m + g.categories.length, 0), 0)).toBe(1_500);

    const render = await timed('first render (detectChanges)', () => fixture.detectChanges());
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.category-node')).toHaveLength(0); // everything starts collapsed

    const [first, second] = tree.result;
    component.toggle(first.key);
    expect(component.isCollapsed(first.key)).toBe(false);
    component.toggle(second.key);
    expect(component.isCollapsed(first.key)).toBe(true); // opening a subject closes the other
    expect(component.isCollapsed(second.key)).toBe(false);

    const [grade1, grade2] = second.grades;
    component.toggle(grade1.key);
    component.toggle(grade2.key);
    expect(component.isCollapsed(grade1.key)).toBe(true); // same for grades
    expect(component.isCollapsed(grade2.key)).toBe(false);
    await timed('render with one grade open', () => fixture.detectChanges());
    expect(el.querySelectorAll('.category-node')).toHaveLength(CATEGORIES_PER_GRADE);

    const [catA, catB] = grade2.categories;
    const open = await timed('open a category (first time, reads its questions)', () => component.toggleCategory(catA));
    expect(component.expandedCategoryKey()).toBe(catA.key);
    fixture.detectChanges();
    expect(el.querySelectorAll('.quiz-leaf-list li')).toHaveLength(ITEMS_PER_CATEGORY);

    await component.toggleCategory(catB);
    expect(component.expandedCategoryKey()).toBe(catB.key); // opening a category closes the other
    const again = await timed('open the first category again (cached)', () => component.toggleCategory(catA));
    fixture.detectChanges();
    expect(el.querySelectorAll('.quiz-leaf-list li')).toHaveLength(ITEMS_PER_CATEGORY);
    expect(sync.sync).toHaveBeenCalledTimes(1); // later opens within the recheck window skip the server

    expect(render.ms).toBeLessThan(5_000);
    expect(open.ms).toBeLessThan(2_000);
    expect(again.ms).toBeLessThan(50);
  }, 120_000);
});
