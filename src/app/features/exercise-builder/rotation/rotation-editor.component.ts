import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RotationRepository } from '../../../data/repositories/rotation.repository';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { ProfileRepository } from '../../../data/repositories/profile.repository';
import { Exercise, Profile } from '../../../shared/models/domain.model';
import { IconComponent } from '../../../shared/icon/icon.component';

/** Rotation editor (FR-069): parent-managed enabled exercise rotation per child. */
@Component({
  selector: 'app-rotation-editor',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './rotation-editor.component.html',
  styleUrl: './rotation-editor.component.scss',
})
export class RotationEditorComponent {
  readonly children = signal<Profile[]>([]);
  readonly exercises = signal<Exercise[]>([]);
  readonly selectedChildId = signal('');
  readonly orderedExerciseIds = signal<string[]>([]);

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly exerciseRepo: ExerciseRepository,
    private readonly rotations: RotationRepository,
  ) {
    void this.init();
  }

  private async init(): Promise<void> {
    this.children.set(await this.profiles.findByRoleAndName('child'));
    this.exercises.set((await this.exerciseRepo.list()).filter((e) => e.status === 'active'));
    if (this.children().length > 0) {
      await this.selectChild(this.children()[0].id);
    }
  }

  async selectChild(profileId: string): Promise<void> {
    this.selectedChildId.set(profileId);
    const rotation = await this.rotations.ensureForProfile(profileId);
    this.orderedExerciseIds.set(rotation.orderedExerciseIds);
  }

  async toggle(exerciseId: string): Promise<void> {
    const current = this.orderedExerciseIds();
    const next = current.includes(exerciseId) ? current.filter((id) => id !== exerciseId) : [...current, exerciseId];
    this.orderedExerciseIds.set(next);
    await this.rotations.setOrderedExercises(this.selectedChildId(), next);
  }

  exerciseTitle(id: string): string {
    return this.exercises().find((e) => e.id === id)?.title ?? id;
  }
}
