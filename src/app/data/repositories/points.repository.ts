import { Injectable } from '@angular/core';
import { increment, RemoteStore } from '../../remote/remote-store';

/**
 * A child's spendable points (specs/003 §2): one number per child, changed by
 * Firebase's atomic increment (+ when a try counts, − when the parent uses
 * points), so two devices never lose each other's change.
 */
@Injectable({ providedIn: 'root' })
export class PointsRepository {
  constructor(private readonly remote: RemoteStore) {}

  async get(childId: string): Promise<number> {
    return (await this.remote.get<number>(`points/${childId}`)) ?? 0;
  }

  async set(childId: string, points: number): Promise<void> {
    await this.remote.update({ [`points/${childId}`]: points });
  }

  /** The value to put in a multi-path update that adds `n` atomically. */
  static add(n: number): unknown {
    return increment(n);
  }
}
