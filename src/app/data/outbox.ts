import { db } from './db';
import { SyncOp } from '../sync/protocol';
import { syncConfigured } from '../sync/sync-config';

/** Sync is on (setting) and set up (endpoint + secret): writes go to Google too. */
export async function syncEnabled(): Promise<boolean> {
  const settings = await db.appSettings.get('singleton');
  return !!settings?.autoSyncEnabled && syncConfigured();
}

/**
 * Queues operations for Google, in order, when sync is on (plan §1: every
 * write goes to Google right away — SyncWriterService sends them as soon as
 * they are queued). With sync off nothing is queued: the device keeps its data
 * to itself.
 */
export async function enqueue(...ops: SyncOp[]): Promise<void> {
  if (ops.length === 0 || !(await syncEnabled())) return;
  const createdAt = new Date().toISOString();
  await db.outbox.bulkAdd(ops.map((op) => ({ op, createdAt })));
}
