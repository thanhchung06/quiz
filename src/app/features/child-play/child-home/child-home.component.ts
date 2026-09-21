import { Component, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { SessionService } from '../../../core/auth/session.service';
import { RotationRepository } from '../../../data/repositories/rotation.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';
import { RewardRepository } from '../../../data/repositories/reward.repository';
import { PointRedemptionRepository } from '../../../data/repositories/point-redemption.repository';
import { AttemptLifecycleService } from '../services/attempt-lifecycle.service';
import { StreakService } from '../../rewards/services/streak.service';
import { Attempt, Exercise } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';
import { IconComponent } from '../../../shared/icon/icon.component';

const END_CONDITION_ICON: Partial<Record<string, string>> = {
  completed: 'check_circle',
  timeUp: 'timer',
  tryAgain: 'cancel',
  abandoned: 'close',
  inProgress: 'hourglass_bottom',
};

@Component({
  selector: 'app-child-home',
  standalone: true,
  imports: [IconComponent, DecimalPipe],
  templateUrl: './child-home.component.html',
  styleUrl: './child-home.component.scss',
})
export class ChildHomeComponent implements OnInit {
  readonly strings = vi;
  readonly endConditionIcon = END_CONDITION_ICON;
  readonly todayExercise = signal<Exercise | undefined>(undefined);
  readonly hasActiveAttempt = signal(false);
  readonly activeOnAnotherDevice = signal(false);
  /** Set once this profile already has a finished attempt for today's exercise (for a daily exercise, only if that attempt was today — see FR-091) — every exercise is one-attempt-per-child (daily: per local day), so this replaces the Start button with a "view past result" one. */
  readonly completedAttempt = signal<Attempt | undefined>(undefined);
  readonly childName = signal('');
  readonly streak = signal(0);
  readonly totalStars = signal(0);
  readonly totalPoints = signal(0);
  readonly badgeCount = signal(0);
  readonly last7Days = signal<Attempt[]>([]);

  constructor(
    private readonly session: SessionService,
    private readonly rotations: RotationRepository,
    private readonly exercises: ExerciseRepository,
    private readonly attempts: AttemptRepository,
    private readonly rewards: RewardRepository,
    private readonly redemptions: PointRedemptionRepository,
    private readonly lifecycle: AttemptLifecycleService,
    private readonly streaks: StreakService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const profile = this.session.requireCurrentProfile();
    this.childName.set(profile.displayName);

    const exerciseId = await this.rotations.resolveTodayExerciseId(profile.id);
    const exercise = exerciseId ? await this.exercises.getById(exerciseId) : undefined;
    this.todayExercise.set(exercise);

    const active = await this.attempts.findInProgress(profile.id);
    const ownedByThisDevice = await this.attempts.findInProgressOwnedByThisDevice(profile.id);
    this.hasActiveAttempt.set(!!ownedByThisDevice);
    this.activeOnAnotherDevice.set(!!active && !ownedByThisDevice);

    if (exercise && !active) {
      this.completedAttempt.set(
        exercise.isDaily
          ? await this.lifecycle.findCompletedAttemptToday(exercise.id, profile.id)
          : await this.lifecycle.findMostRecentCompletedAttempt(exercise.id, profile.id),
      );
    }

    this.streak.set(await this.streaks.currentStreak(profile.id));
    const allAttempts = await this.attempts.listForProfile(profile.id);
    this.totalStars.set(allAttempts.reduce((sum, a) => sum + a.starsAwarded, 0));
    const earned = allAttempts.reduce((sum, a) => sum + a.score, 0);
    const redeemed = await this.redemptions.totalRedeemed(profile.id);
    this.totalPoints.set(earned - redeemed);
    this.badgeCount.set(await this.rewards.countByType(profile.id, 'badge'));

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.last7Days.set(
      allAttempts
        .filter((a) => new Date(a.startedAt).getTime() >= sevenDaysAgo)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    );
  }

  async startOrResume(): Promise<void> {
    await this.router.navigateByUrl('/exercise-intro');
  }

  async viewPastResult(): Promise<void> {
    const done = this.completedAttempt();
    if (!done) return;
    this.lifecycle.loadAttempt(done);
    await this.router.navigateByUrl('/exercise/result');
  }

  async logout(): Promise<void> {
    this.session.logout();
    await this.router.navigateByUrl('/profiles');
  }
}
