import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { QuizItemRepository, QuizItemFilter } from '../../../data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { QuizExportService } from '../export/export.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { QuizItemFormComponent } from '../quiz-item-form/quiz-item-form.component';
import { Category, QuizItem, Subject } from '../../../shared/models/domain.model';
import { difficultyLabel } from '../../../shared/difficulty';

interface CategoryGroup {
  key: string;
  categoryId: string;
  categoryName: string;
  items: QuizItem[];
}

interface GradeGroup {
  key: string;
  grade: number;
  categories: CategoryGroup[];
}

interface SubjectGroup {
  key: string;
  subject: Subject;
  label: string;
  grades: GradeGroup[];
}

const SUBJECT_LABELS: Record<Subject, string> = { math: 'Toán', language: 'Tiếng Việt' };

/**
 * Quiz Bank management screen (FR-019, amended 2026-09-18 — redesigned from a
 * flat table into a Subject → Grade → Category → Quiz tree on the left, with
 * an embedded detail/edit panel (QuizItemFormComponent in embedded mode) on
 * the right. Saving in the panel (including a category change) refreshes the
 * tree so the item visually moves to its new spot.
 */
@Component({
  selector: 'app-quiz-bank-list',
  standalone: true,
  imports: [FormsModule, IconComponent, QuizItemFormComponent],
  templateUrl: './quiz-bank-list.component.html',
  styleUrl: './quiz-bank-list.component.scss',
})
export class QuizBankListComponent {
  readonly items = signal<QuizItem[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly filter = signal<QuizItemFilter>({});
  readonly collapsedKeys = signal<Set<string>>(new Set());
  readonly selectedItemId = signal<string | undefined>(undefined);
  readonly creatingNew = signal(false);
  readonly difficultyLabel = difficultyLabel;
  readonly grades = [1, 2, 3, 4, 5];

  /** Category tree node currently showing its bulk-grade-change inline form (by CategoryGroup.key), if any. */
  readonly bulkGradeEditKey = signal<string | undefined>(undefined);
  readonly bulkGradeValue = signal(1);
  /** Category tree node currently showing its bulk-delete confirmation, if any. */
  readonly bulkDeleteConfirmKey = signal<string | undefined>(undefined);

  readonly selectedItem = computed(() => this.items().find((i) => i.id === this.selectedItemId()));

  readonly tree = computed<SubjectGroup[]>(() => {
    const categoryNameById = new Map(this.categories().map((c) => [c.id, c.name]));
    const bySubject = new Map<Subject, Map<number, Map<string, QuizItem[]>>>();

    for (const item of this.items()) {
      if (!bySubject.has(item.subject)) bySubject.set(item.subject, new Map());
      const byGrade = bySubject.get(item.subject)!;
      if (!byGrade.has(item.grade)) byGrade.set(item.grade, new Map());
      const byCategory = byGrade.get(item.grade)!;
      if (!byCategory.has(item.categoryId)) byCategory.set(item.categoryId, []);
      byCategory.get(item.categoryId)!.push(item);
    }

    const subjects: SubjectGroup[] = [];
    for (const [subject, byGrade] of bySubject.entries()) {
      const grades: GradeGroup[] = [];
      for (const [grade, byCategory] of Array.from(byGrade.entries()).sort((a, b) => a[0] - b[0])) {
        const categories: CategoryGroup[] = Array.from(byCategory.entries())
          .map(([categoryId, catItems]) => ({
            key: `${subject}|${grade}|${categoryId}`,
            categoryId,
            categoryName: categoryNameById.get(categoryId) ?? '(Không rõ danh mục)',
            items: catItems,
          }))
          .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
        grades.push({ key: `${subject}|${grade}`, grade, categories });
      }
      subjects.push({ key: subject, subject, label: SUBJECT_LABELS[subject], grades });
    }
    return subjects.sort((a, b) => a.label.localeCompare(b.label));
  });

  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly exportService: QuizExportService,
    private readonly router: Router,
  ) {
    void this.reload();
  }

