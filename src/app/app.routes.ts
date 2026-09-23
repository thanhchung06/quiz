import { Routes } from '@angular/router';
import { authGuard, childGuard, parentGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'profiles' },
  {
    path: 'profiles',
    loadComponent: () =>
      import('./core/auth/profile-selection/profile-selection.component').then((m) => m.ProfileSelectionComponent),
  },

  // --- Child play (US1) — focused, no shell chrome ---
  {
    path: 'child-home',
    canActivate: [authGuard, childGuard],
    loadComponent: () =>
      import('./features/child-play/child-home/child-home.component').then((m) => m.ChildHomeComponent),
  },
  {
    path: 'exercise-intro',
    canActivate: [authGuard, childGuard],
    loadComponent: () =>
      import('./features/child-play/exercise-intro/exercise-intro.component').then((m) => m.ExerciseIntroComponent),
  },
  {
    path: 'exercise-intro/:assignmentId',
    canActivate: [authGuard, childGuard],
    loadComponent: () =>
      import('./features/child-play/exercise-intro/exercise-intro.component').then((m) => m.ExerciseIntroComponent),
  },
  {
    path: 'exercise/question',
    canActivate: [authGuard, childGuard],
    loadComponent: () => import('./features/child-play/question/question.component').then((m) => m.QuestionComponent),
  },
  {
    path: 'exercise/result',
    canActivate: [authGuard, childGuard],
    loadComponent: () => import('./features/child-play/result/result.component').then((m) => m.ResultComponent),
  },

  // --- Everything parent-facing lives inside the responsive shell (sidebar
  // on wide screens, hamburger drawer on narrow ones) so every screen has a
  // consistent, always-available way back to any other section. ---
  {
    path: '',
    canActivate: [authGuard, parentGuard],
    loadComponent: () => import('./shared/shell/parent-shell.component').then((m) => m.ParentShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/overview/overview.component').then((m) => m.OverviewComponent),
      },
      {
        path: 'dashboard/attempt/:attemptId',
        loadComponent: () =>
          import('./features/dashboard/attempt-detail/attempt-detail.component').then((m) => m.AttemptDetailComponent),
      },
      {
        path: 'dashboard/:profileId/learning-needs',
        loadComponent: () =>
          import('./features/dashboard/learning-needs/learning-needs.component').then((m) => m.LearningNeedsComponent),
      },
      {
        path: 'quiz-bank',
        loadComponent: () =>
          import('./features/quiz-bank/quiz-bank-list/quiz-bank-list.component').then((m) => m.QuizBankListComponent),
      },
      {
        path: 'quiz-bank/new',
        loadComponent: () =>
          import('./features/quiz-bank/quiz-item-form/quiz-item-form.component').then((m) => m.QuizItemFormComponent),
      },
      {
        path: 'quiz-bank/:id/edit',
        loadComponent: () =>
          import('./features/quiz-bank/quiz-item-form/quiz-item-form.component').then((m) => m.QuizItemFormComponent),
      },
      {
        path: 'quiz-bank/:id/preview',
        loadComponent: () =>
          import('./features/quiz-bank/quiz-item-preview/quiz-item-preview.component').then(
            (m) => m.QuizItemPreviewComponent,
          ),
      },
      {
        path: 'quiz-bank/passages/new',
        loadComponent: () =>
          import('./features/quiz-bank/passage-editor/passage-editor.component').then(
            (m) => m.PassageEditorComponent,
          ),
      },
      {
        path: 'quiz-bank/passages/:passageId/edit',
        loadComponent: () =>
          import('./features/quiz-bank/passage-editor/passage-editor.component').then(
            (m) => m.PassageEditorComponent,
          ),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./features/quiz-bank/categories/categories.component').then((m) => m.CategoriesComponent),
      },
      {
        path: 'quiz-bank/import',
        loadComponent: () =>
          import('./features/quiz-bank/import/import-preview/import-preview.component').then(
            (m) => m.ImportPreviewComponent,
          ),
      },
      {
        path: 'exercise-library',
        loadComponent: () =>
          import('./features/exercise-builder/library/exercise-library.component').then(
            (m) => m.ExerciseLibraryComponent,
          ),
      },
      {
        path: 'exercise-builder/new',
        loadComponent: () =>
          import('./features/exercise-builder/builder/exercise-builder.component').then(
            (m) => m.ExerciseBuilderComponent,
          ),
      },
      {
        path: 'exercise-builder/:id/edit',
        loadComponent: () =>
          import('./features/exercise-builder/builder/exercise-builder.component').then(
            (m) => m.ExerciseBuilderComponent,
          ),
      },
      {
        path: 'schedule',
        loadComponent: () =>
          import('./features/exercise-builder/schedule/schedule.component').then((m) => m.ScheduleComponent),
      },
      {
        path: 'rotation',
        loadComponent: () =>
          import('./features/exercise-builder/rotation/rotation-editor.component').then(
            (m) => m.RotationEditorComponent,
          ),
      },
      {
        path: 'redeem-points',
        loadComponent: () =>
          import('./features/rewards/redeem/redeem-points.component').then((m) => m.RedeemPointsComponent),
      },
      {
        path: 'backup',
        loadComponent: () =>
          import('./features/backup/backup-restore/backup-restore.component').then((m) => m.BackupRestoreComponent),
      },
      {
        path: 'sync',
        loadComponent: () =>
          import('./features/sync/sync-screen/sync-screen.component').then((m) => m.SyncScreenComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./core/settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },

  { path: '**', redirectTo: 'profiles' },
];
