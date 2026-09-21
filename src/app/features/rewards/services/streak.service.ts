import { Injectable } from '@angular/core';
import { AttemptRepository } from '../../../data/repositories/attempt.repository';

function localDateOf(iso: string): string {
  const d = new Date(iso);
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/**
 * Daily streak (FR-043): increases at most once per local calendar date,
 * only when the primary daily exercise is completed (not replays). Computed
 * from Attempt history rather than a separately-stored counter, so it can
 * never drift or double-count.
 */
@Injectable({ providedIn: 'root' })
export class StreakService {
  constructor(private readonly attempts: AttemptRepository) {}

  async currentStreak(profileId: string, today: string = localDateOf(new Date().toISOString())): Promise<number> {
    const all = await this.attempts.listForProfile(profileId);
    const primaryCompletionDates = new Set(
      all
        .filter((a) => a.isScored && a.assignmentId && a.status === 'completed' && a.completedAt)
        .map((a) => localDateOf(a.completedAt!)),
    );

    let streak = 0;
    let cursor = new Date(today);
    // Today may not have been completed yet without breaking the streak
    // started on prior days; only a missed PRIOR day breaks it.
    if (!primaryCompletionDates.has(today)) {
      cursor = new Date(new Date(today).getTime() - 86_400_000);
    }
    while (primaryCompletionDates.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return streak;
  }
}
