import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { PointUsageRepository, USAGE_PAGE } from '../../../data/repositories/point-usage.repository';
import { PointsService } from '../services/points.service';
import { PointsRepository } from '../../../data/repositories/points.repository';
import { Profile, PointUsage } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

/**
 * Parent screen for trading a child's points for a real-world item (plan
 * §3.6–3.7): each use is an append-only PointUsage record (the history below,
 * a page at a time) carrying the running total of points used; the child's
 * points are set in the same atomic write to totalEarned − totalUsed.
 * "Tính lại điểm" sets them again from those two totals.
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
  /** A full page came back, so there may be older uses. */
  readonly hasMore = signal(false);

  readonly pointsToRedeem = signal('');
  readonly note = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  /** The stored points (set from the totals on every finish and point use). */
  readonly balance = signal(0);
  /** totalEarned − totalUsed; differs from balance only if something went wrong. */
  readonly fromRecords = computed(() => this.earnedPoints() - this.redeemedPoints());

  readonly selectedChildName = computed(() => this.children().find((c) => c.id === this.selectedChildId())?.displayName ?? '');

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly usages: PointUsageRepository,
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
    const [earned, used, balance, usages] = await Promise.all([
      this.pointsRepo.totalEarned(profileId),
      this.pointsRepo.totalUsed(profileId),
      this.pointsRepo.get(profileId),
      this.usages.page(profileId),
    ]);
    this.earnedPoints.set(earned);
    this.redeemedPoints.set(used);
    this.balance.set(balance);
    this.history.set(usages);
    this.hasMore.set(usages.length === USAGE_PAGE);
  }

  /** "Xem thêm": the next page of older uses. */
  async loadMore(): Promise<void> {
    const profileId = this.selectedChildId();
    const oldest = this.history().at(-1);
    if (!profileId || !oldest) return;
    const older = await this.usages.page(profileId, oldest.id);
    this.history.update((list) => [...list, ...older]);
    this.hasMore.set(older.length === USAGE_PAGE);
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
