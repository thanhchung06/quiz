import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { QuizBankSyncService } from '../../../remote/quiz-bank-sync.service';

/**
 * "Xóa dữ liệu trên máy này": clears what this device keeps — its copy of the
 * quiz bank and its settings — and downloads the quiz bank again. The
 * family's data on the server is not touched.
 */
@Injectable({ providedIn: 'root' })
export class ResetService {
  constructor(private readonly quizBank: QuizBankSyncService) {}

  async resetAllData(): Promise<void> {
    await db.appSettings.clear();
    await this.quizBank.reloadAll();
  }
}
