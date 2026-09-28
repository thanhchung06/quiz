import {
  ApplicationConfig,
  provideZoneChangeDetection,
  provideAppInitializer,
  inject,
  isDevMode,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { dropOldDatabases } from './data/db';
import { RemoteStore } from './remote/remote-store';
import { FirebaseRemoteStore } from './remote/firebase-remote-store';
import { StartupService } from './remote/startup.service';
import { PwaUpdateService } from './pwa-update.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
    { provide: RemoteStore, useExisting: FirebaseRemoteStore },
    provideAppInitializer(() => {
      // App start (connect, profiles, quiz bank) runs in the background: the first screen shows right
      // away, and login waits for it.
      const startup = inject(StartupService);
      return dropOldDatabases().then(() => {
        void startup.run();
      });
    }),
    provideAppInitializer(() => {
      inject(PwaUpdateService).start();
    }),    
  ],
};
