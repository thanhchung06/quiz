import { Injectable, signal } from '@angular/core';
import { SyncConflict } from './sync-api.types';

/**
 * Conflict-pause behavior (FR-061): on any reported conflict, automatic sync
 * halts entirely until every conflict is resolved; local child activity
 * continues saving normally throughout.
 */
@Injectable({ providedIn: 'root' })
export class ConflictStateService {
  private readonly _conflicts = signal<SyncConflict[]>([]);
  readonly conflicts = this._conflicts.asReadonly();

  hasUnresolvedConflicts(): boolean {
    return this._conflicts().length > 0;
  }

  setConflicts(conflicts: SyncConflict[]): void {
    this._conflicts.set(conflicts);
  }

  resolveOne(entityType: string, entityId: string): void {
    this._conflicts.update((list) => list.filter((c) => !(c.entityType === entityType && c.entityId === entityId)));
  }

  clearAll(): void {
    this._conflicts.set([]);
  }
}
