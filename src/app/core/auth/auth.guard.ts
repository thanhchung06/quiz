import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/** Blocks any route (child or parent area) unless a profile is logged in (FR-004). */
export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  if (session.isLoggedIn()) {
    return true;
  }
  return router.parseUrl('/profiles');
};

/** Restricts parent-only routes (quiz bank, builder, dashboard, sync, backup). */
export const parentGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  const profile = session.currentProfile();
  if (profile?.role === 'parent') {
    return true;
  }
  return router.parseUrl(profile ? '/child-home' : '/profiles');
};

/** Restricts child-play routes to a logged-in child profile. */
export const childGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  const profile = session.currentProfile();
  if (profile?.role === 'child') {
    return true;
  }
  return router.parseUrl(profile ? '/dashboard' : '/profiles');
};
