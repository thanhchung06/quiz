import { Injectable, signal } from '@angular/core';
import { RemoteStore } from './remote-store';
import { QuizBankSyncService } from './quiz-bank-sync.service';
import { seedFixedProfiles } from '../data/seed';
import { seedDefaultCategories } from '../data/migrations';
import { ProfileRepository } from '../data/repositories/profile.repository';
import { CategoryRepository } from '../data/repositories/category.repository';
import { AppSettingsRepository } from '../data/repositories/app-settings.repository';

export type StartupState = 'running' | 'error' | 'done';

/**
 * App start (specs/003 §4): connect to Firebase (automatic anonymous sign-in),
 * create the fixed profiles if the family has none yet, bring the quiz bank up
 * to date (usually one small read), seed the default categories. Login waits
 * for this; on failure it shows the error and "Thử lại".
 */
@Injectable({ providedIn: 'root' })
export class StartupService {
  private readonly _state = signal<StartupState>('running');
  private readonly _error = signal<string | undefined>(undefined);
  private readonly _status = signal('');
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly status = this._status.asReadonly();

  constructor(
    private readonly remote: RemoteStore,
    private readonly quizBank: QuizBankSyncService,
    private readonly profiles: ProfileRepository,
    private readonly categories: CategoryRepository,
    private readonly settings: AppSettingsRepository,
  ) {}

  async run(): Promise<void> {
    this._state.set('running');
    this._error.set(undefined);
    try {
      this._status.set('Đang kết nối máy chủ…');
      await this.remote.ready();
      await seedFixedProfiles(this.profiles);
      this._status.set('Đang cập nhật ngân hàng câu hỏi…');
      await this.quizBank.sync();
      await seedDefaultCategories(this.categories, this.settings);
      this._state.set('done');
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : String(error));
      this._state.set('error');
    }
  }
}
