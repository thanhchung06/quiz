import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CategoryCount, matchesFilter, QuizItemRepository, QuizItemFilter } from '../../../data/repositories/quiz-item.repository';
import { QuizBankSyncService } from '../../../remote/quiz-bank-sync.service';
import { CategoryRepository } from '../../../data/repositories/category.repository';
import { QuizExportFormat, QuizExportService } from '../export/export.service';
import { downloadFile, todayStamp } from '../../../shared/download/download-file';
import { IconComponent } from '../../../shared/icon/icon.component';
import { SUBJECT_LABELS } from '../../../shared/subjects';
import { QuizItemFormComponent } from '../quiz-item-form/quiz-item-form.component';
import { Category, QuizItem, Subject } from '../../../shared/models/domain.model';
import { difficultyLabel } from '../../../shared/difficulty';

interface CategoryGroup {
  key: string;
  subject: Subject;
  grade: number;
  categoryId: string;
  categoryName: string;
  /** How many questions the node holds (known without loading them). */
  count: number;
  /** The node's questions: loaded when it is opened, empty until then. */
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


/** How long opening a category waits for the server before showing this device's copy. */
const SYNC_WAIT_MS = 5000;

/** A node opened again within this long isn't re-checked against the server. */
const SYNC_RECHECK_MS = 30_000;

/** The tree's category-node key for a question (matches CategoryGroup.key). */
function categoryKeyOf(item: QuizItem): string {
  return `${item.subject}|${item.grade}|${item.categoryId}`;
}

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
  /** Question counts per subject/grade/category: all the tree needs until a category is opened. */
  readonly counts = signal<CategoryCount[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly filter = signal<QuizItemFilter>({});
  /** Questions of the nodes opened so far, by CategoryGroup.key — reopening a node doesn't read the database again. */
  private readonly nodeItems = signal<Map<string, QuizItem[]>>(new Map());
  /** Every question, read only while searching by text (the text can match any of them). */
  private readonly searchPool = signal<QuizItem[] | undefined>(undefined);
  private readonly isSearching = computed(() => !!this.filter().searchText && !!this.searchPool());
  /** Accordion: one subject, one of its grades and one of that grade's categories are open at a time. */
  readonly expandedSubjectKey = signal<string | undefined>(undefined);
  readonly expandedGradeKey = signal<string | undefined>(undefined);
  /** The one category node whose questions are listed (CategoryGroup.key). */
  readonly expandedCategoryKey = signal<string | undefined>(undefined);
  /** Category node whose questions are being refreshed from the server. */
  readonly loadingCategoryKey = signal<string | undefined>(undefined);
  private lastSyncCheckAt = 0;

  /** The filter's category choices: categories with questions for the chosen subject and grade. */
  readonly filterCategoryOptions = computed(() => {
    const { subject, grade } = this.filter();
    const totals = new Map<string, number>();
    for (const c of this.counts()) {
      if ((!subject || c.subject === subject) && (!grade || c.grade === grade)) totals.set(c.categoryId, (totals.get(c.categoryId) ?? 0) + c.count);
    }
    return this.categories()
      .filter((c) => totals.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, count: totals.get(c.id)! }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  });
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

  /** The question open in the detail panel (kept here, since its node may not be loaded). */
  readonly selectedItem = signal<QuizItem | undefined>(undefined);

  /** The nodes the filter leaves: from the counts, or — while searching by text — from the matching questions. */
  private readonly nodes = computed<Array<Omit<CategoryGroup, 'key' | 'categoryName'>>>(() => {
    const filter = this.filter();
    const pool = this.searchPool();
    if (filter.searchText && pool) {
      const groups = new Map<string, QuizItem[]>();
      for (const item of pool) {
        if (!matchesFilter(item, filter)) continue;
        const key = categoryKeyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(item);
      }
      return [...groups.values()].map((items) => ({
        subject: items[0].subject,
        grade: items[0].grade,
        categoryId: items[0].categoryId,
        count: items.length,
        items,
      }));
    }
    const loaded = this.nodeItems();
    return this.counts()
      .filter((c) => (!filter.subject || c.subject === filter.subject) && (!filter.grade || c.grade === filter.grade) && (!filter.categoryId || c.categoryId === filter.categoryId))
      .map((c) => ({ ...c, items: loaded.get(`${c.subject}|${c.grade}|${c.categoryId}`) ?? [] }));
  });

  readonly tree = computed<SubjectGroup[]>(() => {
    const categoryNameById = new Map(this.categories().map((c) => [c.id, c.name]));
    const bySubject = new Map<Subject, Map<number, CategoryGroup[]>>();

    for (const node of this.nodes()) {
      if (!bySubject.has(node.subject)) bySubject.set(node.subject, new Map());
      const byGrade = bySubject.get(node.subject)!;
      if (!byGrade.has(node.grade)) byGrade.set(node.grade, []);
      byGrade.get(node.grade)!.push({
        ...node,
        key: `${node.subject}|${node.grade}|${node.categoryId}`,
        categoryName: categoryNameById.get(node.categoryId) ?? '(Không rõ danh mục)',
      });
    }

    const subjects: SubjectGroup[] = [];
    for (const [subject, byGrade] of bySubject.entries()) {
      const grades: GradeGroup[] = Array.from(byGrade.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([grade, categories]) => ({
          key: `${subject}|${grade}`,
          grade,
          categories: categories.sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
        }));
      subjects.push({ key: subject, subject, label: SUBJECT_LABELS[subject], grades });
    }
    return subjects.sort((a, b) => a.label.localeCompare(b.label));
  });

  constructor(
    private readonly quizItems: QuizItemRepository,
    private readonly categoryRepo: CategoryRepository,
    private readonly exportService: QuizExportService,
    private readonly quizBank: QuizBankSyncService,
    private readonly router: Router,
    route: ActivatedRoute,
  ) {
    // Coming back from the preview page: reopen the question that was previewed.
    const itemId = route.snapshot.queryParamMap.get('item');
    if (itemId) {
      this.selectedItemId.set(itemId);
      void this.quizItems.getById(itemId).then(async (item) => {
        if (!item) return;
        this.selectedItem.set(item);
        this.expandPathTo(item);
        await this.reload();
      });
    } else {
      void this.reload();
    }
  }

  /** Opens the subject, grade and category nodes holding `item`. */
  private expandPathTo(item: QuizItem): void {
    this.expandedSubjectKey.set(item.subject);
    this.expandedGradeKey.set(`${item.subject}|${item.grade}`);
    this.expandedCategoryKey.set(categoryKeyOf(item));
  }

  /** The questions of a node: from what was loaded already, else read once and kept. */
  private async itemsOf(group: CategoryGroup): Promise<QuizItem[]> {
    if (this.isSearching()) return group.items;
    const cached = this.nodeItems().get(group.key);
    if (cached) return cached;
    const items = await this.quizItems.byNode(group.subject, group.grade, group.categoryId);
    this.nodeItems.update((m) => new Map(m).set(group.key, items));
    return items;
  }

  /** Every question under a subject or grade node (all its categories, respecting the filter). */
  private async itemsUnder(subject: Subject, grade: number | undefined, groups: CategoryGroup[]): Promise<QuizItem[]> {
    if (this.isSearching()) return groups.flatMap((c) => c.items);
    const categoryIds = new Set(groups.map((c) => c.categoryId));
    return (await this.quizItems.bySubjectGrade(subject, grade)).filter((i) => categoryIds.has(i.categoryId));
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
    const items = await this.itemsUnder(group.subject, undefined, group.grades.flatMap((g) => g.categories));
    await this.exportQuizzes(items, `cau-hoi-${fileSlug(group.label)}`);
  }

  /** Exports one grade node of the tree (every category under it). */
  async exportGradeNode(subject: SubjectGroup, group: GradeGroup): Promise<void> {
    const items = await this.itemsUnder(subject.subject, group.grade, group.categories);
    await this.exportQuizzes(items, `cau-hoi-${fileSlug(subject.label)}-lop${group.grade}`);
  }

  /** Exports one category node of the tree. */
  async exportCategory(group: CategoryGroup): Promise<void> {
    await this.exportQuizzes(await this.itemsOf(group), `cau-hoi-${fileSlug(group.categoryName)}-lop${group.grade}`);
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

  /** Re-reads the counts and categories, drops the cached nodes, and re-reads the open one. */
  async reload(): Promise<void> {
    const openKey = this.expandedCategoryKey();
    const loadOpenNode = async (): Promise<Map<string, QuizItem[]>> => {
      if (!openKey) return new Map();
      const [subject, grade, categoryId] = openKey.split('|');
      return new Map([[openKey, await this.quizItems.byNode(subject as Subject, +grade, categoryId)]]);
    };
    const [counts, categories, nodeItems, pool] = await Promise.all([
      this.quizItems.categoryCounts(),
      this.categoryRepo.list(),
      loadOpenNode(),
      this.filter().searchText ? this.quizItems.list() : Promise.resolve(undefined),
    ]);
    this.counts.set(counts);
    this.categories.set(categories);
    this.nodeItems.set(nodeItems);
    this.searchPool.set(pool);
  }

  setSubjectFilter(subject: string): void {
    this.filter.update((f) => ({ ...f, subject: (subject || undefined) as Subject | undefined }));
    this.dropUnavailableFilterCategory();
  }

  setGradeFilter(grade: string): void {
    this.filter.update((f) => ({ ...f, grade: grade ? +grade : undefined }));
    this.dropUnavailableFilterCategory();
  }

  /** Showing one category opens its (first) node straight away. */
  setCategoryFilter(categoryId: string): void {
    this.filter.update((f) => ({ ...f, categoryId: categoryId || undefined }));
    const first = this.tree()[0]?.grades[0]?.categories[0];
    if (categoryId && first) void this.toggleCategory(first, true);
  }

  private dropUnavailableFilterCategory(): void {
    const id = this.filter().categoryId;
    if (id && !this.filterCategoryOptions().some((c) => c.id === id)) this.filter.update((f) => ({ ...f, categoryId: undefined }));
  }

  setSearchText(text: string): void {
    this.filter.update((f) => ({ ...f, searchText: text || undefined }));
    if (!text) this.searchPool.set(undefined);
    else if (!this.searchPool()) void this.quizItems.list().then((pool) => {
        if (this.filter().searchText) this.searchPool.set(pool);
      });
  }

  /**
   * Opens one category (closing whichever was open, and opening its grade and subject),
   * showing this device's copy at once. The server is checked behind it, so the list
   * picks up other devices' latest changes without making the click wait.
   */
  async toggleCategory(group: CategoryGroup, open = false): Promise<void> {
    if (!open && this.expandedCategoryKey() === group.key) {
      this.expandedCategoryKey.set(undefined);
      return;
    }
    this.expandedSubjectKey.set(group.subject);
    this.expandedGradeKey.set(`${group.subject}|${group.grade}`);
    this.expandedCategoryKey.set(group.key);
    await this.itemsOf(group);
    if (Date.now() - this.lastSyncCheckAt < SYNC_RECHECK_MS) return;

    this.loadingCategoryKey.set(group.key);
    try {
      // Offline, or a slow connection: keep this device's copy rather than waiting.
      const pulled = await Promise.race([this.refreshFromServer(), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SYNC_WAIT_MS))]);
      this.lastSyncCheckAt = Date.now();
      if (pulled) await this.reload();
    } catch {
      // Same: the copy on this device is shown.
    } finally {
      if (this.loadingCategoryKey() === group.key) this.loadingCategoryKey.set(undefined);
    }
  }

