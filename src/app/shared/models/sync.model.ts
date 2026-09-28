/**
 * Fields every record of a sequenced sheet (Profile, Category, QuizItem,
 * Exercise) carries — plan §3.8.
 */
export interface SyncEnvelope {
  /** UUID made on the device that created the record. */
  id: string;
  updatedAt: string;
  updatedByDeviceId: string;
  /** A delete only sets this mark (other devices learn about it on their next pull). */
  deletedAt?: string;
  /** Handed out by Google on every write; absent until the record has been uploaded. The app-start pull asks for records above the local maximum. */
  updateSequence?: number;
}

export function newSyncEnvelope(id: string, deviceId: string): SyncEnvelope {
  return { id, updatedAt: new Date().toISOString(), updatedByDeviceId: deviceId };
}
