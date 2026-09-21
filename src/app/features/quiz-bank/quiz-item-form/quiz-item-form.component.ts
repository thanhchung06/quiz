import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { QuizValidationService } from '../services/quiz-validation.service';
import { CategoryPickerComponent } from './category-picker.component';
import { AnswerRule, Choice, QuizDifficulty, QuizItem, QuizItemType, Subject } from '../../../shared/models/domain.model';
import { newSyncEnvelope } from '../../../shared/models/sync.model';
import { currentDeviceId } from '../../../data/repositories/base-repository';
import { coerceDifficulty, DIFFICULTY_LEVELS } from '../../../shared/difficulty';

/**
 * Quiz Item form (FR-017, FR-018): required fields (title/identifier,
 * subject, grade, type, prompt, correct answer) and optional fields
 * (explanation, image, audio, tags, difficulty, points) per data-model.md §3.
 *
 * Works two ways (amended 2026-09-18): as its own routed page
 * (`/quiz-bank/new`, `/quiz-bank/:id/edit`, reading the id from the route —
 * unchanged), or embedded as the Quiz Bank tree's detail/edit panel via
 * `[itemId]`/`[embedded]="true"`, in which case `save()` emits `saved`
 * instead of navigating away, so the host page can refresh its tree in place.
 */
@Component({
  selector: 'app-quiz-item-form',
  standalone: true,
  imports: [FormsModule, CategoryPickerComponent],
  templateUrl: './quiz-item-form.component.html',
  styleUrl: './quiz-item-form.component.scss',
})
export class QuizItemFormComponent implements OnInit, OnChanges {
  @Input() itemId?: string;
  @Input() embedded = false;
  @Output() readonly saved = new EventEmitter<QuizItem>();

  readonly subject = signal<Subject>('math');
  readonly grade = signal(1);
  readonly type = signal<QuizItemType>('single-choice');
  readonly prompt = signal('');
  readonly explanation = signal('');
  readonly tags = signal('');
  readonly difficulty = signal<QuizDifficulty>(2);
  readonly points = signal(10);
  readonly categoryId = signal<string | undefined>(undefined);
  readonly shuffleChoices = signal(true);
  readonly difficultyLevels = DIFFICULTY_LEVELS;

  setDifficulty(value: string): void {
    this.difficulty.set(coerceDifficulty(value));
  }

  readonly choices = signal<Choice[]>([
    { id: crypto.randomUUID(), text: '' },
    { id: crypto.randomUUID(), text: '' },
  ]);
  readonly correctChoiceIds = signal<string[]>([]);
  readonly acceptedAnswer = signal('');
  readonly acceptedValue = signal<number | undefined>(undefined);

