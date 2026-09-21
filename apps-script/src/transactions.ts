import { findCommittedTransaction, recordTransaction, StoredSyncTransaction } from './sheets/sync-transactions';
import { readMetadata, writeMetadata } from './sheets/metadata';

/**
 * Idempotent retry (FR-059, SYNC 05): retrying an already-committed syncId
 * returns the stored result verbatim with no re-application. Commit sequence
 * (the global data revision) increments by exactly 1 per newly committed sync.
 */
export function findPriorCommit(spreadsheet: GoogleSpreadsheet, syncId: string): StoredSyncTransaction | undefined {
  return findCommittedTransaction(spreadsheet, syncId);
}

/** Increments and persists the global data revision exactly once; call before recording the transaction. */
export function reserveNextRevision(spreadsheet: GoogleSpreadsheet): number {
  const metadata = readMetadata(spreadsheet);
  const nextRevision = metadata.dataRevision + 1;
  writeMetadata(spreadsheet, { ...metadata, dataRevision: nextRevision });
  return nextRevision;
}

export function saveCommittedTransaction(spreadsheet: GoogleSpreadsheet, syncId: string, commitSequence: number, resultJson: string): void {
  recordTransaction(spreadsheet, { syncId, status: 'committed', commitSequence, resultJson });
}
