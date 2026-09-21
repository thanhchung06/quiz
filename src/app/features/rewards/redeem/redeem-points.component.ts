import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { PointRedemptionRepository } from '../../../data/repositories/point-redemption.repository';
import { Profile, PointRedemption } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

/**
 * Parent screen for trading a child's earned points for a real-world item:
 * pick a child, see their current spendable balance (earned − already
 * redeemed, both computed from immutable history, never a stored running
 * total), enter how many points to deduct, and submit. Every redemption is
 * an append-only record — same "never edited after write" rule as
 * AnswerResult/Reward — which doubles as the usage history shown below.
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
  readonly history = signal<PointRedemption[]>([]);

  readonly pointsToRedeem = signal('');
  readonly note = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly balance = computed(() => this.earnedPoints() - this.redeemedPoints());

  readonly selectedChildName = computed(() => this.children().find((c) => c.id === this.selectedChildId())?.displayName ?? '');

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly attempts: AttemptRepository,
    private readonly redemptions: PointRedemptionRepository,
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
    const allAttempts = await this.attempts.listForProfile(profileId);
    this.earnedPoints.set(allAttempts.reduce((sum, a) => sum + a.score, 0));
    this.redeemedPoints.set(await this.redemptions.totalRedeemed(profileId));
    this.history.set(await this.redemptions.listForProfile(profileId));
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

    await this.redemptions.redeem(profileId, points, this.note().trim() || undefined);
    this.successMessage.set(`Đã trừ ${points} điểm của ${this.selectedChildName()}.`);
    this.pointsToRedeem.set('');
    this.note.set('');
    await this.loadBalanceAndHistory();
  }
}
