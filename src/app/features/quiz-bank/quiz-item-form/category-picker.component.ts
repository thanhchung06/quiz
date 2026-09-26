import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CategoryRepository, normalizeName } from '../../../data/repositories/category.repository';
import { Category, CategorySubject } from '../../../shared/models/domain.model';
import { CATEGORY_SUGGESTIONS } from '../import/category-suggestions';

/**
 * Inline category select-or-create for the quiz item form (FR-024): exact +
 * normalized-name duplicate detection, with a warning (not a silent
 * duplicate) on close matches.
 *
 * Only the chosen subject's categories are listed; those the curriculum
 * suggestions (CATEGORY_SUGGESTIONS) mark as usual for the chosen grade come
 * first, the rest follow under "Danh mục khác".
 */
@Component({
  selector: 'app-category-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './category-picker.component.html',
  styleUrl: './category-picker.component.scss',
})
export class CategoryPickerComponent {
  private readonly subjectSignal = signal<CategorySubject>('math');
  private readonly gradeSignal = signal<number | undefined>(undefined);

  @Input() set subject(value: CategorySubject) {
    this.subjectSignal.set(value);
  }
  get subject(): CategorySubject {
    return this.subjectSignal();
  }
  @Input() set grade(value: number | undefined) {
    this.gradeSignal.set(value);
  }
  @Input() selectedCategoryId?: string;
  @Output() readonly categoryIdChange = new EventEmitter<string>();

  readonly categories = signal<Category[]>([]);
  readonly newName = signal('');
  readonly similarWarning = signal<Category | undefined>(undefined);

  /** Categories of the chosen subject, split into "suggested for this grade" and the rest. */
  readonly groups = computed(() => {
    const subject = this.subjectSignal();
    const grade = this.gradeSignal();
    const forGrade = new Set(
      CATEGORY_SUGGESTIONS.filter((s) => s.subject === subject && (grade === undefined || s.grades.includes(grade))).map((s) =>
        normalizeName(s.name),
      ),
    );
    const visible = this.categories()
      .filter((c) => c.subject === subject || c.subject === 'both' || c.id === this.selectedCategoryId)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return {
      suggested: visible.filter((c) => forGrade.has(c.normalizedName)),
      others: visible.filter((c) => !forGrade.has(c.normalizedName)),
    };
  });

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
