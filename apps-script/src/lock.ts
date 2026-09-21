/**
 * Exclusive per-sync lock (FR-058, SYNC 04, contracts/sync-api.md step 1).
 * Only the lock owner may ever return SYNC_SUCCESS; a failed acquisition
 * returns SYNC_BUSY immediately with no changes read or applied.
 */
export function withExclusiveLock<T>(timeoutMs: number, fn: () => T): T | { busy: true } {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(timeoutMs);
  if (!acquired) {
    return { busy: true };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
