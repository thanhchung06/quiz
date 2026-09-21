import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../../core/auth/session.service';
import { RotationRepository } from '../../../data/repositories/rotation.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { AttemptLifecycleService } from '../services/attempt-lifecycle.service';
import { Exercise } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';

@Component({
  selector: 'app-exercise-intro',
  standalone: true,
  imports: [],
  templateUrl: './exercise-intro.component.html',
  styleUrl: './exercise-intro.component.scss',
})
export class ExerciseIntroComponent implements OnInit {
  readonly strings = vi;
  readonly exercise = signal<Exercise | undefined>(undefined);

  constructor(
    private readonly session: SessionService,
    private readonly rotations: RotationRepository,
    private readonly exercises: ExerciseRepository,
    private readonly lifecycle: AttemptLifecycleService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const profile = this.session.requireCurrentProfile();
    const exerciseId = await this.rotations.resolveTodayExerciseId(profile.id);
    if (exerciseId) {
      this.exercise.set(await this.exercises.getById(exerciseId));
    }
  }

  async start(): Promise<void> {
    const exercise = this.exercise();
    const profile = this.session.requireCurrentProfile();
    if (!exercise) return;

    const resumed = await this.lifecycle.resume(exercise, profile.id);
    if (resumed) {
      await this.router.navigateByUrl('/exercise/question');
      return;
    }

    // Every exercise is one-attempt-per-child (a daily exercise: per child
    // per local calendar day instead) — a prior finished attempt for the
    // relevant window means there's nothing left to start, so go straight
    // to that past result.
    const priorCompleted = exercise.isDaily
      ? await this.lifecycle.findCompletedAttemptToday(exercise.id, profile.id)
      : await this.lifecycle.findMostRecentCompletedAttempt(exercise.id, profile.id);
    if (priorCompleted) {
      this.lifecycle.loadAttempt(priorCompleted);
      await this.router.navigateByUrl('/exercise/result');
      return;
    }

    await this.lifecycle.start(exercise, profile.id);
    await this.router.navigateByUrl('/exercise/question');
  }
}
