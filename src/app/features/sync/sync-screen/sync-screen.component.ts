import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GoogleAuthService } from '../services/google-auth.service';
import { ConflictResolutionService } from '../services/conflict-resolution.service';
import { ConflictStateService } from '../../../sync-engine/conflict-state.service';
import { SyncClientService, SyncOutcome, SyncRunOptions } from '../../../sync-engine/sync-client.service';
import { StorageModeService } from '../../../sync-engine/storage-mode.service';
import { SyncConflict } from '../../../sync-engine/sync-api.types';
import { IconComponent } from '../../../shared/icon/icon.component';
import { SYNC_ENDPOINT_KEY, syncEndpointUrl } from '../../../sync-engine/sync-endpoint';

type SyncDialogStep = 'options' | 'running' | 'done';

/**
 * Sync screen (FR-056). Data always lives on the device; this screen has three
 * independent parts, each saved on its own:
 * - Connection: the Apps Script Web App URL + shared secret (plus the optional
 *   Google account, see GoogleAuthService — never needed for syncing).
 * - Automatic sync: on/off, and whether it includes questions (off by default).
 * - "Đồng bộ ngay": a dialog to choose direction (this device → Google,
 *   Google → this device) and whether to skip questions, then progress, then a
 *   summary. Conflicts, when any, are resolved below it.
 */
@Component({
  selector: 'app-sync-screen',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './sync-screen.component.html',
  styleUrl: './sync-screen.component.scss',
})
export class SyncScreenComponent {
  // --- Connection -----------------------------------------------------------
  /** A URL saved on this device wins; otherwise the build's default (config/sync-defaults.json), if any. */
  readonly endpointUrl = signal(syncEndpointUrl());
  readonly clientId = signal(localStorage.getItem('quiz-app.googleClientId') ?? '');
  readonly spreadsheetId: GoogleAuthService['spreadsheetId'];
  readonly sharedSecretSet = signal(false);
  readonly spreadsheetIdInput = signal(localStorage.getItem('quiz-app.spreadsheetId') ?? '');
  readonly sharedSecretInput = signal('');
  readonly connected: GoogleAuthService['connected'];
  readonly connectionMessage = signal('');

  // --- Automatic sync ---------------------------------------------------------
  readonly autoSyncEnabled = signal(false);
  readonly autoSyncQuestions = signal(false);
  readonly autoSyncMessage = signal('');

  // --- Sync now dialog ----------------------------------------------------------
  readonly dialogStep = signal<SyncDialogStep | undefined>(undefined);
  readonly optPush = signal(true);
  readonly optPull = signal(true);
  readonly optSkipQuestions = signal(false);
  readonly canConfirm = computed(() => this.optPush() || this.optPull());

