import { SYNC_DEFAULTS } from '../sync-defaults.generated';

export const SYNC_ENDPOINT_KEY = 'quiz-app.syncEndpoint';

/** The Apps Script URL: the one saved on this device, else the build's default (config/sync-defaults.json). */
export function syncEndpointUrl(): string {
  return localStorage.getItem(SYNC_ENDPOINT_KEY) || SYNC_DEFAULTS.endpointUrl;
}
