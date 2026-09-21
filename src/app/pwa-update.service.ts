import { Injectable, inject } from '@angular/core';
import {
  SwUpdate,
  VersionReadyEvent,
} from '@angular/service-worker';
import { filter, fromEvent } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PwaUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private started = false;

  start(): void {
    if (this.started || !this.swUpdate.isEnabled) {
      return;
    }

    this.started = true;

    // Reload when the new application version is fully downloaded.
    this.swUpdate.versionUpdates
      .pipe(
        filter(
          (event): event is VersionReadyEvent =>
            event.type === 'VERSION_READY',
        ),
      )
      .subscribe(() => {
        window.location.reload();
      });

    this.swUpdate.unrecoverable.subscribe(event => {
      console.error('Unrecoverable PWA state:', event.reason);
      window.location.reload();
    });

    // Check immediately when the application starts.
    this.checkForUpdate();

    // If startup happened offline, check when connectivity returns.
    fromEvent(window, 'online').subscribe(() => {
      this.checkForUpdate();
    });
  }

  
  private async checkForUpdate(): Promise<void> {
    if (!navigator.onLine) {
      return;
    }

    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      console.error('PWA update check failed:', error);
    }
  }
}