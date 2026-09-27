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

/** Only needed to replay a retried request, so old entries are dropped instead of growing forever. */
const KEEP_TRANSACTIONS = 200;

export function recordTransaction(spreadsheet: GoogleSpreadsheet, tx: StoredSyncTransaction): void {
  const rows = readAllRows(spreadsheet, TAB);
  rows.set(tx.syncId, { id: tx.syncId, version: 1, bodyJson: JSON.stringify(tx) });
  if (rows.size > KEEP_TRANSACTIONS) {
    const sequence = (bodyJson: string) => {
      try {
        return Number((JSON.parse(bodyJson) as StoredSyncTransaction).commitSequence) || 0;
      } catch {
        return 0;
      }
    };
    const newest = Array.from(rows.values())
      .sort((a, b) => sequence(b.bodyJson) - sequence(a.bodyJson))
      .slice(0, KEEP_TRANSACTIONS);
    writeAllRows(spreadsheet, TAB, new Map(newest.map((row) => [row.id, { ...row, rowIndex: undefined }])));
    return;
  }
  writeAllRows(spreadsheet, TAB, rows);
}
