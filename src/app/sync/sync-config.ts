import { SYNC_DEFAULTS } from '../sync-defaults.generated';

export const SYNC_ENDPOINT_KEY = 'quiz-app.syncEndpoint';
export const SYNC_SECRET_KEY = 'quiz-app.sharedSecret';

/** The Apps Script URL: the one saved on this device, else the build's default (config/sync-defaults.json). */
export function syncEndpointUrl(): string {
  return localStorage.getItem(SYNC_ENDPOINT_KEY) || SYNC_DEFAULTS.endpointUrl;
}

/** SHARED_SECRET of the Apps Script: saved on this device, else the build's default. */
export function syncSharedSecret(): string {
  return localStorage.getItem(SYNC_SECRET_KEY) || SYNC_DEFAULTS.sharedSecret;
}

export function syncConfigured(): boolean {
  return !!syncEndpointUrl() && !!syncSharedSecret();
}
