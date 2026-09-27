import { readAllRows, readIndex, readRowBody, writeAllRows, writeChangedRows } from './generic-table';

const TAB = 'SyncTransactions';

export interface StoredSyncTransaction {
  syncId: string;
  status: 'committed' | 'failed' | 'conflict';
  commitSequence: number;
  resultJson: string;
}

export function findCommittedTransaction(spreadsheet: GoogleSpreadsheet, syncId: string): StoredSyncTransaction | undefined {
  const row = readIndex(spreadsheet, TAB).get(syncId);
  if (!row?.rowIndex) return undefined;
  const parsed = JSON.parse(readRowBody(spreadsheet, TAB, row.rowIndex)) as StoredSyncTransaction;
  return parsed.status === 'committed' ? parsed : undefined;
}

/** Only needed to replay a retried request: appended, and trimmed to the newest ones once it grows. */
const KEEP_TRANSACTIONS = 50;
const TRIM_ABOVE = 150;

export function recordTransaction(spreadsheet: GoogleSpreadsheet, tx: StoredSyncTransaction): void {
  const index = readIndex(spreadsheet, TAB);
  const existing = index.get(tx.syncId);
  index.set(tx.syncId, { id: tx.syncId, version: 1, bodyJson: JSON.stringify(tx), rowIndex: existing?.rowIndex });
  writeChangedRows(spreadsheet, TAB, index, [tx.syncId]);
  if (index.size <= TRIM_ABOVE) return;

  const sequence = (bodyJson: string) => {
    try {
      return Number((JSON.parse(bodyJson) as StoredSyncTransaction).commitSequence) || 0;
    } catch {
      return 0;
    }
  };
  const newest = Array.from(readAllRows(spreadsheet, TAB).values())
    .sort((a, b) => sequence(b.bodyJson) - sequence(a.bodyJson))
    .slice(0, KEEP_TRANSACTIONS);
  writeAllRows(spreadsheet, TAB, new Map(newest.map((row) => [row.id, { ...row, rowIndex: undefined }])));
}
