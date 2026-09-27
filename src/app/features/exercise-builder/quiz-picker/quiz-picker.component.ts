import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { Category, Exercise, ExerciseItem, QuestionTimingMode, QuizDifficulty, QuizItem, QuizItemType, RandomGroupConfig, Subject } from '../../../shared/models/domain.model';
import { DIFFICULTY_LEVELS, coerceDifficulty, difficultyLabel } from '../../../shared/difficulty';
import { IconComponent } from '../../../shared/icon/icon.component';
import { QuizImageComponent } from '../../../shared/quiz-image/quiz-image.component';
import { QUESTION_TYPE_GROUPS, QuestionTypeGroupKey, allowedTypesLabel, typesForGroups } from '../../../shared/question-type-groups';

/** One row of the picker's question list: a standalone question, or a whole passage with its sub-questions. */
type PickerListEntry =
  | { kind: 'item'; key: string; item: QuizItem }
  | { kind: 'passage'; key: string; title: string; first: QuizItem; items: QuizItem[] };

/** A random add (bulk or daily slot) needs more than 4 matching questions, so the draw has some real variety. */
export const MIN_RANDOM_MATCHES = 5;

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
 *
 * Both random adds also filter by question type (Trắc nghiệm / Đúng/Sai /
 * Nhập đáp án, multi-select — see shared/question-type-groups.ts) and are
 * only allowed when more than 4 bank questions match the chosen category +
 * types + difficulty. The category tree only lists categories that have at
 * least one question for this exercise's grade/subject and chosen types.
 *
 * A passage (one text + several questions) is listed as a single row; its
 * detail shows the text and every sub-question, and adding it adds them all
 * (the builder's addFixedItem pulls in every sibling in passage order).
 *
 * Outside `dailyMode` the parent can also add *every* question of the chosen
 * category at once (amended 2026-09-26), narrowed by the same type /
 * difficulty / search filters; passages are added whole, in passage order.
 */
@Component({
  selector: 'app-quiz-picker',
  standalone: true,
  imports: [FormsModule, IconComponent, QuizImageComponent],
  templateUrl: './quiz-picker.component.html',
  styleUrl: './quiz-picker.component.scss',
})
export class QuizPickerComponent {
  @Input({ required: true }) existingItems: ExerciseItem[] = [];
  @Input() questionTimingMode: QuestionTimingMode = 'none';
  /** The exercise's default seconds per question ('uniform' mode, and fallback in 'custom'); only for display/placeholders here. */
  @Input() defaultQuestionSeconds?: number;
  /** The exercise's default points per question when an item has no override; only for display/placeholders here. */
  @Input() defaultQuestionPoints?: number;
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

  /**
   * Phone layout shows one of the three columns at a time: the question tree,
   * the selected entry's detail, or the list of added questions. Choosing an
   * entry opens its detail; adding moves on to the added list, which offers
   * "Thêm câu hỏi" (back to the tree) and "Hoàn tất". On a wide screen all
   * three columns are always visible and this only tracks the last step.
   */
  readonly mobileStep = signal<'tree' | 'detail' | 'added'>('tree');
  /** Categories opened in the tree to show their questions (all of them open while searching). */
  readonly expandedCategories = signal<ReadonlySet<string>>(new Set());

  /** Tree leaves per category: the questions (search applied) with each passage collapsed into one entry. */
  readonly entriesByCategory = computed(() => {
    const search = this.searchText().trim().toLowerCase();
    const byCategory = new Map<string, PickerListEntry[]>();
    const seenPassages = new Set<string>();
    for (const q of this.typedItems()) {
      if (search && !q.prompt.toLowerCase().includes(search) && !q.passage?.title.toLowerCase().includes(search)) continue;
      const list = byCategory.get(q.categoryId) ?? [];
      if (!q.passage) {
        list.push({ kind: 'item', key: q.id, item: q });
      } else if (!seenPassages.has(q.passage.passageId)) {
        seenPassages.add(q.passage.passageId);
        const items = this.passageSiblings(q);
        list.push({ kind: 'passage', key: q.passage.passageId, title: q.passage.title, first: items[0] ?? q, items });
      }
      byCategory.set(q.categoryId, list);
    }
    return byCategory;
  });

  isExpanded(categoryId: string): boolean {
    return !!this.searchText().trim() || this.expandedCategories().has(categoryId);
  }

  toggleExpanded(categoryId: string): void {
    this.expandedCategories.update((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  goTo(step: 'tree' | 'detail' | 'added'): void {
    this.mobileStep.set(step);
  }

  /** The middle list: standalone questions as-is, each passage collapsed into one entry (at its first matching sub-question's position). */
  readonly listEntries = computed<PickerListEntry[]>(() => {
    const entries: PickerListEntry[] = [];
    const seen = new Set<string>();
    for (const q of this.filteredItems()) {
      if (!q.passage) {
        entries.push({ kind: 'item', key: q.id, item: q });
        continue;
      }
      if (seen.has(q.passage.passageId)) continue;
      seen.add(q.passage.passageId);
      const items = this.passageSiblings(q);
      entries.push({ kind: 'passage', key: q.passage.passageId, title: q.passage.title, first: items[0] ?? q, items });
    }
    return entries;
  });

  /** The selected passage's sub-questions in order (empty for a standalone question). */
  readonly selectedPassageItems = computed(() => {
    const item = this.selectedItem();
    return item?.passage ? this.passageSiblings(item) : [];
  });
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

  readonly typeGroups = QUESTION_TYPE_GROUPS;
  /** Question-type groups to include (multi-select); all of them by default. */
  readonly selectedTypeGroups = signal<ReadonlySet<QuestionTypeGroupKey>>(new Set(QUESTION_TYPE_GROUPS.map((g) => g.key)));
  readonly selectedTypes = computed(() => typesForGroups(this.selectedTypeGroups()));

  /** allItems narrowed to this exercise's grade AND subject ('mixed' keeps both subjects) — every other view (tree counts, list, "all" count) is built from this. */
  private readonly scopedItems = computed(() =>
    this.allItems().filter((q) => q.grade === this.grade && (this.exerciseSubject === 'mixed' || q.subject === this.exerciseSubject)),
  );

  /** scopedItems narrowed to the chosen question types — what the tree counts and the list show. */
  private readonly typedItems = computed(() => {
    const types = this.selectedTypes();
    return this.scopedItems().filter((q) => types.includes(q.type));
  });

  readonly tree = computed<SubjectGroup[]>(() => {
    const counts = new Map<string, number>();
    for (const q of this.typedItems()) counts.set(q.categoryId, (counts.get(q.categoryId) ?? 0) + 1);

    const wantMath = this.exerciseSubject === 'mixed' || this.exerciseSubject === 'math';
    const wantLanguage = this.exerciseSubject === 'mixed' || this.exerciseSubject === 'language';
    const groups: SubjectGroup[] = [];
    if (wantMath) groups.push({ subject: 'math', label: SUBJECT_LABELS.math, categories: [] });
    if (wantLanguage) groups.push({ subject: 'language', label: SUBJECT_LABELS.language, categories: [] });

    for (const category of this.categories()) {
      const count = counts.get(category.id) ?? 0;
      // A category with nothing for this exercise's grade/subject/types is only noise here (e.g. a grade-1 category in a grade-5 exercise).
      if (count === 0) continue;
      const node: CategoryNode = { category, count };
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
    return this.typedItems().filter((q) => {
      if (categoryId !== 'all' && q.categoryId !== categoryId) return false;
      if (search && !q.prompt.toLowerCase().includes(search)) return false;
      return true;
    });
  });

  readonly allCount = computed(() => this.typedItems().length);

  /**
   * Every bank question a random add for the current category + question
   * types + difficulty could draw from (non-passage, ignoring the search box
   * and what's already added) — the count checked against MIN_RANDOM_MATCHES.
   */
  readonly randomMatchCount = computed(() => {
    const categoryId = this.selectedCategoryId();
    const difficulty = this.bulkDifficulty();
    return this.typedItems().filter(
      (q) =>
        !q.passage &&
        (categoryId === 'all' || q.categoryId === categoryId) &&
        (difficulty === 'all' || (q.difficulty ?? 2) === difficulty),
    ).length;
  });

  readonly hasEnoughRandomMatches = computed(() => this.randomMatchCount() >= MIN_RANDOM_MATCHES);

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

  /**
   * Everything "Thêm tất cả" would add: the chosen category's listed questions
   * (types, search) at the chosen difficulty, with each passage expanded to
   * all its sub-questions in order, minus what the exercise already has.
   * Empty while "Tất cả câu hỏi" is selected — this adds one category.
   * A plain method for the same reason as `bulkPool()`.
   */
  addAllPool(): QuizItem[] {
    if (this.selectedCategoryId() === 'all') return [];
    const difficulty = this.bulkDifficulty();
    const result: QuizItem[] = [];
    const seenPassages = new Set<string>();
    for (const q of this.filteredItems()) {
      if (difficulty !== 'all' && (q.difficulty ?? 2) !== difficulty) continue;
      if (!q.passage) {
        result.push(q);
        continue;
      }
      if (seenPassages.has(q.passage.passageId)) continue;
      seenPassages.add(q.passage.passageId);
      result.push(
        ...this.allItems()
          .filter((s) => s.passage?.passageId === q.passage!.passageId)
          .sort((a, b) => (a.passage?.order ?? 0) - (b.passage?.order ?? 0)),
      );
    }
    return result.filter((q) => !this.isAdded(q.id));
  }

  /** Adds every question of the chosen category (see `addAllPool()`), with the form's time/points override, in one `pickedMany`. */
  confirmAddAll(): void {
    const pool = this.addAllPool();
    if (pool.length === 0) return;
    const timeLimitSeconds = this.bulkSeconds().trim() ? Math.max(1, Math.round(Number(this.bulkSeconds()))) : undefined;
    const points = this.bulkPoints().trim() ? Math.max(0, Math.round(Number(this.bulkPoints()))) : undefined;
    this.pickedMany.emit(pool.map((q) => ({ quizItemId: q.id, timeLimitSeconds, points })));
    this.bulkMessage.set(`Đã thêm tất cả ${pool.length} câu hỏi của danh mục.`);
    this.mobileStep.set('added');
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
    if (id !== 'all' && !this.expandedCategories().has(id)) this.toggleExpanded(id);
    this.mobileStep.set('detail');
  }

  selectItem(item: QuizItem): void {
    if (this.dailyMode) return; // no individual-item selection in daily mode — see class doc comment
    this.selectedCategoryId.set(item.categoryId);
    this.selectedItem.set(item);
    this.draftSeconds.set('');
    this.draftPoints.set('');
    this.mobileStep.set('detail');
  }

  clearSelection(): void {
    this.selectedItem.set(undefined);
    this.bulkMessage.set('');
  }

  isTypeGroupSelected(key: QuestionTypeGroupKey): boolean {
    return this.selectedTypeGroups().has(key);
  }

  toggleTypeGroup(key: QuestionTypeGroupKey): void {
    this.selectedTypeGroups.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    this.bulkMessage.set('');
    const selected = this.selectedCategoryId();
    if (selected !== 'all' && !this.tree().some((g) => g.categories.some((n) => n.category.id === selected))) {
      this.selectCategory('all'); // the chosen category has no questions of the remaining types
    }
    const item = this.selectedItem();
    if (item && !this.selectedTypes().includes(item.type)) this.selectedItem.set(undefined);
  }

  setBulkDifficulty(value: string): void {
    this.bulkDifficulty.set(value === 'all' ? 'all' : coerceDifficulty(value));
  }

  /** Every active sub-question of `item`'s passage, in passage order. */
  passageSiblings(item: QuizItem): QuizItem[] {
    const passageId = item.passage?.passageId;
    if (!passageId) return [item];
    return this.allItems()
      .filter((q) => q.passage?.passageId === passageId)
      .sort((a, b) => (a.passage?.order ?? 0) - (b.passage?.order ?? 0));
  }

  /** A passage counts as added only once all of its sub-questions are in the exercise. */
  isEntryAdded(entry: PickerListEntry): boolean {
    return entry.kind === 'item' ? this.isAdded(entry.item.id) : entry.items.every((q) => this.isAdded(q.id));
  }

  isSelectionAdded(): boolean {
    const item = this.selectedItem();
    if (!item) return false;
    return item.passage ? this.selectedPassageItems().every((q) => this.isAdded(q.id)) : this.isAdded(item.id);
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

  readonly allowedTypesLabel = allowedTypesLabel;

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
  /** Points this entry is worth in the exercise: its own override, else the exercise default, else the question's own. */
  effectivePoints(item: ExerciseItem): number {
    if (item.kind === 'fixed') {
      if (item.points !== undefined) return item.points;
      if (this.defaultQuestionPoints !== undefined) return this.defaultQuestionPoints;
      return this.allItems().find((q) => q.id === item.quizItemId)?.points ?? 0;
    }
    const perQuestion = item.randomGroup.pointsOverride ?? this.defaultQuestionPoints;
    return perQuestion !== undefined ? perQuestion * item.randomGroup.count : 0;
  }

  /** Per-question cap as the resolver will apply it (see QuestionTimingMode). */
  effectiveSeconds(item: ExerciseItem): number | undefined {
    const own = item.kind === 'fixed' ? item.timeLimitSeconds : item.randomGroup.timeLimitSeconds;
    if (this.questionTimingMode === 'uniform') return this.defaultQuestionSeconds;
    if (this.questionTimingMode === 'custom') return own ?? this.defaultQuestionSeconds;
    return undefined;
  }

  /** Placeholder for the per-question points field: what is used when it is left blank. */
  pointsPlaceholder(questionPoints: number): string {
    return `để trống = ${this.defaultQuestionPoints ?? questionPoints} điểm (mặc định)`;
  }

  /** Placeholder for the per-question seconds field ('custom' mode only). */
  secondsPlaceholder(): string {
    return this.defaultQuestionSeconds ? `để trống = ${this.defaultQuestionSeconds} giây (mặc định)` : 'để trống = không giới hạn riêng';
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
    const selected = this.selectedItem();
    if (!selected || this.isSelectionAdded()) return;
    // For a passage, the first not-yet-added sub-question is emitted; the builder adds every sibling with it.
    const item = selected.passage ? (this.selectedPassageItems().find((q) => !this.isAdded(q.id)) ?? selected) : selected;
    const timeLimitSeconds = this.draftSeconds().trim() ? Math.max(1, Math.round(Number(this.draftSeconds()))) : undefined;
    const points = this.draftPoints().trim() ? Math.max(0, Math.round(Number(this.draftPoints()))) : undefined;
    this.picked.emit({ quizItemId: item.id, timeLimitSeconds, points });
    this.draftSeconds.set('');
    this.draftPoints.set('');
    this.mobileStep.set('added');
  }

  /** Draws `bulkCount` distinct, not-already-added items at random from `bulkPool()` and emits them all in one `pickedMany`. */
  confirmBulkAdd(): void {
    if (!this.hasEnoughRandomMatches()) return;
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
    this.mobileStep.set('added');
  }

  /**
   * `dailyMode` only: adds a random "slot" — no concrete quiz is chosen now.
   * Scoped to the exercise's own grade/subject (same as everything else in
   * this browser) plus the currently-selected category and difficulty; the
   * actual questions are drawn fresh, and never duplicated within the same
   * attempt, by `AttemptResolverService` every time the exercise starts.
   */
  confirmAddRandomGroup(): void {
    if (!this.hasEnoughRandomMatches()) return;
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
      allowedTypes: this.selectedTypes(),
      avoidRecentUse: false,
      preferWeakAreas: false,
      mode: 'balanced',
      timeLimitSeconds,
      pointsOverride,
    };
    this.addedRandomGroup.emit(config);
    this.bulkMessage.set(
      `Đã thêm mục ngẫu nhiên: ${count} câu, ${allowedTypesLabel(config.allowedTypes).toLowerCase()}, độ khó ${this.bulkDifficultyLabel()}.`,
    );
    this.mobileStep.set('added');
  }

  bulkDifficultyLabel(): string {
    return this.bulkDifficultyOptions.find((o) => o.value === this.bulkDifficulty())?.label ?? '';
  }
}
