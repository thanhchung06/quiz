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
