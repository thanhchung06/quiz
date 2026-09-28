import { Injectable, signal } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { syncEnabled } from '../data/outbox';
import { db } from '../data/db';
import { SyncReaderService } from './sync-reader.service';
import { SyncWriterService } from './sync-writer.service';
import { sendPing, SyncError, wakeUp } from './sync-transport';

export type StartupSyncState = 'running' | 'error' | 'done';

/**
 * App start (plan §5), with sync on: first send what a previous run left in
 * the outbox, then pull everything from Google. Login stays disabled until
 * this is done; on failure it shows the error and "Thử lại" — there is no way
 * to continue without it. With sync off it is done immediately.
 */
@Injectable({ providedIn: 'root' })
export class StartupSyncService {
  private readonly _state = signal<StartupSyncState>('running');
  private readonly _error = signal<string | undefined>(undefined);
  private readonly _skipped = signal(false);
  private readonly _status = signal('');
  /** What the running app-start sync is doing, for the login screen. */
  readonly status = this._status.asReadonly();
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  /** The last run found nothing new on Google (same sync hash) and pulled nothing. */
  readonly skipped = this._skipped.asReadonly();

  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly reader: SyncReaderService,
    private readonly writer: SyncWriterService,
  ) {}

  /** Runs once at start and on "Thử lại". */
  async run(): Promise<void> {
    this._state.set('running');
    this._error.set(undefined);
    try {
      this._skipped.set(false);
      if (await syncEnabled()) {
        // Wake the script up first, patiently: after sitting idle, Apps Script's first answer can take long.
        this._status.set('Đang kết nối Google…');
        const awake = await wakeUp((attempt, attempts) => this._status.set(`Google đang khởi động — thử lại lần ${attempt}/${attempts}…`));
        const pending = await db.outbox.count();
        if (pending > 0) {
          this._status.set('Đang gửi thay đổi còn chờ…');
          await this.writer.flush();
        }
        this._status.set('Đang lấy dữ liệu mới nhất từ Google…');
        // Same hash as Google: this device has seen every write → no pull at all. (The wake-up answer
        // already carries the hash, unless this device just sent writes of its own.)
        const remote = pending > 0 ? (await sendPing()).syncHash : awake.syncHash;
        const settings = await this.settings.get();
        if (remote && remote === settings.syncHash) {
          this._skipped.set(true);
        } else {
          await this.reader.pull({
            questions: settings.autoSyncQuestions,
            addedQuestionsOnly: settings.autoSyncAddedQuestionsOnly,
            exercises: settings.autoSyncExercises,
          });
          // The value read before pulling: anything written meanwhile makes the next start pull again.
          await this.settings.update({ syncHash: remote });
        }
      }
      this._state.set('done');
    } catch (error) {
      this._error.set(error instanceof SyncError ? error.message : `Lỗi khi đồng bộ: ${String(error)}`);
      this._state.set('error');
    }
  }
}
