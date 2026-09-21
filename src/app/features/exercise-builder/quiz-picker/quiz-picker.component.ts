import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { Category, Exercise, ExerciseItem, QuestionTimingMode, QuizDifficulty, QuizItem, QuizItemType, RandomGroupConfig, Subject } from '../../../shared/models/domain.model';
import { DIFFICULTY_LEVELS, coerceDifficulty, difficultyLabel } from '../../../shared/difficulty';
import { IconComponent } from '../../../shared/icon/icon.component';

const TYPE_LABELS: Record<QuizItemType, string> = {
  'single-choice': 'Chọn một',
  'multiple-choice': 'Chọn nhiều',
  'short-text': 'Điền từ',
  number: 'Số',
  'true-false': 'Đúng/Sai',
  'match-pairs': 'Ghép đôi',
};

const SUBJECT_LABELS: Record<Subject, string> = { math: 'Toán', language: 'Tiếng Việt' };

/** The bulk-add/daily-slot difficulty picker also offers "All", unlike a single QuizItem's own difficulty field which must always be one concrete level. */
type BulkDifficultySelection = QuizDifficulty | 'all';

interface CategoryNode {
  category: Category;
  count: number;
}

interface SubjectGroup {
  subject: Subject;
  label: string;
  categories: CategoryNode[];
}

/**
 * Full quiz browser for the Exercise Builder's "add question" flow: a
 * category tree on the left, the filtered item list (or a clicked item's
 * detail + per-exercise overrides) in the middle, and a live read-only view
 * of what's already in the exercise on the right — so duplicates are both
 * visibly disabled and structurally prevented via `picked` only firing for
 * items the parent doesn't already have.
 *
 * Whenever no single item is selected, the detail panel instead shows a
 * bulk random-add form (amended 2026-09-18): pick a difficulty level, a
 * question count, and an optional per-question time/points override, and
 * that many distinct, not-already-added, non-passage items matching the
 * current category/search filter and difficulty are drawn at random and
 * added in one `pickedMany` emission — passages are excluded from this pool
 * the same way they're excluded from a random *group*'s candidate
 * resolution, so a bulk add can never split one apart.
 *
 * In `dailyMode` (added 2026-09-18, for a daily exercise's `isDaily`
 * builder) individual-item selection is disabled entirely — the parent can
 * only ever add a category/difficulty/count/time/points *slot*, emitted as
 * a `RandomGroupConfig` via `addedRandomGroup` rather than resolving any
 * concrete quiz right now; the actual questions are drawn fresh every time
 * the exercise is started (FR-091).
 */
@Component({
  selector: 'app-quiz-picker',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './quiz-picker.component.html',
  styleUrl: './quiz-picker.component.scss',
})
export class QuizPickerComponent {
  @Input({ required: true }) existingItems: ExerciseItem[] = [];
  @Input() questionTimingMode: QuestionTimingMode = 'none';
  /** The exercise's own grade — the browser only ever shows bank items matching it. */
  @Input({ required: true }) grade!: number;
  /** The exercise's own subject — 'math'/'language' restricts the browser to that subject only; 'mixed' shows both. */
  @Input({ required: true }) exerciseSubject!: Exercise['subject'];
  /** Daily exercise mode (FR-091): disables individual-item selection entirely; the detail panel's form always adds a random *slot* instead of resolving concrete items now. */
  @Input() dailyMode = false;
  @Output() readonly picked = new EventEmitter<{ quizItemId: string; timeLimitSeconds?: number; points?: number }>();
  /** Emitted once per bulk random-add, carrying every drawn item's id plus the same time/points override applied to all of them. Never fired in `dailyMode` — see `addedRandomGroup`. */
  @Output() readonly pickedMany = new EventEmitter<Array<{ quizItemId: string; timeLimitSeconds?: number; points?: number }>>();
  /** `dailyMode` only: emitted once per "add slot" action, carrying a ready-to-store `RandomGroupConfig` — no concrete quiz ids, since those are drawn fresh every time the exercise is started. */
  @Output() readonly addedRandomGroup = new EventEmitter<RandomGroupConfig>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly categories = signal<Category[]>([]);
  readonly allItems = signal<QuizItem[]>([]);
  readonly selectedCategoryId = signal<string>('all');
  readonly searchText = signal('');
  readonly selectedItem = signal<QuizItem | undefined>(undefined);
  readonly draftSeconds = signal('');
  readonly draftPoints = signal('');

