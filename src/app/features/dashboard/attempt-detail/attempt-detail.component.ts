import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { AnswerResultRepository } from '../../../data/repositories/answer-result.repository';
import { Attempt, AnswerResult } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

const END_CONDITION_LABEL: Partial<Record<string, string>> = {
  completed: 'Hoàn thành',
  timeUp: 'Hết giờ',
  tryAgain: 'Hết lượt (thua)',
  abandoned: 'Đã hủy',
  inProgress: 'Đang làm',
};

/**
 * Attempt Detail (FR-047): every prompt/submitted/correct/outcome/response
 * time; reads from the immutable AnswerResult/Attempt snapshots so it stays
 * correct even if the source quiz item is later changed.
 */
@Component({
  selector: 'app-attempt-detail',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './attempt-detail.component.html',
  styleUrl: './attempt-detail.component.scss',
})
export class AttemptDetailComponent implements OnInit {
  readonly attempt = signal<Attempt | undefined>(undefined);
  readonly answers = signal<AnswerResult[]>([]);
  readonly endConditionLabel = END_CONDITION_LABEL;

  constructor(
    private readonly attempts: AttemptRepository,
    private readonly answerResults: AnswerResultRepository,
    private readonly route: ActivatedRoute,
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('attemptId');
    if (!id) return;
    this.attempt.set(await this.attempts.getById(id));
    this.answers.set(await this.answerResults.listForAttempt(id));
  }
}
