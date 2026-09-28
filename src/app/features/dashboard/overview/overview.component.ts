import { Component, signal } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { ProgressAggregationService, PeriodFilter, ProgressOverview } from '../services/progress-aggregation.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { Profile } from '../../../shared/models/domain.model';

/** Parent Dashboard Overview (FR-046): child selector, date filter, summary metrics. */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [SlicePipe, RouterLink, IconComponent],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
})
export class OverviewComponent {
  readonly children = signal<Profile[]>([]);
  readonly selectedChildId = signal('');
  readonly period = signal<PeriodFilter>(7);
  readonly overview = signal<ProgressOverview | undefined>(undefined);
  readonly statusLabel: Partial<Record<string, string>> = { completed: 'Hoàn thành', timeUp: 'Hết giờ', tryAgain: 'Hết lượt', abandoned: 'Bỏ dở' };

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly aggregation: ProgressAggregationService,
    private readonly router: Router,
  ) {
    void this.init();
  }

  private async init(): Promise<void> {
    const children = await this.profiles.findByRoleAndName('child');
    this.children.set(children);
    if (children.length > 0) {
      await this.selectChild(children[0].id);
    }
  }

  async selectChild(profileId: string): Promise<void> {
    this.selectedChildId.set(profileId);
    await this.refresh();
  }

  async setPeriod(period: PeriodFilter): Promise<void> {
    this.period.set(period);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.selectedChildId()) return;
    this.overview.set(await this.aggregation.overview(this.selectedChildId(), this.period()));
  }

  goToLearningNeeds(): void {
    void this.router.navigateByUrl(`/dashboard/${this.selectedChildId()}/learning-needs`);
  }
}
