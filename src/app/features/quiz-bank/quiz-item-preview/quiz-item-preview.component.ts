import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QuizItemRepository } from '../../../data/repositories/quiz-item.repository';
import { evaluateAnswer } from '../../child-play/services/answer-evaluator';
import { QuizItem } from '../../../shared/models/domain.model';
import { mulberry32, seededShuffle } from '../../../shared/random/seeded-random';
import { IconComponent } from '../../../shared/icon/icon.component';
import { QuizImageComponent } from '../../../shared/quiz-image/quiz-image.component';

/**
 * Renders exactly as a child would see it, including feedback, without
 * affecting any real child's progress (FR-021). "Shuffle Again" re-draws the
 * displayed choice order (spec CH-08 preview note).
 */
@Component({
  selector: 'app-quiz-item-preview',
  standalone: true,
  imports: [FormsModule, IconComponent, QuizImageComponent],
  templateUrl: './quiz-item-preview.component.html',
  styleUrl: './quiz-item-preview.component.scss',
})
export class QuizItemPreviewComponent implements OnInit {
  readonly item = signal<QuizItem | undefined>(undefined);
  readonly displayedChoiceIds = signal<string[]>([]);
  readonly selected = signal<string[]>([]);
  /** Typed answer for short-text and number questions. */
  readonly typedAnswer = signal('');
  readonly submitted = signal(false);
  readonly isCorrect = signal(false);

  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    const item = await this.quizItems.getById(id);
    this.item.set(item);
    this.shuffleAgain();
  }

  /** Back to the quiz bank with this question still open in the detail panel. */
  back(): void {
    const id = this.item()?.id;
    void this.router.navigate(['/quiz-bank'], { queryParams: id ? { item: id } : {} });
  }

  shuffleAgain(): void {
    this.typedAnswer.set('');
    this.submitted.set(false);
    const item = this.item();
    if (!item?.choices) return;
    const rng = mulberry32(Math.floor(Math.random() * 0xffffffff));
    this.displayedChoiceIds.set(
      item.shuffleChoices ? seededShuffle(item.choices, rng).map((c) => c.id) : item.choices.map((c) => c.id),
    );
    this.selected.set([]);
    this.submitted.set(false);
  }

  toggle(choiceId: string): void {
    const item = this.item();
    if (!item) return;
    this.selected.update((current) =>
      item.type === 'single-choice' || item.type === 'true-false'
        ? [choiceId]
        : current.includes(choiceId)
          ? current.filter((c) => c !== choiceId)
          : [...current, choiceId],
    );
  }

  submit(): void {
    const item = this.item();
    if (!item) return;
    this.isCorrect.set(evaluateAnswer(item, item.choices ? this.selected() : this.typedAnswer()));
    this.submitted.set(true);
  }

  choiceImage(id: string): string | undefined {
    return this.item()?.choices?.find((c) => c.id === id)?.imageRef;
  }

  choiceText(id: string): string {
    return this.item()?.choices?.find((c) => c.id === id)?.text ?? '';
  }
}
