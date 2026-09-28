import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { OfflineReadyService } from './core/offline/offline-ready.service';
import { BUILD_TIMESTAMP } from './build-info.generated';
import { ConnectionOverlayComponent } from './remote/connection-overlay.component';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConnectionOverlayComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'quiz-app';
  readonly offlineReady: OfflineReadyService['ready'];
  readonly imagesCached: OfflineReadyService['imagesCached'];
  readonly imagesTotal: OfflineReadyService['imagesTotal'];
  readonly buildTimestamp = BUILD_TIMESTAMP;
  constructor(private readonly offlineReadyService: OfflineReadyService) {
    this.offlineReady = this.offlineReadyService.ready;
    this.imagesCached = this.offlineReadyService.imagesCached;
    this.imagesTotal = this.offlineReadyService.imagesTotal;
  }
}