  /** "Tất cả độ khó" (All) plus the 5 named levels — only for this bulk/daily-slot picker, never for a single QuizItem's own difficulty field. */
  readonly bulkDifficultyOptions: Array<{ value: BulkDifficultySelection; label: string }> = [
    { value: 'all', label: 'Tất cả độ khó' },
    ...DIFFICULTY_LEVELS,
  ];
  readonly bulkDifficulty = signal<BulkDifficultySelection>('all');
  readonly bulkCount = signal('5');
  readonly bulkSeconds = signal('');
  readonly bulkPoints = signal('');
  readonly bulkMessage = signal('');

  /** allItems narrowed to this exercise's grade AND subject ('mixed' keeps both subjects) — every other view (tree counts, list, "all" count) is built from this. */
  private readonly scopedItems = computed(() =>
    this.allItems().filter((q) => q.grade === this.grade && (this.exerciseSubject === 'mixed' || q.subject === this.exerciseSubject)),
  );

  readonly tree = computed<SubjectGroup[]>(() => {
    const counts = new Map<string, number>();
    for (const q of this.scopedItems()) counts.set(q.categoryId, (counts.get(q.categoryId) ?? 0) + 1);

    const wantMath = this.exerciseSubject === 'mixed' || this.exerciseSubject === 'math';
    const wantLanguage = this.exerciseSubject === 'mixed' || this.exerciseSubject === 'language';
    const groups: SubjectGroup[] = [];
    if (wantMath) groups.push({ subject: 'math', label: SUBJECT_LABELS.math, categories: [] });
    if (wantLanguage) groups.push({ subject: 'language', label: SUBJECT_LABELS.language, categories: [] });

    for (const category of this.categories()) {
      const node: CategoryNode = { category, count: counts.get(category.id) ?? 0 };
      const mathGroup = groups.find((g) => g.subject === 'math');
      const langGroup = groups.find((g) => g.subject === 'language');
      if (mathGroup && (category.subject === 'math' || category.subject === 'both')) mathGroup.categories.push(node);
      if (langGroup && (category.subject === 'language' || category.subject === 'both')) langGroup.categories.push(node);
    }
    for (const g of groups) g.categories.sort((a, b) => a.category.name.localeCompare(b.category.name, 'vi'));
    return groups.filter((g) => g.categories.length > 0);
  });

  readonly filteredItems = computed(() => {
    const categoryId = this.selectedCategoryId();
    const search = this.searchText().trim().toLowerCase();
    return this.scopedItems().filter((q) => {
      if (categoryId !== 'all' && q.categoryId !== categoryId) return false;
      if (search && !q.prompt.toLowerCase().includes(search)) return false;
      return true;
    });
  });

  readonly allCount = computed(() => this.scopedItems().length);

  /**
   * The current bulk-add candidate pool: whatever's already filtered/listed
   * in the middle panel, narrowed to the chosen difficulty, non-passage
   * (never split a passage apart), and not already in the exercise.
   *
   * Deliberately a plain method, not a `computed()`, for the same reason
   * `isAdded()`/`totalPoints()` below are: it reads the plain `@Input()
   * existingItems`, which isn't a signal, so a `computed()` around it would
   * never invalidate when the exercise gains new items — it would only
   * recompute when `filteredItems()`/`bulkDifficulty()` themselves change,
   * silently going stale after every add.
   */
  bulkPool(): QuizItem[] {
    const difficulty = this.bulkDifficulty();
    return this.filteredItems().filter((q) => {
      if (q.passage || this.isAdded(q.id)) return false;
      if (difficulty === 'all') return true;
      // Legacy items predating the difficulty field default to 2/Trung bình, same as everywhere else this field is read.
      return (q.difficulty ?? 2) === difficulty;
    });
  }

