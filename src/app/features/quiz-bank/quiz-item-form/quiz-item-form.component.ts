import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { QuizValidationService } from '../services/quiz-validation.service';
import { CategoryPickerComponent } from './category-picker.component';
import { ChoiceImageFieldComponent } from './choice-image-field.component';
import { QuizImageComponent, withImageRef } from '../../../shared/quiz-image/quiz-image.component';
import { AnswerRule, Choice, PassageContext, QuizDifficulty, QuizItem, QuizItemType, Subject } from '../../../shared/models/domain.model';
import { newSyncEnvelope } from '../../../shared/models/sync.model';
import { currentDeviceId } from '../../../data/repositories/base-repository';
import { coerceDifficulty, DIFFICULTY_LEVELS } from '../../../shared/difficulty';
import { numberAnswerText, numberRuleFromText, parseNumberAnswer } from '../../child-play/services/answer-evaluator';

/** One question being written in the form; everything not shared by the whole batch. */
export interface QuestionDraft {
  key: string;
  type: QuizItemType;
  prompt: string;
  imageUrl: string;
  explanation: string;
  choices: Choice[];
  correctChoiceIds: string[];
  acceptedAnswer: string;
  /** The number answer as typed: "12", "3,5", "7/2" or "3 1/2". */
  acceptedNumber: string;
}

const CHOICE_TYPES: QuizItemType[] = ['single-choice', 'multiple-choice', 'true-false', 'match-pairs'];

function blankChoices(type: QuizItemType): Choice[] {
  return type === 'true-false'
    ? [
        { id: crypto.randomUUID(), text: 'Đúng' },
        { id: crypto.randomUUID(), text: 'Sai' },
      ]
    : [
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
      ];
}

function blankDraft(type: QuizItemType = 'single-choice'): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    type,
    prompt: '',
    imageUrl: '',
    explanation: '',
    choices: blankChoices(type),
    correctChoiceIds: [],
    acceptedAnswer: '',
    acceptedNumber: '',
  };
}

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
 *
 * When creating (amended 2026-09-26), the form holds several question drafts
 * that share subject, grade, category, tags, difficulty and points, and saves
 * them all in one go; editing an existing item always shows exactly one draft.
 * In "passage" mode the drafts become the sub-questions of one reading text /
 * problem statement (PassageContext, FR-073–075) — the same structure the
 * import file's `passages[]` produces; editing such a group later happens in
 * the passage editor, which the quiz bank opens for passage items.
 */
@Component({
  selector: 'app-quiz-item-form',
  standalone: true,
  imports: [FormsModule, CategoryPickerComponent, QuizImageComponent, ChoiceImageFieldComponent],
  templateUrl: './quiz-item-form.component.html',
  styleUrl: './quiz-item-form.component.scss',
})
export class QuizItemFormComponent implements OnInit, OnChanges {
  @Input() itemId?: string;
  @Input() embedded = false;
  /** Embedded only, with no `itemId`: starts a new question prefilled from this one ("Nhân bản"). */
  @Input() cloneFrom?: QuizItem;
  @Output() readonly saved = new EventEmitter<QuizItem>();

  // Shared by every question in the batch.
  readonly subject = signal<Subject>('math');
  readonly grade = signal(1);
  readonly tags = signal('');
  readonly difficulty = signal<QuizDifficulty>(2);
  readonly points = signal(10);
  readonly categoryId = signal<string | undefined>(undefined);
  readonly shuffleChoices = signal(true);
  readonly difficultyLevels = DIFFICULTY_LEVELS;

