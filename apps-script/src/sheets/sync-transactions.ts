import { readAllRows, writeAllRows } from './generic-table';

const TAB = 'SyncTransactions';

export interface StoredSyncTransaction {
  syncId: string;
  status: 'committed' | 'failed' | 'conflict';
  commitSequence: number;
  resultJson: string;
}

export function findCommittedTransaction(spreadsheet: GoogleSpreadsheet, syncId: string): StoredSyncTransaction | undefined {
  const rows = readAllRows(spreadsheet, TAB);
  const row = rows.get(syncId);
  if (!row) return undefined;
  const parsed = JSON.parse(row.bodyJson) as StoredSyncTransaction;
  return parsed.status === 'committed' ? parsed : undefined;
}

export function recordTransaction(spreadsheet: GoogleSpreadsheet, tx: StoredSyncTransaction): void {
  const rows = readAllRows(spreadsheet, TAB);
  rows.set(tx.syncId, { id: tx.syncId, version: 1, bodyJson: JSON.stringify(tx) });
  writeAllRows(spreadsheet, TAB, rows);
}