  readonly conflicts: ConflictStateService['conflicts'];
  readonly progress: SyncClientService['progress'];
  readonly received: SyncClientService['received'];
  readonly phase: SyncClientService['phase'];
  readonly summary: SyncClientService['lastSummary'];
  readonly schemaIncompatible: SyncClientService['schemaIncompatible'];
  readonly outcomeLabels: Record<SyncOutcome, string> = {
    success: 'Đồng bộ thành công',
    busy: 'Google Sheet đang bận',
    rejected: 'Bị từ chối',
    'network-error': 'Lỗi kết nối',
    'server-error': 'Lỗi từ Apps Script',
  };

  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly conflictResolution: ConflictResolutionService,
    private readonly conflictState: ConflictStateService,
    private readonly syncClient: SyncClientService,
    private readonly autoSyncSettings: StorageModeService,
  ) {
    this.connected = this.googleAuth.connected;
    this.spreadsheetId = this.googleAuth.spreadsheetId;
    this.conflicts = this.conflictState.conflicts;
    this.schemaIncompatible = this.syncClient.schemaIncompatible;
    this.progress = this.syncClient.progress;
    this.received = this.syncClient.received;
    this.phase = this.syncClient.phase;
    this.summary = this.syncClient.lastSummary;
    this.sharedSecretSet.set(!!this.googleAuth.sharedSecret());
    void this.autoSyncSettings.getAutoSync().then((value) => {
      this.autoSyncEnabled.set(value.enabled);
      this.autoSyncQuestions.set(value.includeQuestions);
    });
  }

  // --- Connection -----------------------------------------------------------

  saveConnection(): void {
    localStorage.setItem(SYNC_ENDPOINT_KEY, this.endpointUrl());
    if (this.spreadsheetIdInput()) {
      this.googleAuth.setSpreadsheetId(this.spreadsheetIdInput());
    }
    if (this.sharedSecretInput()) {
      this.googleAuth.setSharedSecret(this.sharedSecretInput());
      this.sharedSecretSet.set(true);
      this.sharedSecretInput.set('');
    }
    this.connectionMessage.set('Đã lưu kết nối.');
  }

  async connect(): Promise<void> {
    localStorage.setItem('quiz-app.googleClientId', this.clientId());
    await this.googleAuth.connect(this.clientId());
  }

  disconnect(): void {
    this.googleAuth.disconnect();
  }

  isReadyToSync(): boolean {
    // spreadsheetId is kept only as the parent's own reference link — the
    // server is bound to its one sheet regardless, so it never gates sync.
    return !!this.endpointUrl() && this.sharedSecretSet();
  }

  // --- Automatic sync -----------------------------------------------------------

  setAutoSyncEnabled(enabled: boolean): void {
    this.autoSyncEnabled.set(enabled);
    if (!enabled) this.autoSyncQuestions.set(false);
    this.autoSyncMessage.set('');
  }

  async saveAutoSync(): Promise<void> {
    await this.autoSyncSettings.setAutoSync({ enabled: this.autoSyncEnabled(), includeQuestions: this.autoSyncQuestions() });
    this.autoSyncMessage.set(
      !this.autoSyncEnabled()
        ? 'Đã tắt tự động đồng bộ — dữ liệu vẫn được lưu trên máy này.'
        : this.autoSyncQuestions()
          ? 'Đã lưu: tự động đồng bộ dữ liệu và câu hỏi.'
          : 'Đã lưu: tự động đồng bộ dữ liệu (câu hỏi đồng bộ bằng "Đồng bộ ngay").',
    );
  }

  // --- Sync now dialog ----------------------------------------------------------

  openSyncDialog(): void {
    if (this.dialogStep() === 'running') return;
    this.optPush.set(true);
    this.optPull.set(true);
    this.optSkipQuestions.set(false);
    this.dialogStep.set('options');
  }

  closeSyncDialog(): void {
    if (this.dialogStep() === 'running') return; // the sync keeps going; the dialog stays until it ends
    this.dialogStep.set(undefined);
  }

  async confirmSync(): Promise<void> {
    if (!this.canConfirm()) return;
    const options: SyncRunOptions = {
      scopes: this.optSkipQuestions() ? ['data'] : ['questions', 'data'],
      push: this.optPush(),
      pull: this.optPull(),
    };
    this.dialogStep.set('running');
    try {
      await this.syncClient.run(this.endpointUrl(), options);
    } finally {
      this.dialogStep.set('done');
    }
  }

  directionLabel(options: SyncRunOptions): string {
    if (options.push && options.pull) return 'Hai chiều';
    return options.push ? 'Máy này → Google' : 'Google → máy này';
  }

  async resolve(conflict: SyncConflict, action: 'useLocal' | 'useGoogle' | 'keepBoth'): Promise<void> {
    if (action === 'useLocal') await this.conflictResolution.useLocal(conflict);
    if (action === 'useGoogle') await this.conflictResolution.useGoogle(conflict);
    if (action === 'keepBoth') await this.conflictResolution.keepBoth(conflict);
  }
}