  private pendingSync?: Promise<boolean>;

  /** One server check at a time, shared by quick successive clicks. */
  private refreshFromServer(): Promise<boolean> {
    this.pendingSync ??= this.quizBank.sync().finally(() => (this.pendingSync = undefined));
    return this.pendingSync;
  }

  /** Subject nodes (key "math") and grade nodes (key "math|3"): opening one closes the others at its level, and everything below. */
  isCollapsed(key: string): boolean {
    return (key.includes('|') ? this.expandedGradeKey() : this.expandedSubjectKey()) !== key;
  }

  toggle(key: string): void {
    const open = !this.isCollapsed(key);
    if (key.includes('|')) {
      this.expandedGradeKey.set(open ? undefined : key);
    } else {
      this.expandedSubjectKey.set(open ? undefined : key);
      this.expandedGradeKey.set(undefined);
    }
    this.expandedCategoryKey.set(undefined);
  }

  selectItem(item: QuizItem): void {
    if (item.passage) {
      void this.router.navigateByUrl(`/quiz-bank/passages/${item.passage.passageId}/edit`);
      return;
    }
    this.creatingNew.set(false);
    this.cloneSource.set(undefined);
    this.selectedItemId.set(item.id);
    this.selectedItem.set(item);
  }

  addNew(): void {
    this.creatingNew.set(true);
    this.cloneSource.set(undefined);
    this.selectedItemId.set(undefined);
    this.selectedItem.set(undefined);
  }

