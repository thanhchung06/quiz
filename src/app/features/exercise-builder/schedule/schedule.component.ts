import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { Assignment, Exercise, Profile } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';
import { AutoSyncService } from '../../../sync-engine/auto-sync.service';

/** Schedule screen (FR-033): assign an exercise to a child (or both) for a date. */
@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss',
})
export class ScheduleComponent {
  readonly children = signal<Profile[]>([]);
  readonly exercises = signal<Exercise[]>([]);
  readonly upcoming = signal<Assignment[]>([]);

  readonly selectedChildId = signal<string>('');
  readonly bothChildren = signal(false);
  readonly selectedExerciseId = signal<string>('');
  readonly assignedDate = signal(new Date().toISOString().slice(0, 10));
  /** 'dated' assigns for the chosen date (existing flow); 'onetime' assigns with no day attached at all. */
  readonly assignMode = signal<'dated' | 'onetime'>('dated');

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly exerciseRepo: ExerciseRepository,
    private readonly assignments: AssignmentRepository,
    private readonly autoSync: AutoSyncService,
  ) {
    void this.load();
  }

  private async load(): Promise<void> {
    this.children.set(await this.profiles.findByRoleAndName('child'));
    this.exercises.set((await this.exerciseRepo.list()).filter((e) => e.status === 'active'));
    this.upcoming.set(await this.assignments.list());

    // The <select>s default to whatever is first in each list, but the signals
    // they're bound to start empty and only update on a user-driven
    // ngModelChange — without seeding them here, clicking "Giao bài" before
    // ever touching either dropdown silently assigns nothing (assign() bails
    // out on an empty id) even though a child and exercise already *look*
    // selected on screen.
    if (!this.selectedChildId() && this.children().length > 0) this.selectedChildId.set(this.children()[0].id);
    if (!this.selectedExerciseId() && this.exercises().length > 0) this.selectedExerciseId.set(this.exercises()[0].id);
  }

  async assign(): Promise<void> {
    if (!this.selectedExerciseId()) return;
    if (this.assignMode() === 'dated' && !this.assignedDate()) return;
    const targets = this.bothChildren() ? this.children().map((c) => c.id) : [this.selectedChildId()];
    for (const profileId of targets) {
      if (!profileId) continue;
      if (this.assignMode() === 'onetime') {
        await this.assignments.assignOnetime(profileId, this.selectedExerciseId());
      } else {
        await this.assignments.setPrimaryAssignment(profileId, this.selectedExerciseId(), this.assignedDate());
      }
    }
    this.autoSync.request('assigned');
    await this.load();
  }

  childName(profileId: string): string {
    return this.children().find((c) => c.id === profileId)?.displayName ?? profileId;
  }

  exerciseTitle(exerciseId: string): string {
    return this.exercises().find((e) => e.id === exerciseId)?.title ?? exerciseId;
  }
}
