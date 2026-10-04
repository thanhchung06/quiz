import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { QuizValidationService } from '../services/quiz-validation.service';
import { CategoryPickerComponent } from '../quiz-item-form/category-picker.component';
import { ChoiceImageFieldComponent } from '../quiz-item-form/choice-image-field.component';
import { IconComponent } from '../../../shared/icon/icon.component';
import { QuizImageComponent, withImageRef } from '../../../shared/quiz-image/quiz-image.component';
import { AnswerRule, Choice, PassageContext, QuizDifficulty, QuizItem, QuizItemType, Subject } from '../../../shared/models/domain.model';
import { newSyncEnvelope } from '../../../shared/models/sync.model';
import { currentDeviceId } from '../../../data/repositories/base-repository';
import { numberAnswerText, numberRuleFromText } from '../../child-play/services/answer-evaluator';

/** match-pairs is excluded here: it has no child-play rendering yet (pre-existing gap), so new passage content should stick to fully-playable types. */
export type PassageQuestionType = Exclude<QuizItemType, 'match-pairs'>;

export interface SubQuestionRow {
  rowId: string; // stable @for tracking key, independent of save state
  existingItemId?: string; // set once this row is backed by a saved QuizItem
  type: PassageQuestionType;
  prompt: string;
  imageUrl: string;
  /** The saved item's media, so an edit only replaces its image and keeps anything else (e.g. audioRef). */
  media?: QuizItem['media'];
  explanation: string;
  difficulty: QuizDifficulty;
  points: number;
  choices: Choice[];
  correctChoiceIds: string[];
  acceptedAnswer: string;
  /** The number answer as typed: "12", "3,5", "7/2" or "3 1/2". */
  acceptedNumber: string;
}

function blankRow(): SubQuestionRow {
  return {
    rowId: crypto.randomUUID(),
    type: 'single-choice',
    prompt: '',
    imageUrl: '',
    explanation: '',
    difficulty: 2,
    points: 10,
    choices: [
      { id: crypto.randomUUID(), text: '' },
      { id: crypto.randomUUID(), text: '' },
    ],
    correctChoiceIds: [],
    acceptedAnswer: '',
    acceptedNumber: '',
  };
}

/**
 * Passage / problem-statement editor (FR-073–075): one shared reading text
 * or problem statement with several sub-questions, e.g. a paragraph with 3
 * comprehension questions or a math word-problem with 2 follow-up
 * sub-questions. Each sub-question saves as its own fully-scored QuizItem
 * (see PassageContext doc on domain.model.ts for why it's denormalized
 * rather than a new synced entity) — this screen only orchestrates saving
 * them together and keeping their shared title/text/order/total in sync.
 */
@Component({
  selector: 'app-passage-editor',
  standalone: true,
  imports: [FormsModule, CategoryPickerComponent, IconComponent, QuizImageComponent, ChoiceImageFieldComponent],
  templateUrl: './passage-editor.component.html',
  styleUrl: './passage-editor.component.scss',
})
export class PassageEditorComponent implements OnInit {
  readonly subject = signal<Subject>('language');
  readonly grade = signal(1);
  readonly categoryId = signal<string | undefined>(undefined);
  readonly title = signal('');
  readonly text = signal('');
  readonly imageUrl = signal('');
  readonly rows = signal<SubQuestionRow[]>([blankRow(), blankRow()]);
  readonly errors = signal<string[]>([]);

  private passageId?: string;
  private readonly removedItemIds: string[] = [];

  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly validation: QuizValidationService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const passageId = this.route.snapshot.paramMap.get('passageId');
    if (!passageId) return;
    const siblings = await this.quizItems.byPassage(passageId);
    if (siblings.length === 0) return;

