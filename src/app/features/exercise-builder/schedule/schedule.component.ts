import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssignmentRepository } from '../../../data/repositories/assignment.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { Assignment, Exercise, Profile } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

/**
 * Assign an exercise to a child (or both) — plan §3.2: open right away or
 * from a date and time, with an optional deadline. The assignment keeps its
 * own copy of the exercise. Current assignments are listed per child and can
 * be taken back.
 */
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
  readonly current = signal<Assignment[]>([]);

  readonly selectedChildId = signal<string>('');
  readonly bothChildren = signal(false);
  readonly selectedExerciseId = signal<string>('');
  readonly opensLater = signal(false);
  /** datetime-local values (local time). */
  readonly availableFrom = signal('');
  readonly hasDeadline = signal(false);
  readonly deadline = signal('');
  readonly message = signal('');

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly exerciseRepo: ExerciseRepository,
    private readonly assignments: AssignmentRepository,
  ) {
    void this.load();
  }

  private async load(): Promise<void> {
    this.children.set(await this.profiles.findByRoleAndName('child'));
    this.exercises.set((await this.exerciseRepo.list()).filter((e) => e.status === 'active'));
    this.current.set(await this.assignments.listAll());
    // The <select>s show the first entry, but their signals only change on user input — seed them.
    if (!this.selectedChildId() && this.children().length > 0) this.selectedChildId.set(this.children()[0].id);
    if (!this.selectedExerciseId() && this.exercises().length > 0) this.selectedExerciseId.set(this.exercises()[0].id);
  }

  async assign(): Promise<void> {
    this.message.set('');
    const exercise = this.exercises().find((e) => e.id === this.selectedExerciseId());
    if (!exercise) return;
    const availableFrom = this.opensLater() && this.availableFrom() ? new Date(this.availableFrom()).toISOString() : undefined;
    const deadline = this.hasDeadline() && this.deadline() ? new Date(this.deadline()).toISOString() : undefined;
    if (this.opensLater() && !availableFrom) {
      this.message.set('Hãy chọn thời điểm mở bài.');
      return;
    }
    if (deadline && availableFrom && deadline <= availableFrom) {
      this.message.set('Hạn chót phải sau thời điểm mở bài.');
      return;
    }
    const targets = this.bothChildren() ? this.children().map((c) => c.id) : [this.selectedChildId()];
    for (const childId of targets.filter(Boolean)) {
      await this.assignments.assign(childId, exercise, { availableFrom, deadline });
    }
    this.message.set(`Đã giao "${exercise.title}".`);
    await this.load();
  }

  async takeBack(assignment: Assignment): Promise<void> {
    await this.assignments.remove(assignment);
    await this.load();
  }

  childName(childId: string): string {
    return this.children().find((c) => c.id === childId)?.displayName ?? childId;
  }

  formatDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  }
}
