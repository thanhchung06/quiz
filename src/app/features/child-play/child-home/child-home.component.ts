import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../../core/auth/session.service';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { PlaySessionRepository } from '../../../data/repositories/play-session.repository';
import { ResultRepository } from '../../../data/repositories/result.repository';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { PlayService } from '../services/play.service';
import { Assignment, Exercise, HistoryResult, PlaySession } from '../../../shared/models/domain.model';
import { vi } from '../../../shared/i18n/vi';
import { IconComponent } from '../../../shared/icon/icon.component';

interface AssignmentCard {
  assignment: Assignment;
  exercise: Exercise;
  /** Not open yet (availableFrom in the future). */
  opensAt?: string;
  triesLeft: number | 'unlimited';
}

const END_ICON: Partial<Record<string, string>> = { completed: 'check_circle', timeUp: 'timer', tryAgain: 'cancel', abandoned: 'close' };

/**
 * The child's home: the exercise left unfinished (if any), assigned exercises
 * (open now, or opening later), exercises open for practice, total points
 * and stars, and the last 7 days.
 */
@Component({
  selector: 'app-child-home',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './child-home.component.html',
  styleUrl: './child-home.component.scss',
})
export class ChildHomeComponent implements OnInit {
  readonly strings = vi;
  readonly endIcon = END_ICON;
  readonly childName = signal('');
  readonly ongoing = signal<PlaySession | undefined>(undefined);
  readonly cards = signal<AssignmentCard[]>([]);
  readonly practice = signal<Exercise[]>([]);
  readonly totalPoints = signal(0);
  readonly totalStars = signal(0);
  readonly last7Days = signal<HistoryResult[]>([]);
  readonly availableResultIds = signal<Set<string>>(new Set());

  constructor(
    private readonly session: SessionService,
    private readonly profiles: ProfileRepository,
    private readonly exercises: ExerciseRepository,
    private readonly assignments: AssignmentRepository,
    private readonly sessions: PlaySessionRepository,
    private readonly results: ResultRepository,
    private readonly play: PlayService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const child = this.session.requireCurrentProfile();
    this.childName.set(child.displayName);
    this.ongoing.set(await this.sessions.forChild(child.id));

    const now = Date.now();
    const cards: AssignmentCard[] = [];
    for (const assignment of await this.assignments.listForChild(child.id)) {
      const triesLeft = await this.play.triesLeft(assignment);
      if (triesLeft === 0 && !assignment.exerciseSnapshot.isDaily) continue;
      cards.push({
        assignment,
        exercise: assignment.exerciseSnapshot,
        opensAt: this.play.isAvailable(assignment, now) ? undefined : assignment.availableFrom,
        triesLeft,
      });
    }
    this.cards.set(cards);
    this.practice.set((await this.exercises.list()).filter((e) => e.allowPractice && e.status === 'active'));

    const profile = await this.profiles.getById(child.id);
    this.totalPoints.set(profile?.totalPoints ?? 0);
    const history = await this.results.historyForChild(child.id);
    this.totalStars.set(history.reduce((sum, h) => sum + h.stars, 0));
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.last7Days.set(history.filter((h) => h.attemptedAt >= weekAgo));
    const stored = await this.results.resultsForChild(child.id);
    this.availableResultIds.set(new Set(stored.map((r) => r.id)));
  }

  formatDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async continueOngoing(): Promise<void> {
    if (await this.play.resume(this.session.requireCurrentProfile().id)) await this.router.navigateByUrl('/exercise/question');
  }

  async open(card: AssignmentCard): Promise<void> {
    if (card.opensAt || card.triesLeft === 0) return;
    await this.router.navigateByUrl(`/exercise-intro/${card.assignment.id}`);
  }

  async openPractice(exercise: Exercise): Promise<void> {
    await this.router.navigateByUrl(`/practice/${exercise.id}`);
  }

  async viewResult(history: HistoryResult): Promise<void> {
    const result = await this.results.getById(history.id);
    if (!result) return;
    this.play.viewResult(result);
    await this.router.navigateByUrl('/exercise/result');
  }

  async logout(): Promise<void> {
    this.session.logout();
    await this.router.navigateByUrl('/profiles');
  }
}
