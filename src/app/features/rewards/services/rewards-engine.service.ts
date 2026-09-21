import { Injectable } from '@angular/core';
import { Attempt } from '../../../shared/models/domain.model';
import { RewardRepository } from '../../../data/repositories/reward.repository';
import { StarsService } from './stars.service';
import { StreakService } from './streak.service';
import { BadgesService } from './badges.service';
import { PersonalBestService } from './personal-best.service';
import { DailyBonusService } from './daily-bonus.service';

export interface RewardsOutcome {
  stars: number;
  streak: number;
  newBadges: string[];
  personalBest: boolean;
  dailyBonus: boolean;
}

/**
 * Single entry point run once a scored Attempt finishes (FR-042–045): computes
 * stars, reads the current streak, evaluates badges/personal-best/daily-bonus,
 * and persists the star Reward. Called from AttemptLifecycleService so every
 * completed attempt — regardless of which screen triggered it — is rewarded
 * consistently.
 */
@Injectable({ providedIn: 'root' })
export class RewardsEngineService {
  constructor(
    private readonly rewards: RewardRepository,
    private readonly stars: StarsService,
    private readonly streaks: StreakService,
    private readonly badges: BadgesService,
    private readonly personalBest: PersonalBestService,
    private readonly dailyBonus: DailyBonusService,
  ) {}

  async processCompletedAttempt(attempt: Attempt): Promise<RewardsOutcome> {
    const starCount = this.stars.computeStars(attempt);
    if (starCount > 0) {
      await this.rewards.award(attempt.profileId, 'star', `star.${attempt.id}`, attempt.id);
    }

    const streak = await this.streaks.currentStreak(attempt.profileId);
    const newBadges = await this.badges.evaluateAndAward(attempt);
    const pb = await this.personalBest.check(attempt);
    if (pb.any) {
      await this.rewards.award(attempt.profileId, 'personalBest', `personal-best.${attempt.id}`, attempt.id);
    }
    const dailyBonus = await this.dailyBonus.grantIfEligible(attempt.profileId, attempt.id);

    return { stars: starCount, streak, newBadges, personalBest: pb.any, dailyBonus };
  }
}
