import { Injectable } from '@angular/core';
import { db } from '../../../data/db';
import { seedFixedProfiles } from '../../../data/seed';

/**
 * Reset-all-data flow (FR-053): the parent-login + warning + second
 * confirmation gate is enforced by the calling UI (backup-restore screen);
 * this service performs the actual clear-and-reseed once both are given.
 */
@Injectable({ providedIn: 'root' })
export class ResetService {
  async resetAllData(): Promise<void> {
    await db.transaction(
      'rw',
      [db.profiles, db.categories, db.quizItems, db.exercises, db.assignments, db.rotations, db.attempts, db.answerResults, db.rewards, db.deletedRecords, db.syncTransactions],
      async () => {
        await Promise.all([
          db.profiles.clear(),
          db.categories.clear(),
          db.quizItems.clear(),
          db.exercises.clear(),
          db.assignments.clear(),
          db.rotations.clear(),
          db.attempts.clear(),
          db.answerResults.clear(),
          db.rewards.clear(),
          db.deletedRecords.clear(),
          db.syncTransactions.clear(),
        ]);
      },
    );
    await seedFixedProfiles();
  }
}