  readonly errors = signal<string[]>([]);
  private editingId?: string;

  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly validation: QuizValidationService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.embedded) return; // driven by [itemId] via ngOnChanges instead
    const id = this.route.snapshot.paramMap.get('id');
    await this.loadItem(id ?? undefined);
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!this.embedded || !changes['itemId']) return;
    await this.loadItem(this.itemId);
  }

  private resetToBlank(): void {
    this.editingId = undefined;
    this.subject.set('math');
    this.grade.set(1);
    this.type.set('single-choice');
    this.prompt.set('');
    this.explanation.set('');
    this.tags.set('');
    this.difficulty.set(2);
    this.points.set(10);
    this.categoryId.set(undefined);
    this.shuffleChoices.set(true);
    this.choices.set([
      { id: crypto.randomUUID(), text: '' },
      { id: crypto.randomUUID(), text: '' },
    ]);
    this.correctChoiceIds.set([]);
    this.acceptedAnswer.set('');
    this.acceptedValue.set(undefined);
    this.errors.set([]);
  }

  private async loadItem(id: string | undefined): Promise<void> {
    if (!id) {
      this.resetToBlank();
      return;
    }
    const existing = await this.quizItems.getById(id);
    if (!existing) {
      this.resetToBlank();
      return;
    }
    this.editingId = existing.id;
    this.subject.set(existing.subject);
    this.grade.set(existing.grade);
    this.type.set(existing.type);
    this.prompt.set(existing.prompt);
    this.explanation.set(existing.explanation ?? '');
    this.tags.set(existing.tags.join(', '));
    this.difficulty.set(existing.difficulty ?? 2); // legacy items predating the difficulty field default to Trung bình
    this.points.set(existing.points);
    this.categoryId.set(existing.categoryId);
    this.shuffleChoices.set(existing.shuffleChoices);
    this.choices.set(
      existing.choices ?? [
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
      ],
    );
    this.correctChoiceIds.set(existing.answerRule.kind === 'choice' ? existing.answerRule.correctChoiceIds : []);
    this.acceptedAnswer.set(existing.answerRule.kind === 'text' ? existing.answerRule.acceptedAnswer : '');
    this.acceptedValue.set(existing.answerRule.kind === 'number' ? existing.answerRule.acceptedValue : undefined);
    this.errors.set([]);
  }

  addChoice(): void {
    this.choices.update((c) => [...c, { id: crypto.randomUUID(), text: '' }]);
  }

  toggleCorrect(choiceId: string): void {
    this.correctChoiceIds.update((ids) =>
      this.type() === 'single-choice'
        ? [choiceId]
        : ids.includes(choiceId)
          ? ids.filter((i) => i !== choiceId)
          : [...ids, choiceId],
    );
  }

  private buildAnswerRule(): AnswerRule {
    switch (this.type()) {
      case 'single-choice':
      case 'multiple-choice':
      case 'true-false':
        return { kind: 'choice', correctChoiceIds: this.correctChoiceIds() };
      case 'short-text':
        return { kind: 'text', acceptedAnswer: this.acceptedAnswer(), caseSensitive: false, punctuationSensitive: false };
      case 'number':
        return { kind: 'number', acceptedValue: this.acceptedValue() };
      case 'match-pairs':
        return { kind: 'pairs', pairs: [] };
      default:
        return { kind: 'text', acceptedAnswer: '', caseSensitive: false, punctuationSensitive: false };
    }
  }

  async save(): Promise<void> {
    if (!this.categoryId()) {
      this.errors.set(['Vui lòng chọn danh mục.']);
      return;
    }
    const usesChoices = ['single-choice', 'multiple-choice', 'true-false', 'match-pairs'].includes(this.type());
    const rule = this.buildAnswerRule();
    const result = this.validation.validate(this.type(), usesChoices ? this.choices() : undefined, rule);
    if (!result.valid) {
      this.errors.set(result.errors);
      return;
    }
    this.errors.set([]);

    const tagsArray = this.tags()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    let saved: QuizItem;
    if (this.editingId) {
      await this.quizItems.update(this.editingId, {
        subject: this.subject(),
        grade: this.grade(),
        type: this.type(),
        prompt: this.prompt(),
        explanation: this.explanation() || undefined,
        tags: tagsArray,
        difficulty: this.difficulty(),
        points: this.points(),
        categoryId: this.categoryId(),
        shuffleChoices: this.shuffleChoices(),
        choices: usesChoices ? this.choices() : undefined,
        answerRule: rule,
      });
      saved = (await this.quizItems.getById(this.editingId))!;
    } else {
      const item: QuizItem = {
        ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
        subject: this.subject(),
        grade: this.grade(),
        type: this.type(),
        prompt: this.prompt(),
        explanation: this.explanation() || undefined,
        tags: tagsArray,
        difficulty: this.difficulty(),
        points: this.points(),
        categoryId: this.categoryId()!,
        shuffleChoices: this.shuffleChoices(),
        choices: usesChoices ? this.choices() : undefined,
        answerRule: rule,
        reviewStatus: 'approved',
        status: 'active',
      };
      await this.quizItems.create(item);
      saved = item;
      this.editingId = item.id;
    }

    if (this.embedded) {
      this.saved.emit(saved);
    } else {
      await this.router.navigateByUrl('/quiz-bank');
    }
  }
}
