/**
 * Version-only conflict detection (FR-057, data-model.md §0). Content is
 * never compared — only localVersion (L), lastGoogleVersion (B), and the
 * current Google version (G) read fresh after the lock is acquired.
 */
export type VersionDecision = 'noop' | 'upload' | 'download' | 'conflict' | 'invalid';

export interface VersionInput {
  localVersion: number;
  lastGoogleVersion: number;
  googleVersion: number;
}

export function decideVersion({ localVersion: L, lastGoogleVersion: B, googleVersion: G }: VersionInput): VersionDecision {
  if (L < B || G < B) return 'invalid';
  if (L === B && G === B) return 'noop';
  if (L > B && G === B) return 'upload';
  if (L === B && G > B) return 'download';
  return 'conflict'; // L != B && G != B
}

/**
 * A "conflict" whose Google copy is byte-for-byte the record being uploaded is
 * no conflict at all: it is what an earlier sync already wrote before failing
 * later on (Sheets writes are not rolled back when the script throws), so the
 * client never learned it was stored. Such a record is adopted as synced
 * instead of making the parent resolve it by hand. The version kept is the
 * higher of the two, so the next sync is a no-op (L ≥ G) or a harmless
 * download of identical content (G > L).
 */
export function adoptIdenticalVersion(localVersion: number, googleVersion: number, googleBodyJson: string | undefined, payloadJson: string): number | undefined {
  return googleBodyJson !== undefined && googleBodyJson === payloadJson ? Math.max(localVersion, googleVersion) : undefined;
}
