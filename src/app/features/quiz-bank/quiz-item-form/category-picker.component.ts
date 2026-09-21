import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategoryRepository, normalizeName } from '../../../data/repositories/category.repository';
import { Category, CategorySubject } from '../../../shared/models/domain.model';

/**
 * Inline category select-or-create for the quiz item form (FR-024): exact +
 * normalized-name duplicate detection, with a warning (not a silent
 * duplicate) on close matches.
 */
@Component({
  selector: 'app-category-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './category-picker.component.html',
  styleUrl: './category-picker.component.scss',
})
export class CategoryPickerComponent {
  @Input() subject: CategorySubject = 'math';
  @Input() selectedCategoryId?: string;
  @Output() readonly categoryIdChange = new EventEmitter<string>();

  readonly categories = signal<Category[]>([]);
  readonly newName = signal('');
  readonly similarWarning = signal<Category | undefined>(undefined);

  constructor(private readonly categoryRepo: CategoryRepository) {
    void this.load();
  }

  private async load(): Promise<void> {
    this.categories.set((await this.categoryRepo.list()).filter((c) => c.status === 'active'));
  }

  selectExisting(id: string): void {
    this.categoryIdChange.emit(id);
  }

  onNewNameChange(name: string): void {
    this.newName.set(name);
    const normalized = normalizeName(name);
    const similar = this.categories().find((c) => c.normalizedName === normalized);
    this.similarWarning.set(similar);
  }

  async confirmCreate(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    if (this.similarWarning()) {
      // A close match already exists — the parent must explicitly choose it
      // instead, rather than silently getting a duplicate (FR-024).
      return;
    }
    const created = await this.categoryRepo.createCategory(name, this.subject);
    this.newName.set('');
    await this.load();
    this.categoryIdChange.emit(created.id);
  }

  useSimilarInstead(): void {
    const similar = this.similarWarning();
    if (!similar) return;
    this.newName.set('');
    this.similarWarning.set(undefined);
    this.categoryIdChange.emit(similar.id);
  }
}
