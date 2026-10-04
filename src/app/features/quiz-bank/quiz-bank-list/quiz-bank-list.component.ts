import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { QuizItemRepository, QuizItemFilter } from '../../../data/repositories/quiz-item.repository';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { QuizExportFormat, QuizExportService } from '../export/export.service';
import { downloadFile, todayStamp } from '../../../shared/download/download-file';
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

/** "Phép cộng" → "phep-cong", for export file names. */
function fileSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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
  /** While creating: the question being copied ("Nhân bản"), shown prefilled until saved. */
  readonly cloneSource = signal<QuizItem | undefined>(undefined);
  readonly difficultyLabel = difficultyLabel;
  readonly grades = [1, 2, 3, 4, 5];
  /** File format used by every export button on this screen — Excel by default, since it's the one a parent can edit by hand. */
  readonly exportFormat = signal<QuizExportFormat>('xlsx');
  readonly isExporting = signal(false);

  /**
   * "Xuất câu hỏi" panel (amended 2026-09-26): export by any mix of subject,
   * grade and category across the whole bank — independent of the tree's
   * search/subject filter, so e.g. one category over every grade is possible.
   */
  readonly exportPanelOpen = signal(false);
  readonly exportSource = signal<QuizItem[]>([]);
  readonly exportSubject = signal<Subject | ''>('');
  readonly exportGrade = signal<number | ''>('');
  readonly exportCategoryId = signal('');

  /** Items matching the panel's subject + grade, before the category choice. */
  private readonly exportScoped = computed(() => {
    const subject = this.exportSubject();
    const grade = this.exportGrade();
    return this.exportSource().filter((i) => (!subject || i.subject === subject) && (!grade || i.grade === grade));
  });

  /** Categories that have at least one question for the chosen subject/grade, with their counts. */
  readonly exportCategoryOptions = computed(() => {
    const counts = new Map<string, number>();
    for (const i of this.exportScoped()) counts.set(i.categoryId, (counts.get(i.categoryId) ?? 0) + 1);
    return this.categories()
      .filter((c) => counts.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id)! }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  });

  readonly exportMatches = computed(() => {
    const categoryId = this.exportCategoryId();
    return this.exportScoped().filter((i) => !categoryId || i.categoryId === categoryId);
  });

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
    route: ActivatedRoute,
  ) {
    // Coming back from the preview page: reopen the question that was previewed.
    const itemId = route.snapshot.queryParamMap.get('item');
    if (itemId) this.selectedItemId.set(itemId);
    void this.reload();
  }

  async openExportPanel(): Promise<void> {
    this.exportSubject.set(this.filter().subject ?? '');
    this.exportGrade.set('');
    this.exportCategoryId.set('');
    this.exportSource.set(await this.quizItems.search({}));
    this.exportPanelOpen.set(true);
  }

  setExportSubject(value: string): void {
    this.exportSubject.set(value as Subject | '');
    this.dropUnavailableExportCategory();
  }

  setExportGrade(value: string): void {
    this.exportGrade.set(value ? +value : '');
    this.dropUnavailableExportCategory();
  }

  private dropUnavailableExportCategory(): void {
    const id = this.exportCategoryId();
    if (id && !this.exportCategoryOptions().some((c) => c.id === id)) this.exportCategoryId.set('');
  }

  /** Exports whatever the panel's subject/grade/category currently match, named after the choices. */
  async exportSelection(): Promise<void> {
    const subject = this.exportSubject();
    const grade = this.exportGrade();
    const category = this.categories().find((c) => c.id === this.exportCategoryId());
    const parts = ['cau-hoi'];
    if (subject) parts.push(fileSlug(SUBJECT_LABELS[subject]));
    if (grade) parts.push(`lop${grade}`);
    if (category) parts.push(fileSlug(category.name));
    await this.exportQuizzes(this.exportMatches(), parts.join('-'));
  }

  /** Exports one subject node of the tree (every grade and category under it). */
  async exportSubjectNode(group: SubjectGroup): Promise<void> {
    await this.exportQuizzes(
      group.grades.flatMap((g) => g.categories.flatMap((c) => c.items)),
      `cau-hoi-${fileSlug(group.label)}`,
    );
  }

  /** Exports one grade node of the tree (every category under it). */
  async exportGradeNode(subject: SubjectGroup, group: GradeGroup): Promise<void> {
    await this.exportQuizzes(
      group.categories.flatMap((c) => c.items),
      `cau-hoi-${fileSlug(subject.label)}-lop${group.grade}`,
    );
  }

  /** Exports one category node of the tree. */
  async exportCategory(group: CategoryGroup): Promise<void> {
    await this.exportQuizzes(group.items, `cau-hoi-${fileSlug(group.categoryName)}-lop${group.items[0]?.grade ?? ''}`);
  }

  private async exportQuizzes(items: QuizItem[], baseName: string): Promise<void> {
    if (!items.length || this.isExporting()) return;
    this.isExporting.set(true);
    try {
      const file = await this.exportService.exportFile(
        items.map((i) => i.id),
        this.exportFormat(),
      );
      downloadFile(file.data, `${baseName}-${todayStamp()}.${file.extension}`, file.mimeType);
    } finally {
      this.isExporting.set(false);
    }
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
    this.cloneSource.set(undefined);
    this.selectedItemId.set(item.id);
  }

  addNew(): void {
    this.creatingNew.set(true);
    this.cloneSource.set(undefined);
    this.selectedItemId.set(undefined);
  }

  addPassage(): void {
    void this.router.navigateByUrl('/quiz-bank/passages/new');
  }

  closeDetail(): void {
    this.creatingNew.set(false);
    this.cloneSource.set(undefined);
    this.selectedItemId.set(undefined);
  }

  async onSaved(item: QuizItem): Promise<void> {
    this.creatingNew.set(false);
    this.cloneSource.set(undefined);
    // A new passage group is edited as a whole in the passage editor, never item by item here.
    this.selectedItemId.set(item.passage ? undefined : item.id);
    await this.reload();
  }

  preview(item: QuizItem): void {
    void this.router.navigateByUrl(`/quiz-bank/${item.id}/preview`);
  }

  /**
   * Opens a prefilled copy of the question as a new, unsaved one, so the parent
   * sees it's a copy and can change it before saving. A passage sub-question's
   * copy is a standalone question — a passage is copied as a whole elsewhere.
   */
  duplicate(item: QuizItem): void {
    this.selectedItemId.set(undefined);
    this.cloneSource.set(item);
    this.creatingNew.set(true);
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
    await this.quizItems.updateMany(group.items.map((item) => ({ id: item.id, patch: { grade: newGrade } })));
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
    const deletedAt = new Date().toISOString();
    await this.quizItems.updateMany(group.items.map((item) => ({ id: item.id, patch: { deletedAt } })));
    this.bulkDeleteConfirmKey.set(undefined);
    await this.reload();
  }
}