  constructor(
    private readonly categoryRepo: CategoryRepository,
    private readonly quizItemRepo: QuizItemRepository,
  ) {
    void this.load();
  }

  private async load(): Promise<void> {
    this.categories.set((await this.categoryRepo.list()).filter((c) => c.status === 'active'));
    this.allItems.set(await this.quizItemRepo.search({ status: 'active' }));
  }

  selectCategory(id: string): void {
    this.selectedCategoryId.set(id);
    this.selectedItem.set(undefined);
    this.bulkMessage.set('');
  }

  selectItem(item: QuizItem): void {
    if (this.dailyMode) return; // no individual-item selection in daily mode — see class doc comment
    this.selectedItem.set(item);
    this.draftSeconds.set('');
    this.draftPoints.set('');
  }

  clearSelection(): void {
    this.selectedItem.set(undefined);
    this.bulkMessage.set('');
  }

  setBulkDifficulty(value: string): void {
    this.bulkDifficulty.set(value === 'all' ? 'all' : coerceDifficulty(value));
  }

  isAdded(quizItemId: string): boolean {
    return this.existingItems.some((i) => i.kind === 'fixed' && i.quizItemId === quizItemId);
  }

  typeLabel(type: QuizItemType): string {
    return TYPE_LABELS[type] ?? type;
  }

  readonly difficultyLabel = difficultyLabel;

  isCorrectChoice(item: QuizItem, choiceId: string): boolean {
    return item.answerRule.kind === 'choice' && item.answerRule.correctChoiceIds.includes(choiceId);
  }

  quizItemLabel(quizItemId: string): string {
    const item = this.allItems().find((q) => q.id === quizItemId);
    if (!item) return quizItemId;
    return item.passage ? `📖 ${item.passage.title} — Câu ${item.passage.order}/${item.passage.total}: ${item.prompt}` : item.prompt;
  }

  categoryNameFor(quizItemId: string): string {
    const item = this.allItems().find((q) => q.id === quizItemId);
    if (!item) return '—';
    return this.categories().find((c) => c.id === item.categoryId)?.name ?? '—';
  }

  randomGroupCategoryLabel(config: RandomGroupConfig): string {
    if (config.categoryIds.length === 0) return 'Tất cả danh mục';
    return config.categoryIds.map((id) => this.categories().find((c) => c.id === id)?.name ?? '—').join(', ');
  }

  randomGroupDifficultyLabel(config: RandomGroupConfig): string {
    return config.difficultyMin === config.difficultyMax
      ? difficultyLabel(config.difficultyMin)
      : `${difficultyLabel(config.difficultyMin)}–${difficultyLabel(config.difficultyMax)}`;
  }

  /**
   * The points this exercise item is actually worth: for a fixed item, its
   * own override if set else the bank item's default. For a random group,
   * only knowable in advance when every item it draws gets the same
   * `pointsOverride` — otherwise each drawn item keeps its own varying
   * default, so there's nothing meaningful to sum here ahead of time.
   */
  effectivePoints(item: ExerciseItem): number {
    if (item.kind === 'fixed') {
      if (item.points !== undefined) return item.points;
      return this.allItems().find((q) => q.id === item.quizItemId)?.points ?? 0;
    }
    return item.randomGroup.pointsOverride !== undefined ? item.randomGroup.pointsOverride * item.randomGroup.count : 0;
  }

  effectiveSeconds(item: ExerciseItem): number | undefined {
    return item.kind === 'fixed' ? item.timeLimitSeconds : item.randomGroup.timeLimitSeconds;
  }

  totalPoints(): number {
    return this.existingItems.reduce((sum, i) => sum + this.effectivePoints(i), 0);
  }

  /** Sum of every item's own explicit per-question time — items left at "không giới hạn riêng" contribute nothing here (see the label next to this total). */
  totalSeconds(): number {
    return this.existingItems.reduce((sum, i) => sum + (this.effectiveSeconds(i) ?? 0), 0);
  }

