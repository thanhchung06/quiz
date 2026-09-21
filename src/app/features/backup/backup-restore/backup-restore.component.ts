import { Component, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { BackupExportService } from '../services/export.service';
import { BackupImportService, ImportSummary } from '../services/import.service';
import { ResetService } from '../services/reset.service';
import { BackupEnvelope } from '../services/export.service';
import { SessionService } from '../../../core/auth/session.service';
import { IconComponent } from '../../../shared/icon/icon.component';

/** Backup & Restore screen (FR-052, FR-053): export/import with confirmation, and reset-all-data. */
@Component({
  selector: 'app-backup-restore',
  standalone: true,
  imports: [KeyValuePipe, IconComponent],
  templateUrl: './backup-restore.component.html',
  styleUrl: './backup-restore.component.scss',
})
export class BackupRestoreComponent {
  readonly pendingImport = signal<BackupEnvelope | undefined>(undefined);
  readonly importSummary = signal<ImportSummary | undefined>(undefined);
  readonly resetStep = signal(0); // 0 = idle, 1 = warning shown, 2 = confirmed
  readonly message = signal('');

  constructor(
    private readonly exportService: BackupExportService,
    private readonly importService: BackupImportService,
    private readonly resetService: ResetService,
    private readonly session: SessionService,
  ) {}

  async exportBackup(): Promise<void> {
    await this.exportService.exportAsFile();
    this.message.set('Đã xuất bản sao lưu.');
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const envelope = JSON.parse(await file.text()) as BackupEnvelope;
    this.pendingImport.set(envelope);
    this.importSummary.set(await this.importService.previewSummary(envelope));
  }

  async confirmImport(): Promise<void> {
    const envelope = this.pendingImport();
    if (!envelope) return;
    await this.importService.restore(envelope);
    this.pendingImport.set(undefined);
    this.message.set('Đã khôi phục dữ liệu.');
  }

  startReset(): void {
    // Parent login is already required by the parentGuard on this route (FR-053).
    this.resetStep.set(1);
  }

  cancelReset(): void {
    this.resetStep.set(0);
  }

  async confirmReset(): Promise<void> {
    if (this.resetStep() !== 1) return;
    await this.resetService.resetAllData();
    this.session.logout();
    this.resetStep.set(0);
    this.message.set('Đã đặt lại toàn bộ dữ liệu.');
  }
}
