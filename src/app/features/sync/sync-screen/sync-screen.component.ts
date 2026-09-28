import { Component, signal } from '@angular/core';
import { IconComponent } from '../../../shared/icon/icon.component';
import { RemoteStore } from '../../../remote/remote-store';
import { QuizBankSyncService } from '../../../remote/quiz-bank-sync.service';
import { AppSettingsRepository } from '../../../data/repositories/app-settings.repository';
import { db } from '../../../data/db';
import { FIREBASE_CONFIG } from '../../../firebase-config.generated';

/**
 * Connection screen (specs/003-firebase): the family's data lives in Firebase
 * and is read and written directly. Shows the connection, the quiz bank this
 * device keeps (the only thing it copies), and reloads that copy on request.
 */
@Component({
  selector: 'app-sync-screen',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './sync-screen.component.html',
  styleUrl: './sync-screen.component.scss',
})
export class SyncScreenComponent {
  readonly project = FIREBASE_CONFIG.projectId || '(chưa cấu hình)';
  readonly connected: RemoteStore['connected'];
  readonly questions = signal(0);
  readonly categories = signal(0);
  readonly quizVersion = signal<string | undefined>(undefined);
  readonly reloading = signal(false);
  readonly message = signal('');
  readonly received: QuizBankSyncService['received'];

  constructor(
    remote: RemoteStore,
    private readonly quizBank: QuizBankSyncService,
    private readonly settings: AppSettingsRepository,
  ) {
    this.connected = remote.connected;
    this.received = quizBank.received;
    void this.load();
  }

  private async load(): Promise<void> {
    this.questions.set(await db.quizItems.filter((q) => !q.deletedAt).count());
    this.categories.set(await db.categories.filter((c) => !c.deletedAt).count());
    const version = (await this.settings.get()).quizVersion;
    this.quizVersion.set(version ? new Date(version).toLocaleString('vi-VN') : undefined);
  }

  async reloadQuizBank(): Promise<void> {
    if (this.reloading()) return;
    this.reloading.set(true);
    this.message.set('');
    try {
      await this.quizBank.reloadAll();
      this.message.set(`Đã tải lại ${this.received()} câu hỏi và danh mục.`);
    } catch (error) {
      this.message.set(`Chưa tải lại được: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.reloading.set(false);
      await this.load();
    }
  }
}
