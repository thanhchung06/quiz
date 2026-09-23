import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionService } from '../../../core/auth/session.service';
import { RotationRepository } from '../../../data/repositories/rotation.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
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
  /** Set only when reached via a specific (dated-today or one-time) assignment route param. */
  private assignmentId?: string;

  constructor(
    private readonly session: SessionService,
    private readonly rotations: RotationRepository,
    private readonly exercises: ExerciseRepository,
    private readonly assignments: AssignmentRepository,
    private readonly lifecycle: AttemptLifecycleService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const profile = this.session.requireCurrentProfile();
    const routeAssignmentId = this.route.snapshot.paramMap.get('assignmentId');

    if (routeAssignmentId) {
      const assignment = await this.assignments.getById(routeAssignmentId);
      if (assignment) {
        this.assignmentId = assignment.id;
        this.exercise.set(await this.exercises.getById(assignment.exerciseId));
      }
      return;
    }

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

    // A prior finished attempt only blocks starting once its repeat limit
    // (or, for a daily exercise, today's one attempt) is exhausted — go
    // straight to that past result instead.
    const remaining = await this.lifecycle.attemptsRemaining(exercise, profile.id);
    if (remaining === 0) {
      const priorCompleted = exercise.isDaily
        ? await this.lifecycle.findCompletedAttemptToday(exercise.id, profile.id)
        : await this.lifecycle.findMostRecentCompletedAttempt(exercise.id, profile.id);
      if (priorCompleted) {
        this.lifecycle.loadAttempt(priorCompleted);
        await this.router.navigateByUrl('/exercise/result');
      }
      return;
    }

    await this.lifecycle.start(exercise, profile.id, this.assignmentId);
    await this.router.navigateByUrl('/exercise/question');
  }
}
