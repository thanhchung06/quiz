import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WeakAreasService, WeakItem, WeakTag } from '../services/weak-areas.service';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { IconComponent } from '../../../shared/icon/icon.component';

/**
 * Learning Needs view (FR-048): lists weak items/tags and lets the parent
 * build a new practice exercise directly from a selection of them.
 */
@Component({
  selector: 'app-learning-needs',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './learning-needs.component.html',
  styleUrl: './learning-needs.component.scss',
})
export class LearningNeedsComponent implements OnInit {
  readonly weakItems = signal<WeakItem[]>([]);
  readonly weakTags = signal<WeakTag[]>([]);
  readonly selectedItemIds = signal<Set<string>>(new Set());
  private profileId = '';

  constructor(
    private readonly weakAreas: WeakAreasService,
    private readonly exercises: ExerciseRepository,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.profileId = this.route.snapshot.paramMap.get('profileId') ?? '';
    if (!this.profileId) return;
    this.weakItems.set(await this.weakAreas.weakItems(this.profileId));
    this.weakTags.set(await this.weakAreas.weakTags(this.profileId));
  }

  toggleSelect(itemId: string): void {
    this.selectedItemIds.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async buildPracticeExercise(): Promise<void> {
    const selected = Array.from(this.selectedItemIds());
    if (selected.length === 0) return;

    const exercise = await this.exercises.createExercise({
      title: 'Luyện tập điểm yếu',
      subject: 'mixed',
      grade: 1,
      items: selected.map((quizItemId, index) => ({ id: crypto.randomUUID(), position: index, kind: 'fixed', quizItemId })),
      timeLimitMinutes: 10,
      lives: 5,
      passingPercent: 70,
      orderMode: 'fixed',
      replayAllowed: true,
      correctionReviewEnabled: true,
      repeatSameQuestions: false,
      questionTimingMode: 'none',
      status: 'active',
    });

    await this.router.navigateByUrl(`/exercise-builder/${exercise.id}/edit`);
  }
}
