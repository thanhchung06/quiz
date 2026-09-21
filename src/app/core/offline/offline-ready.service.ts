import { Injectable, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Reports true only once the Angular ServiceWorker has finished registering
 * and stabilized (FR-051). In dev mode (no service worker registered) this
 * resolves true immediately so local development isn't blocked.
 */
@Injectable({ providedIn: 'root' })
export class OfflineReadyService {
  private readonly _ready = signal(false);
  readonly ready = this._ready.asReadonly();

  constructor(private readonly swUpdate: SwUpdate) {
    if (!this.swUpdate.isEnabled) {
      this._ready.set(true);
      return;
    }
    navigator.serviceWorker.ready
      .then(() => this._ready.set(true))
      .catch(() => this._ready.set(true));
  }
}
