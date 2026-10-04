import { Component, effect, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PlayService } from '../services/play.service';
import { Choice, PlayResult, QuizItemType } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';
import { IconComponent } from '../../../shared/icon/icon.component';
import { QuizImageComponent } from '../../../shared/quiz-image/quiz-image.component';
import { numberAnswerText } from '../services/answer-evaluator';

/** How a chosen/correct option is named in the review summary — picture-only options have no text. */
function choiceLabel(c: Choice): string {
  return c.text || '(hình)';
}

export interface QuestionReview {
  quizItemId: string;
  index: number;
  prompt: string;
  type: QuizItemType;
  choices?: Choice[];
  correctChoiceIds: Set<string>;
  selectedChoiceIds: Set<string>;
  selectedText: string;
  correctText: string;
  isCorrect: boolean;
  answered: boolean;
}

@Component({
  selector: 'app-result',
  standalone: true,
  imports: [IconComponent, QuizImageComponent],
  templateUrl: './result.component.html',
  styleUrl: './result.component.scss',
})
export class ResultComponent {
  readonly strings = vi;
  readonly result: PlayService['result'];
  readonly breakdown = signal<QuestionReview[]>([]);

  readonly outcomeLabel: Partial<Record<string, string>> = {
    completed: vi.exercise.resultCompleted,
    timeUp: vi.exercise.resultTimeUp,
    tryAgain: vi.exercise.resultTryAgain,
    abandoned: 'Đã bỏ bài',
  };

  constructor(
    private readonly play: PlayService,
    private readonly router: Router,
  ) {
    this.result = this.play.result;

    effect(() => {
      const result = this.result();
      if (result) this.breakdown.set(buildBreakdown(result));
    });
  }

  async goHome(): Promise<void> {
    await this.router.navigateByUrl('/child-home');
  }
}

/**
 * One review row per question, in play order, always from the result's own
 * frozen question copies — an edit to the bank afterwards never changes what
 * a past result shows. A question with no answer was left unanswered and is
 * shown as such, still revealing the correct answer.
 */
export function buildBreakdown(resultRecord: PlayResult): QuestionReview[] {
  return resultRecord.itemOrder
      .map((quizItemId, index) => {
        const item = resultRecord.itemSnapshots[quizItemId];
        if (!item) return undefined;
        const answer = resultRecord.answers[quizItemId];
        const result = answer && !answer.timedOut ? answer : undefined;
        const answered = !!result;
        const rule = item.answerRule;

        let correctChoiceIds = new Set<string>();
        let selectedChoiceIds = new Set<string>();
        let correctText = '';
        let selectedText = 'Chưa trả lời';

        if (rule.kind === 'choice') {
          correctChoiceIds = new Set(rule.correctChoiceIds);
          const choices = item.choices ?? [];
          correctText = choices
            .filter((c) => correctChoiceIds.has(c.id))
            .map(choiceLabel)
            .join(', ');
          if (result) {
            const submitted = Array.isArray(result.submittedAnswer)
              ? (result.submittedAnswer as string[])
              : [result.submittedAnswer as string];
            selectedChoiceIds = new Set(submitted);
            const text = choices
              .filter((c) => selectedChoiceIds.has(c.id))
              .map(choiceLabel)
              .join(', ');
            selectedText = text || 'Chưa trả lời';
          }
        } else if (rule.kind === 'text') {
          correctText = rule.acceptedAnswer;
          if (result) selectedText = String(result.submittedAnswer ?? '');
        } else if (rule.kind === 'number') {
          correctText = rule.acceptedValue !== undefined ? numberAnswerText(rule) : `${rule.min ?? ''}–${rule.max ?? ''}`;
          if (result) selectedText = String(result.submittedAnswer ?? '');
        } else if (rule.kind === 'boolean') {
          correctText = rule.correctValue ? 'Đúng' : 'Sai';
          if (result) selectedText = result.submittedAnswer ? 'Đúng' : 'Sai';
        }

        const row: QuestionReview = {
          quizItemId,
          index,
          prompt: item.prompt,
          type: item.type,
          choices: item.choices,
          correctChoiceIds,
          selectedChoiceIds,
          selectedText,
          correctText,
          isCorrect: result?.isCorrect ?? false,
          answered,
        };
        return row;
      })
      .filter((row): row is QuestionReview => !!row);
}
