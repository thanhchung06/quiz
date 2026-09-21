import { Injectable } from '@angular/core';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';

/**
 * Minimal parent-only "reset unfinished attempt" action (FR-016). The full
 * dashboard entry point is added in US3 (T059); this exposes the operation
 * itself so US1 can be demoed/tested independently of the dashboard.
 */
@Injectable({ providedIn: 'root' })
export class AttemptAdminService {
  constructor(private readonly attempts: AttemptRepository) {}

  async resetUnfinishedAttempt(profileId: string): Promise<boolean> {
    const active = await this.attempts.findInProgress(profileId);
    if (!active) return false;
    await this.attempts.update(active.id, {
      status: 'abandoned',
      completedAt: new Date().toISOString(),
    });
    return true;
  }
}