  formatSeconds(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m} phút` : `${m} phút ${s}s`;
  }

  confirmAdd(): void {
    const item = this.selectedItem();
    if (!item || this.isAdded(item.id)) return;
    const timeLimitSeconds = this.draftSeconds().trim() ? Math.max(1, Math.round(Number(this.draftSeconds()))) : undefined;
    const points = this.draftPoints().trim() ? Math.max(0, Math.round(Number(this.draftPoints()))) : undefined;
    this.picked.emit({ quizItemId: item.id, timeLimitSeconds, points });
    this.draftSeconds.set('');
    this.draftPoints.set('');
  }

  /** Draws `bulkCount` distinct, not-already-added items at random from `bulkPool()` and emits them all in one `pickedMany`. */
  confirmBulkAdd(): void {
    const pool = this.bulkPool();
    if (pool.length === 0) {
      this.bulkMessage.set('Không có câu hỏi nào phù hợp với độ khó đã chọn còn có thể thêm.');
      return;
    }
    const requested = Math.max(1, Math.round(Number(this.bulkCount()) || 1));
    // Fisher-Yates over a copy — this is a one-time, non-reproducible editorial
    // draw at build time (unlike a random *group*, which reseeds per attempt),
    // so a plain unseeded shuffle is fine here.
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const chosen = shuffled.slice(0, requested);

    const timeLimitSeconds = this.bulkSeconds().trim() ? Math.max(1, Math.round(Number(this.bulkSeconds()))) : undefined;
    const points = this.bulkPoints().trim() ? Math.max(0, Math.round(Number(this.bulkPoints()))) : undefined;
    this.pickedMany.emit(chosen.map((q) => ({ quizItemId: q.id, timeLimitSeconds, points })));

    this.bulkMessage.set(
      chosen.length < requested
        ? `Chỉ thêm được ${chosen.length}/${requested} câu — không còn đủ câu hỏi phù hợp.`
        : `Đã thêm ${chosen.length} câu hỏi ngẫu nhiên.`,
    );
  }

  /**
   * `dailyMode` only: adds a random "slot" — no concrete quiz is chosen now.
   * Scoped to the exercise's own grade/subject (same as everything else in
   * this browser) plus the currently-selected category and difficulty; the
   * actual questions are drawn fresh, and never duplicated within the same
   * attempt, by `AttemptResolverService` every time the exercise starts.
   */
  confirmAddRandomGroup(): void {
    const count = Math.max(1, Math.round(Number(this.bulkCount()) || 1));
    const timeLimitSeconds = this.bulkSeconds().trim() ? Math.max(1, Math.round(Number(this.bulkSeconds()))) : undefined;
    const pointsOverride = this.bulkPoints().trim() ? Math.max(0, Math.round(Number(this.bulkPoints()))) : undefined;
    const categoryIds = this.selectedCategoryId() === 'all' ? [] : [this.selectedCategoryId()];
    const difficulty = this.bulkDifficulty();
    // "All" spans the full named range rather than any one level; RandomGroupConfig
    // has no separate "any difficulty" marker, so 1–5 already means exactly that.
    const difficultyMin = difficulty === 'all' ? 1 : difficulty;
    const difficultyMax = difficulty === 'all' ? 5 : difficulty;

    const config: RandomGroupConfig = {
      count,
      subject: this.exerciseSubject === 'mixed' ? undefined : this.exerciseSubject,
      grade: this.grade,
      categoryIds,
      tags: [],
      difficultyMin,
      difficultyMax,
      allowedTypes: [],
      avoidRecentUse: false,
      preferWeakAreas: false,
      mode: 'balanced',
      timeLimitSeconds,
      pointsOverride,
    };
    this.addedRandomGroup.emit(config);
    this.bulkMessage.set(`Đã thêm mục ngẫu nhiên: ${count} câu, độ khó ${this.bulkDifficultyLabel()}.`);
  }

  bulkDifficultyLabel(): string {
    return this.bulkDifficultyOptions.find((o) => o.value === this.bulkDifficulty())?.label ?? '';
  }
}
