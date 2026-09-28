import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ResultRepository } from '../../../data/repositories/result.repository';
import { PlayResult } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { buildBreakdown, QuestionReview } from '../../child-play/result/result.component';

const END_LABEL: Partial<Record<string, string>> = {
  completed: 'Hoàn thành',
  timeUp: 'Hết giờ',
  tryAgain: 'Hết lượt (thua)',
  abandoned: 'Bỏ dở',
};

/**
 * Result detail (FR-047): every question with the child's answer, the correct
 * one and the outcome, from the result's own frozen question copies so it
 * stays right even if the bank changes later.
 */
@Component({
  selector: 'app-result-detail',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './result-detail.component.html',
  styleUrl: './result-detail.component.scss',
})
export class ResultDetailComponent implements OnInit {
  readonly result = signal<PlayResult | undefined>(undefined);
  readonly rows = signal<QuestionReview[]>([]);
  readonly endLabel = END_LABEL;

  constructor(
    private readonly results: ResultRepository,
    private readonly route: ActivatedRoute,
  ) {}

  async ngOnInit(): Promise<void> {
    const childId = this.route.snapshot.paramMap.get('childId');
    const id = this.route.snapshot.paramMap.get('resultId');
    if (!childId || !id) return;
    const result = await this.results.getById(childId, id);
    this.result.set(result);
    if (result) this.rows.set(buildBreakdown(result));
  }
}
