import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ExerciseRepository } from '../../../data/repositories/exercise.repository';
import { IconComponent } from '../../../shared/icon/icon.component';
import { Exercise } from '../../../shared/models/domain.model';

/** Exercise Library (FR-034): list, duplicate/edit/preview/archive/delete unused exercises. */
@Component({
  selector: 'app-exercise-library',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './exercise-library.component.html',
  styleUrl: './exercise-library.component.scss',
})
export class ExerciseLibraryComponent {
  readonly exercises = signal<Exercise[]>([]);
  readonly message = signal('');

  constructor(
    private readonly exerciseRepo: ExerciseRepository,
    private readonly router: Router,
  ) {
    void this.load();
  }

  private async load(): Promise<void> {
    this.exercises.set(await this.exerciseRepo.list());
  }

  create(): void {
    void this.router.navigateByUrl('/exercise-builder/new');
  }

  edit(exercise: Exercise): void {
    void this.router.navigateByUrl(`/exercise-builder/${exercise.id}/edit`);
  }

  async duplicate(exercise: Exercise): Promise<void> {
    await this.exerciseRepo.duplicate(exercise.id);
    await this.load();
  }

  async archive(exercise: Exercise): Promise<void> {
    const ok = await this.exerciseRepo.archiveIfUnused(exercise.id);
    this.message.set(ok ? '' : 'Không thể lưu trữ: bài tập đang được làm dở bởi một lượt đang hoạt động.');
    await this.load();
  }

  async remove(exercise: Exercise): Promise<void> {
    if (await this.exerciseRepo.isInUseByActiveAttempt(exercise.id)) {
      this.message.set('Không thể xóa: bài tập đang được làm dở bởi một lượt đang hoạt động.');
      return;
    }
    await this.exerciseRepo.softDelete(exercise.id);
    await this.load();
  }
}