  readonly drafts = signal<QuestionDraft[]>([blankDraft()]);
  /** 'single': independent questions; 'passage': sub-questions sharing one text. */
  readonly mode = signal<'single' | 'passage'>('single');
  readonly passageTitle = signal('');
  readonly passageText = signal('');
  readonly passageImageUrl = signal('');
  readonly errors = signal<string[]>([]);
  readonly editingId = signal<string | undefined>(undefined);
  /** The form holds an unsaved copy of another question. */
  readonly cloning = signal(false);

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
    if (!this.embedded || (!changes['itemId'] && !changes['cloneFrom'])) return;
    if (!this.itemId && this.cloneFrom) this.fillFrom(this.cloneFrom, true);
    else await this.loadItem(this.itemId);
  }

  setDifficulty(value: string): void {
    this.difficulty.set(coerceDifficulty(value));
  }

  private resetToBlank(): void {
    this.editingId.set(undefined);
    this.cloning.set(false);
    this.subject.set('math');
    this.grade.set(1);
    this.tags.set('');
    this.difficulty.set(2);
    this.points.set(10);
    this.categoryId.set(undefined);
    this.shuffleChoices.set(true);
    this.drafts.set([blankDraft()]);
    this.mode.set('single');
    this.passageTitle.set('');
    this.passageText.set('');
    this.passageImageUrl.set('');
    this.errors.set([]);
  }

  /** A passage needs at least 2 sub-questions (and no match-pairs, which children can't play yet). */
  setMode(mode: 'single' | 'passage'): void {
    this.mode.set(mode);
    if (mode !== 'passage') return;
    this.drafts.update((list) => {
      const fixed = list.map((d) => (d.type === 'match-pairs' ? { ...d, type: 'single-choice' as QuizItemType } : d));
      return fixed.length >= 2 ? fixed : [...fixed, blankDraft(fixed[fixed.length - 1]?.type)];
    });
  }

  private async loadItem(id: string | undefined): Promise<void> {
    const existing = id ? await this.quizItems.getById(id) : undefined;
    if (!existing) {
      this.resetToBlank();
      return;
    }
    this.fillFrom(existing, false);
  }

  /** Shows `existing` for editing, or (`asCopy`) as a new, unsaved question with the same content. */
  private fillFrom(existing: QuizItem, asCopy: boolean): void {
    this.editingId.set(asCopy ? undefined : existing.id);
    this.cloning.set(asCopy);
    this.mode.set('single');
    this.subject.set(existing.subject);
    this.grade.set(existing.grade);
    this.tags.set(existing.tags.join(', '));
    this.difficulty.set(existing.difficulty ?? 2); // legacy items predating the difficulty field default to Trung bình
    this.points.set(existing.points);
    this.categoryId.set(existing.categoryId);
    this.shuffleChoices.set(existing.shuffleChoices);
    const rule = existing.answerRule;
    this.drafts.set([
      {
        key: asCopy ? crypto.randomUUID() : existing.id,
        type: existing.type,
        prompt: existing.prompt,
        imageUrl: existing.media?.imageRef ?? '',
        explanation: existing.explanation ?? '',
        choices: existing.choices ? existing.choices.map((c) => ({ ...c })) : blankChoices(existing.type),
        correctChoiceIds: rule.kind === 'choice' ? [...rule.correctChoiceIds] : [],
        acceptedAnswer: rule.kind === 'text' ? rule.acceptedAnswer : '',
        acceptedNumber: rule.kind === 'number' ? numberAnswerText(rule) : '',
      },
    ]);
    this.errors.set([]);
  }

  // --- Draft list editing ---------------------------------------------------

  private patch(index: number, change: Partial<QuestionDraft>): void {
    this.drafts.update((list) => list.map((d, i) => (i === index ? { ...d, ...change } : d)));
  }

  setField<K extends 'prompt' | 'imageUrl' | 'explanation' | 'acceptedAnswer' | 'acceptedNumber'>(index: number, field: K, value: string): void {
    this.patch(index, { [field]: value } as Partial<QuestionDraft>);
  }

  setType(index: number, type: QuizItemType): void {
    const draft = this.drafts()[index];
    // True/false gets its two fixed choices; switching away from it (or into
    // single-choice) clears answers that no longer make sense.
    const resetChoices = type === 'true-false' || draft.type === 'true-false';
    this.patch(index, {
      type,
      choices: resetChoices ? blankChoices(type) : draft.choices,
      correctChoiceIds: resetChoices ? [] : type === 'single-choice' ? draft.correctChoiceIds.slice(0, 1) : draft.correctChoiceIds,
    });
  }

  setChoiceText(index: number, choiceId: string, text: string): void {
    const draft = this.drafts()[index];
    this.patch(index, { choices: draft.choices.map((c) => (c.id === choiceId ? { ...c, text } : c)) });
  }

  setChoiceImage(index: number, choiceId: string, imageRef: string): void {
    const draft = this.drafts()[index];
    this.patch(index, {
      choices: draft.choices.map((c) => {
        if (c.id !== choiceId) return c;
        const { imageRef: _old, ...rest } = c;
        return imageRef ? { ...rest, imageRef } : rest;
      }),
    });
  }

  addChoice(index: number): void {
    const draft = this.drafts()[index];
    this.patch(index, { choices: [...draft.choices, { id: crypto.randomUUID(), text: '' }] });
  }

  removeChoice(index: number, choiceId: string): void {
    const draft = this.drafts()[index];
    this.patch(index, {
      choices: draft.choices.filter((c) => c.id !== choiceId),
      correctChoiceIds: draft.correctChoiceIds.filter((id) => id !== choiceId),
    });
  }

  toggleCorrect(index: number, choiceId: string): void {
    const draft = this.drafts()[index];
    const ids = draft.correctChoiceIds;
    this.patch(index, {
      correctChoiceIds:
        draft.type === 'multiple-choice'
          ? ids.includes(choiceId)
            ? ids.filter((i) => i !== choiceId)
            : [...ids, choiceId]
          : [choiceId],
    });
  }

  /** A new draft keeps the previous question's type — batches are usually all one kind. */
  addQuestion(): void {
    const last = this.drafts()[this.drafts().length - 1];
    this.drafts.update((list) => [...list, blankDraft(last?.type)]);
  }

  removeQuestion(index: number): void {
    if (this.drafts().length <= this.minQuestions()) return;
    this.drafts.update((list) => list.filter((_, i) => i !== index));
  }

  minQuestions(): number {
    return this.mode() === 'passage' ? 2 : 1;
  }

  usesChoices(type: QuizItemType): boolean {
    return CHOICE_TYPES.includes(type);
  }

  // --- Saving ---------------------------------------------------------------

  private buildAnswerRule(draft: QuestionDraft): AnswerRule {
    switch (draft.type) {
      case 'single-choice':
      case 'multiple-choice':
      case 'true-false':
        return { kind: 'choice', correctChoiceIds: draft.correctChoiceIds };
      case 'short-text':
        return { kind: 'text', acceptedAnswer: draft.acceptedAnswer, caseSensitive: false, punctuationSensitive: false };
      case 'number':
        return numberRuleFromText(draft.acceptedNumber);
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
    const drafts = this.drafts();
    const many = drafts.length > 1;
    const asPassage = this.mode() === 'passage' && !this.editingId();
    const errors: string[] = [];
    if (asPassage) {
      if (!this.passageTitle().trim()) errors.push('Vui lòng nhập tiêu đề đoạn văn/bài toán.');
      if (!this.passageText().trim()) errors.push('Vui lòng nhập nội dung đoạn văn/bài toán.');
      if (drafts.length < 2) errors.push('Cần ít nhất 2 câu hỏi cho một đoạn văn/bài toán.');
    }
    for (const [i, draft] of drafts.entries()) {
      const label = many ? `Câu ${i + 1}: ` : '';
      if (!draft.prompt.trim()) errors.push(`${label}Chưa nhập nội dung câu hỏi.`);
      if (draft.type === 'number' && draft.acceptedNumber.trim() && Number.isNaN(parseNumberAnswer(draft.acceptedNumber))) {
        errors.push(`${label}Đáp án số không hợp lệ (ví dụ: 12, 3,5, 7/2 hoặc 3 1/2).`);
        continue;
      }
      const result = this.validation.validate(
        draft.type,
        this.usesChoices(draft.type) ? draft.choices : undefined,
        this.buildAnswerRule(draft),
      );
      errors.push(...result.errors.map((e) => label + e));
    }
    if (errors.length) {
      this.errors.set(errors);
      return;
    }
    this.errors.set([]);

    const shared = {
      subject: this.subject(),
      grade: this.grade(),
      tags: this.tags()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      difficulty: this.difficulty(),
      points: this.points(),
      categoryId: this.categoryId()!,
      shuffleChoices: this.shuffleChoices(),
    };
    const perQuestion = (draft: QuestionDraft) => ({
      type: draft.type,
      prompt: draft.prompt,
      explanation: draft.explanation || undefined,
      choices: this.usesChoices(draft.type) ? draft.choices : undefined,
      answerRule: this.buildAnswerRule(draft),
    });

    let saved: QuizItem;
    const editingId = this.editingId();
    if (editingId) {
      const current = await this.quizItems.getById(editingId);
      await this.quizItems.update(editingId, {
        ...shared,
        ...perQuestion(drafts[0]),
        media: withImageRef(current?.media, drafts[0].imageUrl),
      });
      saved = (await this.quizItems.getById(editingId))!;
    } else {
      const created: QuizItem[] = [];
      const passageId = crypto.randomUUID();
      // All the new questions in one atomic write.
      await this.quizItems.inBatch(async () => {
        for (const [index, draft] of drafts.entries()) {
          const passage: PassageContext | undefined = asPassage
            ? {
                passageId,
                title: this.passageTitle().trim(),
                text: this.passageText().trim(),
                imageUrl: this.passageImageUrl().trim() || undefined,
                order: index + 1,
                total: drafts.length,
              }
            : undefined;
          const item: QuizItem = {
            ...newSyncEnvelope(crypto.randomUUID(), currentDeviceId()),
            ...shared,
            ...perQuestion(draft),
            media: withImageRef(undefined, draft.imageUrl),
            ...(passage ? { passage } : {}),
            reviewStatus: 'approved',
            status: 'active',
          };
          await this.quizItems.create(item);
          created.push(item);
        }
      });
      saved = created[created.length - 1];
      if (asPassage) {
        this.resetToBlank();
      } else if (created.length === 1) {
        this.editingId.set(saved.id);
        this.cloning.set(false);
      } else {
        // Keep the shared settings so the parent can go straight on to the next batch.
        this.drafts.set([blankDraft(drafts[drafts.length - 1].type)]);
      }
    }

    if (this.embedded) {
      this.saved.emit(saved);
    } else {
      await this.router.navigateByUrl('/quiz-bank');
    }
  }
}
