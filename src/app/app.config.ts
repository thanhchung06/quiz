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
import { approveAllPendingQuizItems, seedDefaultCategories } from './data/migrations';
import { CategoryRepository } from './data/repositories/category.repository';
import { AppSettingsRepository } from './data/repositories/app-settings.repository';
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
    provideAppInitializer(() => {
      // Dev seed first: it only runs on an empty category table.
      const categories = inject(CategoryRepository);
      const settings = inject(AppSettingsRepository);
      return seedDevData().then(() => seedDefaultCategories(categories, settings));
    }),
    provideAppInitializer(() => approveAllPendingQuizItems(inject(QuizItemRepository))),
    provideAppInitializer(() => {
      inject(PwaUpdateService).start();
    }),    
  ],
};
