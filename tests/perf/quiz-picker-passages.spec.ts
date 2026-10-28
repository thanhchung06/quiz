/**
 * Responsiveness of the Exercise Builder's quiz picker on a large bank with
 * many reading passages, in daily mode (FR-091) — the case where switching the
 * random-add kind to "Đoạn văn" used to lag. Timings are printed; the
 * assertions are loose ceilings that catch a regression, not targets.
 */
import { TestBed } from '@angular/core/testing';
import { QuizPickerComponent } from '../../src/app/features/exercise-builder/quiz-picker/quiz-picker.component';
import { CategoryRepository } from '../../src/app/data/repositories/category.repository';
import { QuizItemRepository } from '../../src/app/data/repositories/quiz-item.repository';
import { Category, QuizItem } from '../../src/app/shared/models/domain.model';
import { newSyncEnvelope } from '../../src/app/shared/models/sync.model';

const CATEGORIES = 40;
const PASSAGES_PER_CATEGORY = 25;
const QUESTIONS_PER_PASSAGE = 5;
const STANDALONE_PER_CATEGORY = 50;
const deviceId = 'perf-test-device';

function timed<T>(label: string, work: () => T): number {
  const start = performance.now();
  work();
  const ms = performance.now() - start;
  console.log(`[quiz-picker passages] ${label}: ${ms.toFixed(0)} ms`);
  return ms;
}

function buildBank(): { categories: Category[]; items: QuizItem[] } {
  const categories: Category[] = [];
  const items: QuizItem[] = [];
  const base = (id: string, categoryId: string, prompt: string): QuizItem => ({
    ...newSyncEnvelope(id, deviceId),
    subject: 'language',
    grade: 5,
    type: 'single-choice',
    prompt,
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answerRule: { kind: 'choice', correctChoiceIds: ['a'] },
    tags: [],
    difficulty: 2,
    points: 10,
    categoryId,
    shuffleChoices: false,
    reviewStatus: 'approved',
    status: 'active',
  });
  for (let c = 0; c < CATEGORIES; c++) {
    const categoryId = `cat-${c}`;
    categories.push({ ...newSyncEnvelope(categoryId, deviceId), name: `Đọc hiểu ${c}`, normalizedName: `doc hieu ${c}`, subject: 'language', status: 'active' });
    for (let p = 0; p < PASSAGES_PER_CATEGORY; p++) {
      const passageId = `${categoryId}-p${p}`;
      for (let q = 0; q < QUESTIONS_PER_PASSAGE; q++) {
        items.push({
          ...base(`${passageId}-q${q}`, categoryId, `Câu ${q} của đoạn ${passageId}`),
          passage: { passageId, title: `Đoạn văn ${passageId}`, text: 'Lorem ipsum '.repeat(80), order: q + 1, total: QUESTIONS_PER_PASSAGE },
        });
      }
    }
    for (let q = 0; q < STANDALONE_PER_CATEGORY; q++) items.push(base(`${categoryId}-s${q}`, categoryId, `Câu lẻ ${q} của ${categoryId}`));
  }
  return { categories, items };
}

describe(`quiz picker, daily mode (${CATEGORIES * (PASSAGES_PER_CATEGORY * QUESTIONS_PER_PASSAGE + STANDALONE_PER_CATEGORY)} questions, ${CATEGORIES * PASSAGES_PER_CATEGORY} passages)`, () => {
  it('switches the random-add kind to passages without lag', async () => {
    const { categories, items } = buildBank();
    TestBed.configureTestingModule({
      imports: [QuizPickerComponent],
      providers: [
        { provide: CategoryRepository, useValue: { list: async () => categories } },
        { provide: QuizItemRepository, useValue: { search: async () => items } },
      ],
    });
    const fixture = TestBed.createComponent(QuizPickerComponent);
    fixture.componentRef.setInput('existingItems', []);
    fixture.componentRef.setInput('grade', 5);
    fixture.componentRef.setInput('exerciseSubject', 'language');
    fixture.componentRef.setInput('dailyMode', true);
    await fixture.whenStable();

    timed('first render', () => fixture.detectChanges());
    const picker = fixture.componentInstance;

    const toPassages = timed('switch to "Đoạn văn"', () => {
      picker.setDrawKind('passages');
      fixture.detectChanges();
    });
    expect(picker.passagePool().length).toBe(CATEGORIES * PASSAGES_PER_CATEGORY);

    const byQuestions = timed('switch to "Theo tổng số câu"', () => {
      picker.setPassageBy('questions');
      fixture.detectChanges();
    });
    const typing = timed('type a count', () => {
      picker.bulkCount.set('12');
      fixture.detectChanges();
    });
    const category = timed('select a category', () => {
      picker.selectCategory('cat-3');
      fixture.detectChanges();
    });
    const addSlot = timed('add a daily slot', () => {
      picker.confirmAddRandomGroup();
      fixture.detectChanges();
    });

    for (const ms of [toPassages, byQuestions, typing, category, addSlot]) expect(ms).toBeLessThan(500);
  }, 60_000);
});
