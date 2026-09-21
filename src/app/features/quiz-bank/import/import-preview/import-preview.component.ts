import { Component, ElementRef, ViewChild, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ImportPreviewService, ImportPreview } from '../services/import-preview.service';
import { ImportCommitService } from '../services/import-commit.service';
import { QuizPackage } from '../quiz-package.model';
import { QUIZ_PACKAGE_TEMPLATE } from '../quiz-package-template';
import { IconComponent } from '../../../../shared/icon/icon.component';

/**
 * Import Preview screen (FR-027): a grade/type breakdown of what's in the
 * file (not a per-item list), skip/replace duplicates, cancel, or download
 * the error report. Imports always save as already approved — no review
 * queue step (amended 2026-09-18). Reading the file and committing the
 * import both show a loading state; a successful commit shows a summary
 * popup whose Close action resets the whole screen back to its empty
 * starting state, including the file input, ready for another import
 * (amended 2026-09-18).
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
    try {
      const text = await file.text();
      const pkg = JSON.parse(text) as QuizPackage;
      this.rawPackage.set(pkg);
      this.preview.set(await this.previewService.buildPreview(pkg));
      this.skipIndexes.set(new Set());
      this.skipPassageIndexes.set(new Set());
      this.passagesExpanded.set(false);
    } finally {
      this.isReadingFile.set(false);
    }
  }

  downloadTemplate(): void {
    const blob = new Blob([JSON.stringify(QUIZ_PACKAGE_TEMPLATE, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau-goi-cau-hoi.json';
    a.click();
    URL.revokeObjectURL(url);
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
    const blob = new Blob([this.previewService.downloadErrorReport(preview)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async importQuizzes(): Promise<void> {
    const pkg = this.rawPackage();
    const preview = this.preview();
    if (!pkg || !preview || this.isImporting()) return;

    this.isImporting.set(true);
    try {
      const duplicateIndexes = new Set(preview.likelyDuplicates.map((d) => d.index));
      const finalSkip = new Set([...this.skipIndexes(), ...duplicateIndexes]);

      const result = await this.commitService.commit(pkg, preview.validIndexes, {
        skipIndexes: finalSkip,
        categoryMapping: new Map(),
        skipPassageIndexes: this.skipPassageIndexes(),
        passageCategoryMapping: new Map(),
      });
      this.importedCount.set(result.savedIds.length);
      this.resultMessage.set(`Đã nhập ${result.savedIds.length} câu hỏi.`);
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
    if (this.fileInputRef) this.fileInputRef.nativeElement.value = '';
  }

  cancel(): void {
    void this.router.navigateByUrl('/quiz-bank');
  }
}
