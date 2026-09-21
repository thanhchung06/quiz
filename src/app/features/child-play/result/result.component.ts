import { Component, effect, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AttemptLifecycleService } from '../services/attempt-lifecycle.service';
import { AnswerResultRepository } from '../../../data/repositories/answer-result.repository';
import { Attempt, Choice, QuizItemType } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';
import { IconComponent } from '../../../shared/icon/icon.component';

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
  imports: [DecimalPipe, IconComponent],
  templateUrl: './result.component.html',
  styleUrl: './result.component.scss',
})
export class ResultComponent {
  readonly strings = vi;
  readonly attempt: AttemptLifecycleService['attempt'];
  readonly rewardsOutcome: AttemptLifecycleService['rewardsOutcome'];
  readonly breakdown = signal<QuestionReview[]>([]);

  readonly outcomeLabel: Partial<Record<string, string>> = {
    completed: vi.exercise.resultCompleted,
    timeUp: vi.exercise.resultTimeUp,
    tryAgain: vi.exercise.resultTryAgain,
  };

  constructor(
    private readonly lifecycle: AttemptLifecycleService,
    private readonly answerResults: AnswerResultRepository,
    private readonly router: Router,
  ) {
    this.attempt = this.lifecycle.attempt;
    this.rewardsOutcome = this.lifecycle.rewardsOutcome;

    effect(() => {
      const attempt = this.attempt();
      if (attempt) void this.loadBreakdown(attempt);
    });
  }

  /**
   * Builds one review row per resolved question, in play order, always from
   * `Attempt.itemSnapshots` (never the live QuizItemRepository) — same
   * frozen-snapshot rule as play itself, so an edit to the bank afterward
   * never changes what a past result shows. A question with no matching
   * AnswerResult was left unanswered (e.g. a per-question timeout) and is
   * shown as such, still revealing the correct answer.
   */
  private async loadBreakdown(attempt: Attempt): Promise<void> {
    const results = await this.answerResults.listForAttempt(attempt.id);
    const byItemId = new Map(results.map((r) => [r.quizItemId, r]));

    const rows: QuestionReview[] = attempt.resolvedItemOrder
      .map((quizItemId, index) => {
        const item = attempt.itemSnapshots[quizItemId];
        if (!item) return undefined;
        const result = byItemId.get(quizItemId);
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
            .map((c) => c.text)
            .join(', ');
          if (result) {
            const submitted = Array.isArray(result.submittedAnswer)
              ? (result.submittedAnswer as string[])
              : [result.submittedAnswer as string];
            selectedChoiceIds = new Set(submitted);
            const text = choices
              .filter((c) => selectedChoiceIds.has(c.id))
              .map((c) => c.text)
              .join(', ');
            selectedText = text || 'Chưa trả lời';
          }
        } else if (rule.kind === 'text') {
          correctText = rule.acceptedAnswer;
          if (result) selectedText = String(result.submittedAnswer ?? '');
        } else if (rule.kind === 'number') {
          correctText = rule.acceptedValue !== undefined ? String(rule.acceptedValue) : `${rule.min ?? ''}–${rule.max ?? ''}`;
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

    this.breakdown.set(rows);
  }

  async goHome(): Promise<void> {
    await this.router.navigateByUrl('/child-home');
  }
}