  async exportAll(): Promise<void> {
    const pkg = await this.exportService.exportItems(this.items().map((i) => i.id));
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async reload(): Promise<void> {
    const [items, categories] = await Promise.all([this.quizItems.search(this.filter()), this.categoryRepo.list()]);
    this.items.set(items);
    this.categories.set(categories);
  }

  setSubjectFilter(subject: string): void {
    this.filter.update((f) => ({ ...f, subject: (subject || undefined) as Subject | undefined }));
    void this.reload();
  }

  setSearchText(text: string): void {
    this.filter.update((f) => ({ ...f, searchText: text || undefined }));
    void this.reload();
  }

  isCollapsed(key: string): boolean {
    return this.collapsedKeys().has(key);
  }

  toggle(key: string): void {
    this.collapsedKeys.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  selectItem(item: QuizItem): void {
    if (item.passage) {
      void this.router.navigateByUrl(`/quiz-bank/passages/${item.passage.passageId}/edit`);
      return;
    }
    this.creatingNew.set(false);
    this.selectedItemId.set(item.id);
  }

  addNew(): void {
    this.creatingNew.set(true);
    this.selectedItemId.set(undefined);
  }

  addPassage(): void {
    void this.router.navigateByUrl('/quiz-bank/passages/new');
  }

  closeDetail(): void {
    this.creatingNew.set(false);
    this.selectedItemId.set(undefined);
  }

  async onSaved(item: QuizItem): Promise<void> {
    this.creatingNew.set(false);
    this.selectedItemId.set(item.id);
    await this.reload();
  }

  preview(item: QuizItem): void {
    void this.router.navigateByUrl(`/quiz-bank/${item.id}/preview`);
  }

  async duplicate(item: QuizItem): Promise<void> {
    // A duplicated passage sub-question becomes a standalone item rather than
    // silently claiming its sibling's shared passageId/order — editing a
    // whole passage's question set is done from the passage editor instead.
    const copy: QuizItem = { ...item, id: crypto.randomUUID(), localVersion: 1, lastGoogleVersion: 0, passage: undefined };
    await this.quizItems.create(copy);
    await this.reload();
    this.selectedItemId.set(copy.id);
  }

  async archive(item: QuizItem): Promise<void> {
    await this.quizItems.update(item.id, { status: 'archived' });
    await this.reload();
  }

  async remove(item: QuizItem): Promise<void> {
    await this.quizItems.softDelete(item.id);
    if (this.selectedItemId() === item.id) this.closeDetail();
    await this.reload();
  }

  startBulkGradeChange(group: CategoryGroup): void {
    this.bulkDeleteConfirmKey.set(undefined);
    this.bulkGradeValue.set(group.items[0]?.grade ?? 1);
    this.bulkGradeEditKey.set(group.key);
  }

  cancelBulkGradeChange(): void {
    this.bulkGradeEditKey.set(undefined);
  }

  async confirmBulkGradeChange(group: CategoryGroup): Promise<void> {
    const newGrade = this.bulkGradeValue();
    // A passage's sub-questions always share their category+grade (they're
    // inherited from the shared passage), so every sub-question of any
    // passage inside this node is already included here as a whole unit —
    // this can never split a passage across grades (FR-074).
    await Promise.all(group.items.map((item) => this.quizItems.update(item.id, { grade: newGrade })));
    this.bulkGradeEditKey.set(undefined);
    await this.reload();
  }

  startBulkDelete(group: CategoryGroup): void {
    this.bulkGradeEditKey.set(undefined);
    this.bulkDeleteConfirmKey.set(group.key);
  }

  cancelBulkDelete(): void {
    this.bulkDeleteConfirmKey.set(undefined);
  }

  async confirmBulkDelete(group: CategoryGroup): Promise<void> {
    const ids = new Set(group.items.map((i) => i.id));
    if (this.selectedItemId() && ids.has(this.selectedItemId()!)) this.closeDetail();
    await Promise.all(group.items.map((item) => this.quizItems.softDelete(item.id)));
    this.bulkDeleteConfirmKey.set(undefined);
    await this.reload();
  }
}
