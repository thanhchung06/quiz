import { Injectable } from '@angular/core';
import { RewardRepository } from '../../../data/repositories/reward.repository';

function localDateOf(iso: string): string {
  const d = new Date(iso);
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/** Deterministic daily bonus badge after completion (spec: Surprise bonus, Low priority). */
@Injectable({ providedIn: 'root' })
export class DailyBonusService {
  constructor(private readonly rewards: RewardRepository) {}

  async grantIfEligible(profileId: string, attemptId: string): Promise<boolean> {
    const today = localDateOf(new Date().toISOString());
    const key = `unlock.daily-bonus.${today}`;
    if (await this.rewards.hasKey(profileId, key)) return false;
    // Deterministic per (profile, date): only every 3rd day gets a bonus, so it
    // stays a pleasant surprise rather than an expected daily entitlement.
    const dayNumber = Math.floor(new Date(today).getTime() / 86_400_000);
    if (dayNumber % 3 !== 0) return false;
    await this.rewards.award(profileId, 'unlock', key, attemptId);
    return true;
  }
}
