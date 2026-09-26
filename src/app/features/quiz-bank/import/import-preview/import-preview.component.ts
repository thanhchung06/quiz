import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ImportPreviewService, ImportPreview } from '../services/import-preview.service';
import { ImportCommitService } from '../services/import-commit.service';
import { QuizPackage } from '../quiz-package.model';
import { QUIZ_PACKAGE_TEMPLATE } from '../quiz-package-template';
import { CATEGORY_SUGGESTIONS } from '../category-suggestions';
import { IconComponent } from '../../../../shared/icon/icon.component';
import { downloadFile } from '../../../../shared/download/download-file';
import { ExcelSourceRef, XLSX_MIME, quizPackageToXlsx, xlsxToQuizPackage } from '../../excel/quiz-excel';

/** What to do with file items that look like quizzes already in the bank. */
export type DuplicateMode = 'skip' | 'replace';

/**
 * Import Preview screen (FR-027): a grade/type breakdown of what's in the
 * file (not a per-item list), skip/replace duplicates, cancel, or download
 * the error report. Imports always save as already approved — no review
 * queue step (amended 2026-09-18). Reading the file and committing the
 * import both show a loading state; a successful commit shows a summary
 * popup whose Close action resets the whole screen back to its empty
 * starting state, including the file input, ready for another import
 * (amended 2026-09-18).
 *
 * The file may be the JSON package or the human-editable Excel workbook
 * (excel/quiz-excel.ts), which is converted to the same package first; its
 * row-level problems and per-item row numbers are shown so the parent can
 * fix the sheet. "Replace" for duplicates overwrites the matching existing
 * item — the round trip for editing an exported sheet and importing it back.
 */
@Component({
  selector: 'app-import-preview',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './import-preview.component.html',
  styleUrl: './import-preview.component.scss',
})
export class ImportPreviewComponent {
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

  readonly rawPackage = signal<QuizPackage | undefined>(undefined);
  readonly preview = signal<ImportPreview | undefined>(undefined);
  readonly skipIndexes = signal<Set<number>>(new Set());
  readonly skipPassageIndexes = signal<Set<number>>(new Set());
  readonly resultMessage = signal('');
  /** Set when the chosen file couldn't be read at all (not JSON / not a valid .xlsx). */
  readonly fileError = signal('');
  /** Row-numbered issues found while reading an Excel file (rows left out, values ignored…). */
  readonly excelProblems = signal<string[]>([]);
  /** Excel only: sheet/row each `pkg.quizzes[i]` came from. */
  readonly quizSources = signal<ExcelSourceRef[] | undefined>(undefined);
  readonly duplicateMode = signal<DuplicateMode>('skip');
  readonly invalidExpanded = signal(false);
  readonly lastImportBatchId = signal<string | undefined>(undefined);
  readonly undoMessage = signal('');

  readonly isReadingFile = signal(false);
  readonly isImporting = signal(false);
  readonly showResultPopup = signal(false);
  readonly importedCount = signal(0);
  /** The passage list starts collapsed (every passage still defaults to selected/included) — only expanded on request. */
  readonly passagesExpanded = signal(false);