  addPassage(): void {
    void this.router.navigateByUrl('/quiz-bank/passages/new');
  }

  closeDetail(): void {
    this.creatingNew.set(false);
    this.cloneSource.set(undefined);
    this.selectedItemId.set(undefined);
    this.selectedItem.set(undefined);
  }

  async onSaved(item: QuizItem): Promise<void> {
    this.creatingNew.set(false);
    this.cloneSource.set(undefined);
    // A new passage group is edited as a whole in the passage editor, never item by item here.
    this.selectedItemId.set(item.passage ? undefined : item.id);
    this.selectedItem.set(item.passage ? undefined : item);
    // Follow the question to its (possibly new) category.
    this.expandPathTo(item);
    await this.reload();
  }

  /** "Lưu và đóng": the form saved, now close the panel. */
  async onSavedAndClosed(item: QuizItem): Promise<void> {
    await this.onSaved(item);
    this.closeDetail();
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
    this.selectedItem.set(undefined);
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
    this.bulkGradeValue.set(group.grade);
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
    const items = await this.itemsOf(group);
    await this.quizItems.updateMany(items.map((item) => ({ id: item.id, patch: { grade: newGrade } })));
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
    const items = await this.itemsOf(group);
    const ids = new Set(items.map((i) => i.id));
    if (this.selectedItemId() && ids.has(this.selectedItemId()!)) this.closeDetail();
    const deletedAt = new Date().toISOString();
    await this.quizItems.updateMany(items.map((item) => ({ id: item.id, patch: { deletedAt } })));
    this.bulkDeleteConfirmKey.set(undefined);
    await this.reload();
  }
}
