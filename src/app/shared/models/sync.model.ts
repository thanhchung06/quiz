/**
 * Sync envelope shared by every entity marked (synced) in data-model.md §0.
 * FR-057: version fields are compared, never record content, to detect sync state.
 */
export type SyncStatus = 'synced' | 'pendingUpload' | 'conflict';

export interface SyncEnvelope {
  id: string;
  localVersion: number;
  lastGoogleVersion: number;
  syncStatus: SyncStatus;
  updatedAt: string;
  updatedByDeviceId: string;
  deletedAt?: string;
}

export function newSyncEnvelope(id: string, deviceId: string): SyncEnvelope {
  return {
    id,
    localVersion: 1,
    lastGoogleVersion: 0,
    syncStatus: 'pendingUpload',
    updatedAt: new Date().toISOString(),
    updatedByDeviceId: deviceId,
  };
}
