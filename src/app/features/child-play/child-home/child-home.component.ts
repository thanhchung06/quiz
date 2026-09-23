import { Component, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { SessionService } from '../../../core/auth/session.service';
import { RotationRepository } from '../../../data/repositories/rotation.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
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

/**
 * One exercise "card" shown on the child's home screen — either the
 * today's/daily-assigned slot, or one entry in the one-time exercises list.
 * Only one Attempt may ever be in progress per profile at a time (FR-063),
 * so a card whose exercise isn't the active one is `blocked` rather than
 * offering a Start button that would just fail on `startAttempt`.
 */
type CardStatus = 'activeHere' | 'activeElsewhere' | 'blocked' | 'completed' | 'startable';

interface ExerciseCard {
  assignmentId?: string;
  exercise: Exercise;
  status: CardStatus;
  completedAttempt?: Attempt;
  attemptsRemaining: number | 'unlimited';
}

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
  readonly todayCard = signal<ExerciseCard | undefined>(undefined);
  readonly onetimeCards = signal<ExerciseCard[]>([]);
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
    private readonly assignments: AssignmentRepository,
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

    const active = await this.attempts.findInProgress(profile.id);
    const activeOwnedByThisDevice = !!(await this.attempts.findInProgressOwnedByThisDevice(profile.id));

    const todayExerciseId = await this.rotations.resolveTodayExerciseId(profile.id);
    const todayExercise = todayExerciseId ? await this.exercises.getById(todayExerciseId) : undefined;
    this.todayCard.set(
      todayExercise ? await this.buildCard(todayExercise, profile.id, active, activeOwnedByThisDevice) : undefined,
    );

    const onetimeAssignments = await this.assignments.listOnetimeFor(profile.id);
    const cards: ExerciseCard[] = [];
    for (const assignment of onetimeAssignments) {
      const exercise = await this.exercises.getById(assignment.exerciseId);
      if (!exercise || exercise.status !== 'active') continue;
      const card = await this.buildCard(exercise, profile.id, active, activeOwnedByThisDevice, assignment.id);
      // A fully exhausted one-time exercise drops off the list entirely.
      if (card.status === 'completed') continue;
      cards.push(card);
    }
    this.onetimeCards.set(cards);

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

  /**
   * Resolves one exercise's card state. `active` is the single (at most one,
   * FR-063) in-progress attempt for this profile, if any, regardless of
   * which exercise it belongs to — a card for any OTHER exercise is
   * `blocked` while it's ongoing, rather than letting the child try to start
   * a second attempt that `startAttempt` would just reject.
   */
  private async buildCard(
    exercise: Exercise,
    profileId: string,
    active: Attempt | undefined,
    activeOwnedByThisDevice: boolean,
    assignmentId?: string,
  ): Promise<ExerciseCard> {
    if (active?.exerciseId === exercise.id) {
      return {
        assignmentId,
        exercise,
        status: activeOwnedByThisDevice ? 'activeHere' : 'activeElsewhere',
        attemptsRemaining: 0,
      };
    }
    if (active) {
      return { assignmentId, exercise, status: 'blocked', attemptsRemaining: 0 };
    }

    const attemptsRemaining = await this.lifecycle.attemptsRemaining(exercise, profileId);
    if (attemptsRemaining === 0) {
      const completedAttempt = exercise.isDaily
        ? await this.lifecycle.findCompletedAttemptToday(exercise.id, profileId)
        : await this.lifecycle.findMostRecentCompletedAttempt(exercise.id, profileId);
      return { assignmentId, exercise, status: 'completed', completedAttempt, attemptsRemaining };
    }
    return { assignmentId, exercise, status: 'startable', attemptsRemaining };
  }

  /** Only worth showing a "lượt còn lại" hint for a repeatable, non-daily exercise (daily has its own once-a-day copy). */
  showsRemainingHint(card: ExerciseCard): boolean {
    return !card.exercise.isDaily && (card.exercise.repeatLimit ?? 1) !== 1 && card.status === 'startable';
  }

  async startCard(card: ExerciseCard): Promise<void> {
    await this.router.navigateByUrl(card.assignmentId ? `/exercise-intro/${card.assignmentId}` : '/exercise-intro');
  }

  async viewPastResult(card: ExerciseCard): Promise<void> {
    const done = card.completedAttempt;
    if (!done) return;
    this.lifecycle.loadAttempt(done);
    await this.router.navigateByUrl('/exercise/result');
  }

  async logout(): Promise<void> {
    this.session.logout();
    await this.router.navigateByUrl('/profiles');
  }
}
