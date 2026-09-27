import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { RandomGroupCheckService } from '../services/random-group-check.service';
import { Category, Exercise, ExerciseItem, QuizItem, RandomGroupConfig } from '../../../shared/models/domain.model';
import { difficultyLabel } from '../../../shared/difficulty';
import { QuizPickerComponent } from '../quiz-picker/quiz-picker.component';
import { allowedTypesLabel } from '../../../shared/question-type-groups';

/**
 * Exercise Builder (FR-031, FR-032, FR-035, FR-037): title/subject/grade/
 * time-limit/passing-threshold/toggles, fixed items and random groups,
 * reorderable via move-up/move-down controls. Fixed items are added through
 * the full-screen QuizPickerComponent (category tree + detail + per-item
 * time/points overrides) rather than a flat dropdown.
 *
 * A daily exercise (`isDaily`, FR-091, added 2026-09-18) may only ever
 * contain `randomGroup` items — the picker runs in `dailyMode`, which
 * disables individual-item selection and turns its "add" action into
 * `onAddedRandomGroup()` instead of `onQuizPicked()`/`onQuizPickedMany()`.
 * Toggling `isDaily` on strips any existing fixed items immediately, and
 * `save()` refuses outright if any slipped through regardless.
 */
@Component({
  selector: 'app-exercise-builder',
  standalone: true,
  imports: [FormsModule, QuizPickerComponent],
  templateUrl: './exercise-builder.component.html',
  styleUrl: './exercise-builder.component.scss',
})
export class ExerciseBuilderComponent implements OnInit {
  readonly title = signal('');
  readonly subject = signal<Exercise['subject']>('math');
  readonly grade = signal(1);
  readonly timeLimitMinutes = signal(10);
  readonly passingPercent = signal(70);
  readonly orderMode = signal<Exercise['orderMode']>('fixed');
  readonly replayAllowed = signal(true);
  readonly correctionReviewEnabled = signal(true);
  readonly repeatSameQuestions = signal(false);
  /** 3-10, or 'unlimited'. */
  readonly lives = signal<Exercise['lives']>(5);
  /** 1-3 lifetime attempts, or 'unlimited'. */
  readonly repeatLimit = signal<Exercise['repeatLimit']>(1);
  readonly questionTimingMode = signal<Exercise['questionTimingMode']>('none');
  /** Text inputs (blank = not set): seconds per question for 'uniform' / fallback in 'custom', and points per question. */
  readonly defaultQuestionSeconds = signal('');
  readonly defaultQuestionPoints = signal('');
  readonly isDaily = signal(false);
  readonly items = signal<ExerciseItem[]>([]);
  readonly bankItems = signal<QuizItem[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly warnings = signal<string[]>([]);
  readonly showPicker = signal(false);
  private editingId?: string;

  constructor(
    private readonly exercises: ExerciseRepository,
    private readonly quizItems: QuizItemRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly randomGroupCheck: RandomGroupCheckService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.bankItems.set(await this.quizItems.search({ status: 'active' }));
    this.categories.set(await this.categoryRepo.list());

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    const existing = await this.exercises.getById(id);
    if (!existing) return;
    this.editingId = existing.id;
    this.title.set(existing.title);
    this.subject.set(existing.subject);
    this.grade.set(existing.grade);
    this.timeLimitMinutes.set(existing.timeLimitMinutes);
    this.passingPercent.set(existing.passingPercent);
    this.orderMode.set(existing.orderMode);
    this.replayAllowed.set(existing.replayAllowed);
    this.correctionReviewEnabled.set(existing.correctionReviewEnabled);
    this.repeatSameQuestions.set(existing.repeatSameQuestions);
    this.lives.set(existing.lives ?? 5);
    this.repeatLimit.set(existing.repeatLimit ?? 1);
    this.questionTimingMode.set(existing.questionTimingMode ?? 'none');
    this.defaultQuestionSeconds.set(existing.defaultQuestionSeconds ? String(existing.defaultQuestionSeconds) : '');
    this.defaultQuestionPoints.set(existing.defaultQuestionPoints !== undefined ? String(existing.defaultQuestionPoints) : '');
    this.isDaily.set(existing.isDaily ?? false);
    this.items.set(existing.items);
  }

  /** Turning daily mode on strips any fixed items immediately — a daily exercise may only ever contain random-group "slots" (FR-091). */
  setDaily(value: boolean): void {
    this.isDaily.set(value);
    if (value) this.items.update((current) => current.filter((i) => i.kind !== 'fixed'));
  }

  /** Returns the quiz item ids actually newly added (a passage add returns every sibling; an already-added id contributes none) — callers apply per-item overrides to every returned id, never just the one clicked. */
  addFixedItem(quizItemId: string): string[] {
    if (!quizItemId) return [];
    const chosen = this.bankItems().find((q) => q.id === quizItemId);
    const alreadyAdded = new Set(
      this.items()
        .filter((i): i is Extract<ExerciseItem, { kind: 'fixed' }> => i.kind === 'fixed')
        .map((i) => i.quizItemId),
    );

    // A passage's sub-questions must always travel together (never leave a
    // child with a question but no passage text to read it against), so
    // adding any one of them pulls in every sibling, in passage order.
    const idsToAdd = chosen?.passage
      ? this.bankItems()
          .filter((q) => q.passage?.passageId === chosen.passage!.passageId)
          .sort((a, b) => (a.passage?.order ?? 0) - (b.passage?.order ?? 0))
          .map((q) => q.id)
      : [quizItemId];

    const newlyAdded = idsToAdd.filter((id) => !alreadyAdded.has(id));

    this.items.update((current) => {
      const additions = newlyAdded.map((id, offset) => ({
        id: crypto.randomUUID(),
        position: current.length + offset,
        kind: 'fixed' as const,
        quizItemId: id,
      }));
      return [...current, ...additions];
    });

    return newlyAdded;
  }

  addRandomGroup(): void {
    const group: RandomGroupConfig = {
      count: 5,
      categoryIds: [],
      tags: [],
      difficultyMin: 1,
      difficultyMax: 5,
      allowedTypes: [],
      avoidRecentUse: false,
      preferWeakAreas: false,
      mode: 'balanced',
    };
    this.items.update((current) => [
      ...current,
      { id: crypto.randomUUID(), position: current.length, kind: 'randomGroup', randomGroup: group },
    ]);
  }

  removeItem(itemId: string): void {
    const target = this.items().find((i) => i.id === itemId);
    const targetQuizItem =
      target?.kind === 'fixed' ? this.bankItems().find((q) => q.id === target.quizItemId) : undefined;
    const passageId = targetQuizItem?.passage?.passageId;

    this.items.update((current) =>
      current
        .filter((i) => {
          if (i.id === itemId) return false;
          if (!passageId || i.kind !== 'fixed') return true;
          // Removing one passage sub-question removes the whole group — a
          // partial passage left in the exercise would show a child some of
          // its questions with no way to see the rest.
          return this.bankItems().find((q) => q.id === i.quizItemId)?.passage?.passageId !== passageId;
        })
        .map((i, idx) => ({ ...i, position: idx })),
    );
  }

  moveItem(index: number, direction: -1 | 1): void {
    this.items.update((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((i, idx) => ({ ...i, position: idx }));
    });
  }

  /** Rough count of resolved questions, for the "distribute" mode's live preview (random groups count as their configured draw size). */
  /** Positive whole seconds, or undefined when blank/invalid. */
  parsedDefaultSeconds(): number | undefined {
    const n = Math.round(Number(this.defaultQuestionSeconds().trim()));
    return this.defaultQuestionSeconds().trim() && n > 0 ? n : undefined;
  }

  /** Whole points ≥ 0, or undefined when blank/invalid. */
  parsedDefaultPoints(): number | undefined {
    const n = Math.round(Number(this.defaultQuestionPoints().trim()));
    return this.defaultQuestionPoints().trim() && n >= 0 && Number.isFinite(n) ? n : undefined;
  }

  distributedSecondsPreview(): number {
    const totalCount = this.items().reduce((sum, i) => sum + (i.kind === 'fixed' ? 1 : i.randomGroup.count), 0);
    if (totalCount === 0) return 0;
    return Math.max(1, Math.round((this.timeLimitMinutes() * 60) / totalCount));
  }

  setFixedItemSeconds(itemId: string, value: string): void {
    const seconds = value.trim() ? Math.max(1, Math.round(Number(value))) : undefined;
    this.items.update((current) =>
      current.map((i) => (i.id === itemId && i.kind === 'fixed' ? { ...i, timeLimitSeconds: seconds } : i)),
    );
  }

  setRandomGroupSeconds(itemId: string, value: string): void {
    const seconds = value.trim() ? Math.max(1, Math.round(Number(value))) : undefined;
    this.items.update((current) =>
      current.map((i) =>
        i.id === itemId && i.kind === 'randomGroup' ? { ...i, randomGroup: { ...i.randomGroup, timeLimitSeconds: seconds } } : i,
      ),
    );
  }

  setLives(value: string): void {
    this.lives.set(value === 'unlimited' ? 'unlimited' : Math.min(10, Math.max(3, Math.round(Number(value)))));
  }

  setRepeatLimit(value: string): void {
    this.repeatLimit.set(
      value === 'unlimited' ? 'unlimited' : (Math.min(3, Math.max(1, Math.round(Number(value)))) as 1 | 2 | 3),
    );
  }

  setFixedItemPoints(itemId: string, value: string): void {
    const points = value.trim() ? Math.max(0, Math.round(Number(value))) : undefined;
    this.items.update((current) => current.map((i) => (i.id === itemId && i.kind === 'fixed' ? { ...i, points } : i)));
  }

  openPicker(): void {
    this.showPicker.set(true);
  }

  closePicker(): void {
    this.showPicker.set(false);
  }

  /** Adds the picked quiz item (reusing the existing passage-group-aware add logic), then applies whatever per-item overrides were set in the picker's detail form to that exact item. */
  onQuizPicked(payload: { quizItemId: string; timeLimitSeconds?: number; points?: number }): void {
    // A passage add pulls in every sibling sub-question alongside the one
    // clicked — the configured time/points override applies per QUESTION,
    // to every one of them, not only to the specific quiz that was clicked
    // (was previously applied to just that one, silently leaving its
    // siblings with no override at all).
    const newlyAddedIds = this.addFixedItem(payload.quizItemId);
    for (const quizItemId of newlyAddedIds) {
      const added = this.items().find((i) => i.kind === 'fixed' && i.quizItemId === quizItemId);
      if (!added) continue;
      if (payload.timeLimitSeconds !== undefined) this.setFixedItemSeconds(added.id, String(payload.timeLimitSeconds));
      if (payload.points !== undefined) this.setFixedItemPoints(added.id, String(payload.points));
    }
  }

  /** Adds every item from the picker's bulk random-add draw in one update — each is already guaranteed distinct and not already in the exercise by the picker itself, re-checked here as a second guard against duplicates. */
  onQuizPickedMany(payloads: Array<{ quizItemId: string; timeLimitSeconds?: number; points?: number }>): void {
    this.items.update((current) => {
      const alreadyAdded = new Set(
        current.filter((i): i is Extract<ExerciseItem, { kind: 'fixed' }> => i.kind === 'fixed').map((i) => i.quizItemId),
      );
      let position = current.length;
      const additions: ExerciseItem[] = [];
      for (const payload of payloads) {
        if (alreadyAdded.has(payload.quizItemId)) continue;
        alreadyAdded.add(payload.quizItemId);
        additions.push({
          id: crypto.randomUUID(),
          position: position++,
          kind: 'fixed',
          quizItemId: payload.quizItemId,
          timeLimitSeconds: payload.timeLimitSeconds,
          points: payload.points,
        });
      }
      return [...current, ...additions];
    });
  }

  /** Daily mode only: appends the picker's emitted `RandomGroupConfig` as a new random-group item — no concrete quiz ids, per FR-091. */
  onAddedRandomGroup(config: RandomGroupConfig): void {
    this.items.update((current) => [
      ...current,
      { id: crypto.randomUUID(), position: current.length, kind: 'randomGroup', randomGroup: config },
    ]);
  }

  quizItemLabel(quizItemId: string): string {
    const item = this.bankItems().find((q) => q.id === quizItemId);
    if (!item) return quizItemId;
    return item.passage ? `📖 ${item.passage.title} — Câu ${item.passage.order}/${item.passage.total}: ${item.prompt}` : item.prompt;
  }

  bankItemLabel(item: QuizItem): string {
    return item.passage ? `📖 ${item.passage.title} — Câu ${item.passage.order}/${item.passage.total}: ${item.prompt}` : item.prompt;
  }

  /** Human-readable summary of a random group's config for the main item-list row, e.g. "Số học · Khó · 3 điểm/câu · 30s". */
  randomGroupSummaryLabel(config: RandomGroupConfig): string {
    const categoryPart =
      config.categoryIds.length === 0
        ? 'Tất cả danh mục'
        : config.categoryIds.map((id) => this.categories().find((c) => c.id === id)?.name ?? '—').join(', ');
    const difficultyPart =
      config.difficultyMin === config.difficultyMax
        ? difficultyLabel(config.difficultyMin)
        : `${difficultyLabel(config.difficultyMin)}–${difficultyLabel(config.difficultyMax)}`;
    const pointsPart = config.pointsOverride !== undefined ? `${config.pointsOverride} điểm/câu` : 'điểm mặc định';
    const timePart = config.timeLimitSeconds ? `${config.timeLimitSeconds}s/câu` : 'không giới hạn riêng';
    return `${categoryPart} · ${allowedTypesLabel(config.allowedTypes)} · ${difficultyPart} · ${pointsPart} · ${timePart}`;
  }

  async save(): Promise<void> {
    const itemSubjects = this.items()
      .filter((i): i is Extract<ExerciseItem, { kind: 'fixed' }> => i.kind === 'fixed')
      .map((i) => this.bankItems().find((q) => q.id === i.quizItemId)?.subject)
      .filter((s): s is 'math' | 'language' => !!s);

    const subjectErrors = this.exercises.validateSubject(this.subject(), itemSubjects);

    // A daily exercise draws every question fresh at random, so it must
    // never contain a fixed item — should never happen via the UI (setDaily
    // strips them proactively), but checked again here as a hard backstop.
    const dailyErrors =
      this.isDaily() && this.items().some((i) => i.kind === 'fixed')
        ? ['Bài tập hàng ngày không được chứa câu hỏi cụ thể — chỉ dùng mục ngẫu nhiên theo danh mục.']
        : [];

    const groupWarnings: string[] = [];
    for (const item of this.items()) {
      if (item.kind === 'randomGroup') {
        const check = await this.randomGroupCheck.checkSatisfiable(item.randomGroup);
        if (!check.satisfiable) groupWarnings.push(check.message);
      }
    }

    this.warnings.set([...subjectErrors, ...dailyErrors, ...groupWarnings]);
    if (subjectErrors.length > 0 || dailyErrors.length > 0) return;

    const payload = {
      title: this.title(),
      subject: this.subject(),
      grade: this.grade(),
      items: this.items(),
      timeLimitMinutes: this.timeLimitMinutes(),
      lives: this.lives(),
      repeatLimit: this.repeatLimit(),
      passingPercent: this.passingPercent(),
      orderMode: this.orderMode(),
      replayAllowed: this.replayAllowed(),
      correctionReviewEnabled: this.correctionReviewEnabled(),
      repeatSameQuestions: this.repeatSameQuestions(),
      questionTimingMode: this.questionTimingMode(),
      defaultQuestionSeconds: this.parsedDefaultSeconds(),
      defaultQuestionPoints: this.parsedDefaultPoints(),
      isDaily: this.isDaily(),
      status: 'active' as const,
    };

    if (this.editingId) {
      await this.exercises.update(this.editingId, payload);
    } else {
      await this.exercises.createExercise(payload);
    }
    await this.router.navigateByUrl('/exercise-library');
  }
}
