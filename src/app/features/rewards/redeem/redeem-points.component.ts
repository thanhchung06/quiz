import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { PointUsageRepository } from '../../../data/repositories/point-usage.repository';
import { ResultRepository } from '../../../data/repositories/result.repository';
import { PointsService } from '../services/points.service';
import { PointsRepository } from '../../../data/repositories/points.repository';
import { Profile, PointUsage } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

/**
 * Parent screen for trading a child's points for a real-world item (plan
 * §3.6–3.7): the balance is counted history points minus point usage; each
 * use is an append-only PointUsage record (the history below), after which
 * points go down in the same atomic write; "Tính lại điểm" rebuilds them from the records.
 */
@Component({
  selector: 'app-redeem-points',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './redeem-points.component.html',
  styleUrl: './redeem-points.component.scss',
})
export class RedeemPointsComponent {
  readonly children = signal<Profile[]>([]);
  readonly selectedChildId = signal('');
  readonly earnedPoints = signal(0);
  readonly redeemedPoints = signal(0);
  readonly history = signal<PointUsage[]>([]);

  readonly pointsToRedeem = signal('');
  readonly note = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  /** The stored points (kept up to date by atomic +/−). */
  readonly balance = signal(0);
  /** What history − point usage adds up to; differs from balance only if something went wrong. */
  readonly fromRecords = computed(() => this.earnedPoints() - this.redeemedPoints());

  readonly selectedChildName = computed(() => this.children().find((c) => c.id === this.selectedChildId())?.displayName ?? '');

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly usages: PointUsageRepository,
    private readonly results: ResultRepository,
    private readonly points: PointsService,
    private readonly pointsRepo: PointsRepository,
  ) {
    void this.load();
  }

  private async load(): Promise<void> {
    const children = await this.profiles.findByRoleAndName('child');
    this.children.set(children);
    // The <select> defaults to whatever's first in the list, but ngModel only
    // updates on user interaction — seed it here so submitting without ever
    // touching the dropdown still targets the right child (see schedule
    // screen fix earlier this session for why this matters).
    if (!this.selectedChildId() && children.length > 0) {
      this.selectedChildId.set(children[0].id);
    }
    await this.loadBalanceAndHistory();
  }

  async selectChild(id: string): Promise<void> {
    this.selectedChildId.set(id);
    this.errorMessage.set('');
    this.successMessage.set('');
    await this.loadBalanceAndHistory();
  }

  private async loadBalanceAndHistory(): Promise<void> {
    const profileId = this.selectedChildId();
    if (!profileId) return;
    const history = await this.results.historyForChild(profileId);
    this.earnedPoints.set(history.filter((h) => h.counted).reduce((sum, h) => sum + h.pointsEarned, 0));
    const usages = await this.usages.listForChild(profileId);
    this.redeemedPoints.set(usages.reduce((sum, u) => sum + u.points, 0));
    this.history.set(usages);
    this.balance.set(await this.pointsRepo.get(profileId));
  }

  /** "Tính lại điểm": points from the records (only needed if they ever disagree). */
  async recompute(): Promise<void> {
    const profileId = this.selectedChildId();
    if (!profileId) return;
    const total = await this.points.recompute(profileId);
    this.successMessage.set(`Đã tính lại: ${this.selectedChildName()} có ${total} điểm.`);
    await this.loadBalanceAndHistory();
  }

  async submitRedemption(): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');

    const profileId = this.selectedChildId();
    const points = Math.round(Number(this.pointsToRedeem()));
    if (!profileId) {
      this.errorMessage.set('Hãy chọn một bé.');
      return;
    }
    if (!points || points <= 0) {
      this.errorMessage.set('Số điểm trừ phải lớn hơn 0.');
      return;
    }
    if (points > this.balance()) {
      this.errorMessage.set(`${this.selectedChildName()} chỉ còn ${this.balance()} điểm, không đủ để trừ ${points} điểm.`);
      return;
    }

    await this.usages.use(profileId, points, this.note().trim() || undefined);

    this.successMessage.set(`Đã trừ ${points} điểm của ${this.selectedChildName()}.`);
    this.pointsToRedeem.set('');
    this.note.set('');
    await this.loadBalanceAndHistory();
  }
}
