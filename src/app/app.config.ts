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
import { seedDevData } from './data/seed-dev-data';
import { approveAllPendingQuizItems } from './data/migrations';
import { QuizItemRepository } from './data/repositories/quiz-item.repository';
import { PwaUpdateService } from './pwa-update.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
    provideAppInitializer(() => seedDevData()),
    provideAppInitializer(() => approveAllPendingQuizItems(inject(QuizItemRepository))),
    provideAppInitializer(() => {
      inject(PwaUpdateService).start();
    }),    
  ],
};
