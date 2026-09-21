import { Injectable } from '@angular/core';
import { RewardRepository } from '../../../data/repositories/reward.repository';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { StreakService } from './streak.service';
import { Attempt } from '../../../shared/models/domain.model';

export const BADGE_KEYS = {
  FIRST_COMPLETION: 'badge.first-completion',
  FIVE_DAY_STREAK: 'badge.five-day-streak',
  PERFECT_SCORE: 'badge.perfect-score',
  PERSISTENCE: 'badge.persistence',
} as const;

/**
 * Badge-milestone rules (FR-045): first completion, five-day streak,
 * perfect score, persistence (completing after a prior tryAgain), subject
 * milestones. Awards are idempotent — each badge key is granted at most once.
 */
@Injectable({ providedIn: 'root' })
export class BadgesService {
  constructor(
    private readonly rewards: RewardRepository,
    private readonly attempts: AttemptRepository,
    private readonly streaks: StreakService,
  ) {}

  async evaluateAndAward(attempt: Attempt): Promise<string[]> {
    if (attempt.status !== 'completed') return [];
    const newlyAwarded: string[] = [];

    if (!(await this.rewards.hasBadge(attempt.profileId, BADGE_KEYS.FIRST_COMPLETION))) {
      await this.rewards.award(attempt.profileId, 'badge', BADGE_KEYS.FIRST_COMPLETION, attempt.id);
      newlyAwarded.push(BADGE_KEYS.FIRST_COMPLETION);
    }

    if (attempt.accuracy === 1) {
      if (!(await this.rewards.hasBadge(attempt.profileId, BADGE_KEYS.PERFECT_SCORE))) {
        await this.rewards.award(attempt.profileId, 'badge', BADGE_KEYS.PERFECT_SCORE, attempt.id);
        newlyAwarded.push(BADGE_KEYS.PERFECT_SCORE);
      }
    }

    const streak = await this.streaks.currentStreak(attempt.profileId);
    if (streak >= 5 && !(await this.rewards.hasBadge(attempt.profileId, BADGE_KEYS.FIVE_DAY_STREAK))) {
      await this.rewards.award(attempt.profileId, 'badge', BADGE_KEYS.FIVE_DAY_STREAK, attempt.id);
      newlyAwarded.push(BADGE_KEYS.FIVE_DAY_STREAK);
    }

    const priorAttempts = (await this.attempts.listForProfile(attempt.profileId)).filter(
      (a) => a.exerciseId === attempt.exerciseId && a.id !== attempt.id,
    );
    const hadPriorTryAgain = priorAttempts.some((a) => a.status === 'tryAgain');
    if (hadPriorTryAgain && !(await this.rewards.hasBadge(attempt.profileId, BADGE_KEYS.PERSISTENCE))) {
      await this.rewards.award(attempt.profileId, 'badge', BADGE_KEYS.PERSISTENCE, attempt.id);
      newlyAwarded.push(BADGE_KEYS.PERSISTENCE);
    }

    return newlyAwarded;
  }
}
