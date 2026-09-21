import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { OfflineReadyService } from './core/offline/offline-ready.service';
import { BUILD_TIMESTAMP } from './build-info.generated';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'quiz-app';
  readonly offlineReady: OfflineReadyService['ready'];
  readonly buildTimestamp = BUILD_TIMESTAMP;
  constructor(private readonly offlineReadyService: OfflineReadyService) {
    this.offlineReady = this.offlineReadyService.ready;
  }
}
