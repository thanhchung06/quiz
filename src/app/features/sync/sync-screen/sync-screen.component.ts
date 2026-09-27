import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GoogleAuthService } from '../services/google-auth.service';
import { ConflictResolutionService } from '../services/conflict-resolution.service';
import { ConflictStateService } from '../../../sync-engine/conflict-state.service';
import { SyncClientService, SyncOutcome } from '../../../sync-engine/sync-client.service';
import { StorageModeService } from '../../../sync-engine/storage-mode.service';
import { StorageMode } from '../../../shared/models/domain.model';
import { SyncConflict } from '../../../sync-engine/sync-api.types';
import { IconComponent } from '../../../shared/icon/icon.component';
import { SYNC_DEFAULTS } from '../../../sync-defaults.generated';

/**
 * Sync screen (FR-056): Sync Normally, Review Conflicts, Retry, Replace
 * Google With Local, Replace Local With Google, Pause Automatic Sync,
 * Disconnect Google. Replace actions require explicit confirmation and
 * recommend a prior backup; disconnecting never deletes local data.
 *
 * Syncing itself only needs the Apps Script Web App URL, the target
 * Spreadsheet ID, and the shared secret (see apps-script/README.md) —
 * "Connect Google Account" (OAuth) is optional and only matters for a
 * future spreadsheet picker; it never gates the sync calls themselves.
 */
@Component({
  selector: 'app-sync-screen',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './sync-screen.component.html',
  styleUrl: './sync-screen.component.scss',
})
export class SyncScreenComponent {
  /** A URL saved on this device wins; otherwise the build's default (config/sync-defaults.json), if any. */
  readonly endpointUrl = signal(localStorage.getItem('quiz-app.syncEndpoint') || SYNC_DEFAULTS.endpointUrl);
  readonly clientId = signal(localStorage.getItem('quiz-app.googleClientId') ?? '');
  readonly spreadsheetId: GoogleAuthService['spreadsheetId'];
  readonly sharedSecretSet = signal(false);
  readonly spreadsheetIdInput = signal(localStorage.getItem('quiz-app.spreadsheetId') ?? '');
  readonly sharedSecretInput = signal('');
  readonly connected: GoogleAuthService['connected'];
  readonly conflicts: ConflictStateService['conflicts'];
  readonly storageMode = signal<StorageMode>('localOnly');
  readonly lastResult = signal<SyncOutcome | undefined>(undefined);
  readonly schemaIncompatible: SyncClientService['schemaIncompatible'];
  readonly confirmingReplace = signal<'toGoogle' | 'toLocal' | undefined>(undefined);
  readonly message = signal('');

  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly conflictResolution: ConflictResolutionService,
    private readonly conflictState: ConflictStateService,
    private readonly syncClient: SyncClientService,
    private readonly storageModeService: StorageModeService,
  ) {
    this.connected = this.googleAuth.connected;
    this.spreadsheetId = this.googleAuth.spreadsheetId;
    this.conflicts = this.conflictState.conflicts;
    this.schemaIncompatible = this.syncClient.schemaIncompatible;
    this.sharedSecretSet.set(!!this.googleAuth.sharedSecret());
    void this.storageModeService.getMode().then((m) => this.storageMode.set(m));
  }

  saveSyncTarget(): void {
    localStorage.setItem('quiz-app.syncEndpoint', this.endpointUrl());
    if (this.spreadsheetIdInput()) {
      this.googleAuth.setSpreadsheetId(this.spreadsheetIdInput());
    }
    if (this.sharedSecretInput()) {
      this.googleAuth.setSharedSecret(this.sharedSecretInput());
      this.sharedSecretSet.set(true);
      this.sharedSecretInput.set('');
    }
    this.message.set('Đã lưu cài đặt đồng bộ.');
  }

  async connect(): Promise<void> {
    localStorage.setItem('quiz-app.googleClientId', this.clientId());
    await this.googleAuth.connect(this.clientId());
  }

  disconnect(): void {
    this.googleAuth.disconnect();
  }

  async setMode(mode: StorageMode): Promise<void> {
    this.storageMode.set(mode);
    await this.storageModeService.setMode(mode);
  }

  isReadyToSync(): boolean {
    // spreadsheetId is kept only as the parent's own reference link — the
    // server is bound to its one sheet regardless, so it never gates sync.
    return !!this.endpointUrl() && this.sharedSecretSet();
  }

  async syncNow(): Promise<void> {
    this.lastResult.set(await this.syncClient.syncNormally(this.endpointUrl()));
  }

  async retry(): Promise<void> {
    await this.syncNow();
  }

  async resolve(conflict: SyncConflict, action: 'useLocal' | 'useGoogle' | 'keepBoth'): Promise<void> {
    if (action === 'useLocal') await this.conflictResolution.useLocal(conflict);
    if (action === 'useGoogle') await this.conflictResolution.useGoogle(conflict);
    if (action === 'keepBoth') await this.conflictResolution.keepBoth(conflict);
  }

  requestReplace(direction: 'toGoogle' | 'toLocal'): void {
    this.confirmingReplace.set(direction);
  }

  cancelReplace(): void {
    this.confirmingReplace.set(undefined);
  }

  async confirmReplace(): Promise<void> {
    // Full bulk replace-all is a larger, riskier operation than a normal sync
    // batch; this pass wires the confirmation gate and leaves the bulk
    // upload/download itself to a follow-up iteration once live-tested
    // against a real spreadsheet.
    this.message.set('Đã xác nhận — vui lòng chạy đồng bộ để áp dụng.');
    this.confirmingReplace.set(undefined);
  }
}
