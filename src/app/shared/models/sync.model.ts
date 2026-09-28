/** Fields every question, category, exercise and profile carries. */
export interface SyncEnvelope {
  /** UUID made on the device that created the record. */
  id: string;
  /** Set by the server on every write (ISO string when read back). */
  updatedAt: string;
  updatedByDeviceId: string;
  /** A delete only sets this mark (devices caching the quiz bank learn about it on their next pull). */
  deletedAt?: string;
}

export function newSyncEnvelope(id: string, deviceId: string): SyncEnvelope {
  return { id, updatedAt: new Date().toISOString(), updatedByDeviceId: deviceId };
}
