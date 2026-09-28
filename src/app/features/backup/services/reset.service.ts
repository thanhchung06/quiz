import { Injectable } from '@angular/core';
import Dexie from 'dexie';
import { db } from '../../../data/db';
import { seedFixedProfiles } from '../../../data/seed';

/**
 * Reset-all-data flow (FR-053): the parent-login + warning + second
 * confirmation gate is enforced by the calling UI (backup-restore screen);
 * this service clears this device and re-seeds the profiles. Google is not
 * touched.
 */
@Injectable({ providedIn: 'root' })
export class ResetService {
  async resetAllData(): Promise<void> {
    const tables = [
      db.profiles,
      db.categories,
      db.quizItems,
      db.exercises,
      db.assignments,
      db.sessions,
      db.results,
      db.historyResults,
      db.pointUsages,
      db.outbox,
    ];
    await db.transaction('rw', tables, () => tables.reduce((chain, table) => chain.then(() => table.clear()), Dexie.Promise.resolve()));
    await db.appSettings.update('singleton', { syncHash: undefined });
    await seedFixedProfiles();
  }
}
