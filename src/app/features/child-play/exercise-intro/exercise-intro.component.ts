import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionService } from '../../../core/auth/session.service';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { PlaySessionRepository } from '../../../data/repositories/play-session.repository';
import { PlayService } from '../services/play.service';
import { Assignment, Exercise, PlaySession } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';

/**
 * Before starting: an assigned exercise (/exercise-intro/:assignmentId, shown
 * from the assignment's own snapshot) or a practice one (/practice/:exerciseId).
 * A child with another exercise still open is asked to give it up first
 * (plan §3.3 — it then counts as a try).
 */
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
  readonly triesLeft = signal<number | 'unlimited' | undefined>(undefined);
  /** Another exercise the child left unfinished — must be given up before this one starts. */
  readonly otherSession = signal<PlaySession | undefined>(undefined);
  readonly errorMessage = signal('');
  readonly starting = signal(false);
  private assignment?: Assignment;

  constructor(
    private readonly session: SessionService,
    private readonly exercises: ExerciseRepository,
    private readonly assignments: AssignmentRepository,
    private readonly sessions: PlaySessionRepository,
    private readonly play: PlayService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const child = this.session.requireCurrentProfile();
    const assignmentId = this.route.snapshot.paramMap.get('assignmentId');
    const exerciseId = this.route.snapshot.paramMap.get('exerciseId');
    if (assignmentId) {
      this.assignment = await this.assignments.getById(assignmentId);
      if (this.assignment) {
        this.exercise.set(this.assignment.exerciseSnapshot);
        this.triesLeft.set(await this.play.triesLeft(this.assignment));
      }
    } else if (exerciseId) {
      const exercise = await this.exercises.getById(exerciseId);
      if (exercise?.allowPractice && !exercise.deletedAt) this.exercise.set(exercise);
    }
    this.otherSession.set(await this.sessions.forChild(child.id));
  }

  async start(): Promise<void> {
    const exercise = this.exercise();
    if (!exercise || this.starting()) return;
    const child = this.session.requireCurrentProfile();
    this.starting.set(true);
    this.errorMessage.set('');
    try {
      if (this.otherSession()) {
        await this.play.abandon(child.id);
        this.otherSession.set(undefined);
      }
      if (this.assignment) {
        if ((await this.play.triesLeft(this.assignment)) === 0) {
          this.errorMessage.set('Bài này đã hết lượt làm.');
          return;
        }
        await this.play.startAssignment(child.id, this.assignment);
      } else {
        await this.play.startPractice(child.id, exercise);
      }
      await this.router.navigateByUrl('/exercise/question');
    } catch (error) {
      this.errorMessage.set(`Không bắt đầu được: ${String(error)}`);
    } finally {
      this.starting.set(false);
    }
  }

  async back(): Promise<void> {
    await this.router.navigateByUrl('/child-home');
  }
}
