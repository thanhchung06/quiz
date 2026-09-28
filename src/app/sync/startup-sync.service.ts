import { Injectable, signal } from '@angular/core';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';
import { syncEnabled } from '../data/outbox';
import { SyncReaderService } from './sync-reader.service';
import { SyncWriterService } from './sync-writer.service';
import { SyncError } from './sync-transport';

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
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

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
      if (await syncEnabled()) {
        await this.writer.flush();
        const settings = await this.settings.get();
        await this.reader.pull({
          questions: settings.autoSyncQuestions,
          addedQuestionsOnly: settings.autoSyncAddedQuestionsOnly,
          exercises: settings.autoSyncExercises,
        });
      }
      this._state.set('done');
    } catch (error) {
      this._error.set(error instanceof SyncError ? error.message : `Lỗi khi đồng bộ: ${String(error)}`);
      this._state.set('error');
    }
  }
}