    this.passageId = passageId;
    const first = siblings[0];
    this.subject.set(first.subject);
    this.grade.set(first.grade);
    this.categoryId.set(first.categoryId);
    this.title.set(first.passage!.title);
    this.text.set(first.passage!.text);
    this.imageUrl.set(first.passage!.imageUrl ?? '');
    this.rows.set(siblings.map((item) => this.rowFromItem(item)));
  }

  private rowFromItem(item: QuizItem): SubQuestionRow {
    return {
      rowId: item.id,
      existingItemId: item.id,
      type: item.type as PassageQuestionType,
      prompt: item.prompt,
      imageUrl: item.media?.imageRef ?? '',
      media: item.media,
      explanation: item.explanation ?? '',
      difficulty: item.difficulty ?? 2, // legacy rows predating the difficulty field default to Trung bình
      points: item.points,
      choices: item.choices ?? [
        { id: crypto.randomUUID(), text: '' },
        { id: crypto.randomUUID(), text: '' },
      ],
      correctChoiceIds: item.answerRule.kind === 'choice' ? item.answerRule.correctChoiceIds : [],
      acceptedAnswer: item.answerRule.kind === 'text' ? item.answerRule.acceptedAnswer : '',
      acceptedNumber: item.answerRule.kind === 'number' ? numberAnswerText(item.answerRule) : '',
    };
  }

  setRowType(row: SubQuestionRow, type: PassageQuestionType): void {
    row.type = type;
    if (type === 'true-false') {
      row.choices = [
        { id: 'true', text: 'Đúng' },
        { id: 'false', text: 'Sai' },
      ];
      row.correctChoiceIds = [];
    }
  }

  addRow(): void {
    this.rows.update((r) => [...r, blankRow()]);
  }

  removeRow(rowId: string): void {
    const row = this.rows().find((r) => r.rowId === rowId);
    if (row?.existingItemId) this.removedItemIds.push(row.existingItemId);
    this.rows.update((r) => r.filter((x) => x.rowId !== rowId));
  }

  setChoiceImage(choice: Choice, imageRef: string): void {
    if (imageRef) choice.imageRef = imageRef;
    else delete choice.imageRef;
  }

  addChoice(row: SubQuestionRow): void {
    row.choices.push({ id: crypto.randomUUID(), text: '' });
  }

  toggleCorrect(row: SubQuestionRow, choiceId: string): void {
    if (row.type === 'single-choice' || row.type === 'true-false') {
      row.correctChoiceIds = [choiceId];
    } else {
      row.correctChoiceIds = row.correctChoiceIds.includes(choiceId)
        ? row.correctChoiceIds.filter((i) => i !== choiceId)
        : [...row.correctChoiceIds, choiceId];
    }
  }

  usesChoices(row: SubQuestionRow): boolean {
    return row.type === 'single-choice' || row.type === 'multiple-choice' || row.type === 'true-false';
  }

  private buildAnswerRule(row: SubQuestionRow): AnswerRule {
    switch (row.type) {
      case 'single-choice':
      case 'multiple-choice':
      case 'true-false':
        return { kind: 'choice', correctChoiceIds: row.correctChoiceIds };
      case 'short-text':
        return { kind: 'text', acceptedAnswer: row.acceptedAnswer, caseSensitive: false, punctuationSensitive: false };
      case 'number':
        return numberRuleFromText(row.acceptedNumber);
      default:
        return { kind: 'text', acceptedAnswer: '', caseSensitive: false, punctuationSensitive: false };
    }
  }

  async save(): Promise<void> {
    const errors: string[] = [];
    if (!this.categoryId()) errors.push('Vui lòng chọn danh mục.');
    if (!this.title().trim()) errors.push('Vui lòng nhập tiêu đề đoạn văn/bài toán.');
    if (!this.text().trim()) errors.push('Vui lòng nhập nội dung đoạn văn/bài toán.');
    if (this.rows().length < 2) errors.push('Cần ít nhất 2 câu hỏi cho một đoạn văn/bài toán nhiều câu hỏi.');

    const rules: AnswerRule[] = [];
    this.rows().forEach((row, i) => {
      const rule = this.buildAnswerRule(row);
      rules.push(rule);
      if (!row.prompt.trim()) errors.push(`Câu ${i + 1}: cần nhập nội dung câu hỏi.`);
      const result = this.validation.validate(row.type, this.usesChoices(row) ? row.choices : undefined, rule);
      if (!result.valid) errors.push(...result.errors.map((e) => `Câu ${i + 1}: ${e}`));
    });

    if (errors.length) {
      this.errors.set(errors);
      return;
    }
    this.errors.set([]);

    const passageId = this.passageId ?? crypto.randomUUID();
    const total = this.rows().length;
    const deviceId = currentDeviceId();

    // Removed, changed and new sub-questions in one atomic write.
    await this.quizItems.inBatch(async () => {
      for (const itemId of this.removedItemIds) {
        await this.quizItems.softDelete(itemId);
      }

      for (const [index, row] of this.rows().entries()) {
        const passage: PassageContext = {
          passageId,
          title: this.title().trim(),
          text: this.text().trim(),
          imageUrl: this.imageUrl().trim() || undefined,
          order: index + 1,
          total,
        };
        const patch = {
          subject: this.subject(),
          grade: this.grade(),
          type: row.type,
          prompt: row.prompt,
          explanation: row.explanation || undefined,
          tags: [],
          difficulty: row.difficulty,
          points: row.points,
          categoryId: this.categoryId()!,
          shuffleChoices: true,
          choices: this.usesChoices(row) ? row.choices : undefined,
          answerRule: rules[index],
          media: withImageRef(row.media, row.imageUrl),
          passage,
        };

        if (row.existingItemId) {
          await this.quizItems.update(row.existingItemId, patch);
        } else {
          const item: QuizItem = {
            ...newSyncEnvelope(crypto.randomUUID(), deviceId),
            ...patch,
            reviewStatus: 'approved',
            status: 'active',
          };
          await this.quizItems.create(item);
        }
      }
    });

    await this.router.navigateByUrl('/quiz-bank');
  }
}