  constructor(
    private readonly previewService: ImportPreviewService,
    private readonly commitService: ImportCommitService,
    private readonly router: Router,
  ) {}

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isReadingFile.set(true);
    this.fileError.set('');
    this.excelProblems.set([]);
    this.quizSources.set(undefined);
    this.rawPackage.set(undefined);
    this.preview.set(undefined);
    try {
      let pkg: QuizPackage;
      if (/\.xlsx$/i.test(file.name) || file.type === XLSX_MIME) {
        const parsed = await xlsxToQuizPackage(await file.arrayBuffer(), file.name.replace(/\.xlsx$/i, ''));
        pkg = parsed.pkg;
        this.excelProblems.set(parsed.problems);
        this.quizSources.set(parsed.quizSources);
      } else {
        pkg = JSON.parse(await file.text()) as QuizPackage;
      }
      this.rawPackage.set(pkg);
      this.preview.set(await this.previewService.buildPreview(pkg));
      this.skipIndexes.set(new Set());
      this.skipPassageIndexes.set(new Set());
      this.passagesExpanded.set(false);
      this.invalidExpanded.set(false);
    } catch {
      this.fileError.set('Không đọc được tệp. Hãy chọn tệp gói câu hỏi .json hoặc tệp Excel .xlsx (ví dụ tệp mẫu hoặc tệp đã xuất).');
    } finally {
      this.isReadingFile.set(false);
    }
  }

  downloadTemplate(): void {
    const template = { ...QUIZ_PACKAGE_TEMPLATE, suggestedCategories: CATEGORY_SUGGESTIONS };
    downloadFile(JSON.stringify(template, null, 2), 'mau-goi-cau-hoi.json', 'application/json');
  }

  async downloadExcelTemplate(): Promise<void> {
    const data = await quizPackageToXlsx(QUIZ_PACKAGE_TEMPLATE, { categorySuggestions: CATEGORY_SUGGESTIONS });
    downloadFile(data, 'mau-goi-cau-hoi.xlsx', XLSX_MIME);
  }

  /** "Dòng 12" for an Excel row, "Mục #3" for a JSON array entry. */
  itemLabel(index: number): string {
    const source = this.quizSources()?.[index];
    return source ? `Trang "${source.sheet}" dòng ${source.row}` : `Mục #${index}`;
  }

  /** Standalone questions plus every question of a valid passage — matches "Tổng", which counts both. */
  validCount(preview: ImportPreview): number {
    return preview.validIndexes.length + preview.passages.filter((p) => p.valid).reduce((sum, p) => sum + p.questionCount, 0);
  }

  invalidCount(preview: ImportPreview): number {
    return preview.invalidItems.length + preview.passages.filter((p) => !p.valid).reduce((sum, p) => sum + p.questionCount, 0);
  }

  passageTitle(preview: ImportPreview, index: number): string {
    return preview.passages.find((p) => p.index === index)?.title ?? `#${index}`;
  }

  toggleInvalidExpanded(): void {
    this.invalidExpanded.update((v) => !v);
  }

  toggleSkip(index: number): void {
    this.skipIndexes.update((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  togglePassageSkip(index: number): void {
    this.skipPassageIndexes.update((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  togglePassagesExpanded(): void {
    this.passagesExpanded.update((v) => !v);
  }

  downloadErrors(): void {
    const preview = this.preview();
    if (!preview) return;
    const report = this.previewService.downloadErrorReport(preview, {
      itemLabel: (index) => this.itemLabel(index),
      fileProblems: this.excelProblems(),
    });
    downloadFile(report, 'import-errors.json', 'application/json');
  }

  async importQuizzes(): Promise<void> {
    const pkg = this.rawPackage();
    const preview = this.preview();
    if (!pkg || !preview || this.isImporting()) return;

    this.isImporting.set(true);
    try {
      const replacing = this.duplicateMode() === 'replace';
      const duplicateIndexes = new Set(preview.likelyDuplicates.map((d) => d.index));
      const finalSkip = new Set([...this.skipIndexes(), ...(replacing ? [] : duplicateIndexes)]);
      const replaceIndexes = replacing
        ? new Map(preview.likelyDuplicates.map((d) => [d.index, d.matchesExistingId]))
        : undefined;
      const duplicatePassageIndexes = preview.passageDuplicates.map((d) => d.index);
      const skipPassages = new Set([...this.skipPassageIndexes(), ...(replacing ? [] : duplicatePassageIndexes)]);
      const replacePassages = replacing
        ? new Map(preview.passageDuplicates.map((d) => [d.index, d.passageId]))
        : undefined;

      const result = await this.commitService.commit(pkg, preview.validIndexes, {
        skipIndexes: finalSkip,
        replaceIndexes,
        categoryMapping: new Map(),
        skipPassageIndexes: skipPassages,
        replacePassages,
        passageCategoryMapping: new Map(),
      });
      this.importedCount.set(result.savedIds.length);
      this.resultMessage.set(
        result.updatedIds.length
          ? `Đã nhập ${result.savedIds.length} câu hỏi mới, cập nhật ${result.updatedIds.length} câu hỏi đã có.`
          : `Đã nhập ${result.savedIds.length} câu hỏi.`,
      );
      this.lastImportBatchId.set(result.savedIds.length > 0 ? result.importBatchId : undefined);
      this.undoMessage.set('');
      this.showResultPopup.set(true);
    } finally {
      this.isImporting.set(false);
    }
  }

  /** Undo the import that was just committed (FR-030) — only possible while none of its items has been used in an attempt yet. */
  async undoLastImport(): Promise<void> {
    const batchId = this.lastImportBatchId();
    if (!batchId) return;
    const result = await this.commitService.undoBatch(batchId);
    if (result.undone) {
      this.undoMessage.set('Đã hoàn tác lần nhập vừa rồi.');
      this.lastImportBatchId.set(undefined);
    } else {
      this.undoMessage.set(result.reason ?? 'Không thể hoàn tác.');
    }
  }

  /** Closing the result popup resets the whole screen — including the file input itself — back to its empty starting state, ready for another import. */
  closeResultPopupAndReset(): void {
    this.showResultPopup.set(false);
    this.rawPackage.set(undefined);
    this.preview.set(undefined);
    this.skipIndexes.set(new Set());
    this.skipPassageIndexes.set(new Set());
    this.resultMessage.set('');
    this.lastImportBatchId.set(undefined);
    this.undoMessage.set('');
    this.importedCount.set(0);
    this.passagesExpanded.set(false);
    this.invalidExpanded.set(false);
    this.fileError.set('');
    this.excelProblems.set([]);
    this.quizSources.set(undefined);
    this.duplicateMode.set('skip');
    if (this.fileInputRef) this.fileInputRef.nativeElement.value = '';
  }

  cancel(): void {
    void this.router.navigateByUrl('/quiz-bank');
  }
}
