import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GoogleAuthService } from '../services/google-auth.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { SYNC_ENDPOINT_KEY, syncEndpointUrl } from '../../../sync/sync-config';
import { ManualSyncOptions, ManualSyncService } from '../../../sync/manual-sync.service';

type SyncDialogStep = 'options' | 'running' | 'done';

interface AutoSyncForm {
  enabled: boolean;
  questions: boolean;
  addedQuestionsOnly: boolean;
  exercises: boolean;
}

/**
 * Sync screen. Data always lives on the device; this screen has three
 * independent parts, each saved on its own:
 * - Connection: the Apps Script Web App URL + shared secret (plus the optional
 *   Google account, see GoogleAuthService — never needed for syncing).
 * - Automatic sync: on/off; what the app-start pull includes (questions — or
 *   only newly added ones — and exercises). With it on, every write goes to
 *   Google right away.
 * - "Đồng bộ ngay": one direction, everything (ManualSyncService), with
 *   progress and a summary.
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
  /** What is currently saved — the "Lưu kết nối" button is only enabled when the form differs from it. */
  private readonly savedEndpointUrl = signal(syncEndpointUrl());
  private readonly savedSpreadsheetId = signal(localStorage.getItem('quiz-app.spreadsheetId') ?? '');
  readonly connectionDirty = computed(
    () =>
      this.endpointUrl().trim() !== this.savedEndpointUrl() ||
      this.spreadsheetIdInput().trim() !== this.savedSpreadsheetId() ||
      this.sharedSecretInput().trim() !== '',
  );

  // --- Automatic sync ---------------------------------------------------------
  readonly autoSyncEnabled = signal(false);
  readonly autoSyncQuestions = signal(false);
  readonly autoSyncAddedOnly = signal(false);
  readonly autoSyncExercises = signal(true);
  readonly autoSyncMessage = signal('');
  private readonly savedAutoSync = signal<AutoSyncForm>({ enabled: false, questions: false, addedQuestionsOnly: false, exercises: true });
  readonly autoSyncDirty = computed(() => {
    const saved = this.savedAutoSync();
    const form = this.autoSyncForm();
    return JSON.stringify(saved) !== JSON.stringify(form);
  });

  // --- Sync now dialog ----------------------------------------------------------
  readonly dialogStep = signal<SyncDialogStep | undefined>(undefined);
  /** One direction per run: this device -> Google, or Google -> this device. */
  readonly direction = signal<'push' | 'pull'>('push');
  readonly optSkipQuestions = signal(false);
  readonly optAddedQuestionsOnly = signal(false);
  readonly progress: ManualSyncService['progress'];
  readonly received: ManualSyncService['received'];
  readonly summary: ManualSyncService['summary'];

  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly manualSync: ManualSyncService,
    private readonly appSettings: AppSettingsRepository,
  ) {
    this.connected = this.googleAuth.connected;
    this.spreadsheetId = this.googleAuth.spreadsheetId;
    this.progress = this.manualSync.progress;
    this.received = this.manualSync.received;
    this.summary = this.manualSync.summary;
    this.sharedSecretSet.set(!!this.googleAuth.sharedSecret());
    void this.appSettings.get().then((settings) => {
      const form: AutoSyncForm = {
        enabled: settings.autoSyncEnabled,
        questions: settings.autoSyncQuestions,
        addedQuestionsOnly: settings.autoSyncAddedQuestionsOnly,
        exercises: settings.autoSyncExercises,
      };
      this.savedAutoSync.set(form);
      this.setAutoSyncForm(form);
    });
  }

  // --- Connection -----------------------------------------------------------

  saveConnection(): void {
    if (!this.connectionDirty()) return;
    const endpoint = this.endpointUrl().trim();
    localStorage.setItem(SYNC_ENDPOINT_KEY, endpoint);
    this.endpointUrl.set(endpoint);
    this.savedEndpointUrl.set(endpoint);
    const spreadsheetId = this.spreadsheetIdInput().trim();
    if (spreadsheetId) {
      this.googleAuth.setSpreadsheetId(spreadsheetId);
    }
    this.spreadsheetIdInput.set(spreadsheetId);
    this.savedSpreadsheetId.set(spreadsheetId);
    if (this.sharedSecretInput().trim()) {
      this.googleAuth.setSharedSecret(this.sharedSecretInput().trim());
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

  private autoSyncForm(): AutoSyncForm {
    const enabled = this.autoSyncEnabled();
    const questions = enabled && this.autoSyncQuestions();
    return { enabled, questions, addedQuestionsOnly: questions && this.autoSyncAddedOnly(), exercises: enabled && this.autoSyncExercises() };
  }

  private setAutoSyncForm(form: AutoSyncForm): void {
    this.autoSyncEnabled.set(form.enabled);
    this.autoSyncQuestions.set(form.questions);
    this.autoSyncAddedOnly.set(form.addedQuestionsOnly);
    this.autoSyncExercises.set(form.enabled ? form.exercises : true);
  }

  setAutoSyncEnabled(enabled: boolean): void {
    this.autoSyncEnabled.set(enabled);
    this.autoSyncMessage.set('');
  }

  async saveAutoSync(): Promise<void> {
    if (!this.autoSyncDirty()) return;
    const form = this.autoSyncForm();
    await this.appSettings.update({
      autoSyncEnabled: form.enabled,
      autoSyncQuestions: form.questions,
      autoSyncAddedQuestionsOnly: form.addedQuestionsOnly,
      autoSyncExercises: form.exercises,
    });
    this.savedAutoSync.set(form);
    this.autoSyncMessage.set(
      form.enabled
        ? 'Đã lưu. Lần mở ứng dụng sau sẽ nhận dữ liệu từ Google; mỗi thay đổi được gửi lên ngay.'
        : 'Đã tắt tự động đồng bộ — dữ liệu chỉ lưu trên máy này.',
    );
  }

  // --- Sync now dialog ----------------------------------------------------------

  openSyncDialog(): void {
    if (this.dialogStep() === 'running') return;
    this.direction.set('push');
    this.optSkipQuestions.set(false);
    this.optAddedQuestionsOnly.set(false);
    this.dialogStep.set('options');
  }

  closeSyncDialog(): void {
    if (this.dialogStep() === 'running') return; // the sync keeps going; the dialog stays until it ends
    this.dialogStep.set(undefined);
  }

  async confirmSync(): Promise<void> {
    const options: ManualSyncOptions = {
      direction: this.direction(),
      skipQuestions: this.optSkipQuestions(),
      addedQuestionsOnly: !this.optSkipQuestions() && this.optAddedQuestionsOnly(),
    };
    this.dialogStep.set('running');
    try {
      await this.manualSync.run(options);
    } finally {
      this.dialogStep.set('done');
    }
  }

  directionLabel(options: ManualSyncOptions): string {
    return options.direction === 'push' ? 'Máy này → Google (ghi đè)' : 'Google → máy này (ghi đè)';
  }

  scopeLabel(options: ManualSyncOptions): string {
    if (options.skipQuestions) return 'Chỉ dữ liệu (không có câu hỏi)';
    return options.addedQuestionsOnly ? 'Dữ liệu và câu hỏi mới thêm' : 'Câu hỏi và dữ liệu';
  }
}
