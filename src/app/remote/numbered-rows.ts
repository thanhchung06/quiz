import { RemoteStore, WriteRejectedError } from './remote-store';
import { StoredNode } from './record-codec';

/**
 * Append-only lists keyed by an increasing number (history, results, point
 * uses): 0000000001, 0000000002, … — the same width, so key order is number
 * order everywhere. Firebase also reads these keys as integers, so a whole
 * list must be read child by child (RemoteStore.list), never as one value
 * (it could come back as an array).
 */
const KEY_WIDTH = 10;

/** Tries to take the next number before giving up (each try is one small read and one write). */
const APPEND_TRIES = 5;

export function rowKey(n: number): string {
  return String(n).padStart(KEY_WIDTH, '0');
}

export function rowNumber(key: string): number {
  return Number(key);
}

/** The last row of `path` (one small read on the key index), if any. */
export async function lastRow(remote: RemoteStore, path: string): Promise<{ key: string; value: StoredNode } | undefined> {
  const [last] = await remote.list<StoredNode>(path, { limitToLast: 1 });
  return last;
}

/**
 * Writes the next row of `path`: reads the last row, lets `build` make the
 * whole multi-path write for the next key, and sends it. The rules only let a
 * row be created, never overwritten, so when another device took that number
 * first the write is refused as a whole — then it reads again and retries.
 * Returns the key written.
 */
export async function appendRow(
  remote: RemoteStore,
  path: string,
  build: (key: string, last: StoredNode | undefined) => Promise<Record<string, unknown>>,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const last = await lastRow(remote, path);
    const key = rowKey(last ? rowNumber(last.key) + 1 : 1);
    try {
      await remote.update(await build(key, last?.value));
      return key;
    } catch (error) {
      if (!(error instanceof WriteRejectedError) || attempt >= APPEND_TRIES) throw error;
    }
  }
}
