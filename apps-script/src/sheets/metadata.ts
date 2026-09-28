import { readAllRows, writeAllRows } from './generic-table';

const TAB = 'Metadata';

/** Sheet-wide state (plan §3): layout version, updateSequence counter per sheet, next Result id. */
export interface Metadata {
  schemaVersion: number;
  sequences: Record<string, number>;
  nextResultId: number;
  /** Replaced by a new UUID on every write that changes something: a device holding the same value has nothing new to pull. */
  syncId?: string;
}

/** Undefined for a sheet no version of the app has written to yet. An older layout reads as schemaVersion 1. */
export function readMetadata(spreadsheet: GoogleSpreadsheet): Metadata | undefined {
  const row = readAllRows(spreadsheet, TAB).get('singleton');
  if (!row) return undefined;
  const stored = JSON.parse(row.bodyJson) as Partial<Metadata>;
  return { schemaVersion: stored.schemaVersion ?? 1, sequences: stored.sequences ?? {}, nextResultId: stored.nextResultId ?? 1, syncId: stored.syncId };
}

export function writeMetadata(spreadsheet: GoogleSpreadsheet, metadata: Metadata): void {
  const rows = readAllRows(spreadsheet, TAB);
  rows.set('singleton', { id: 'singleton', version: 1, bodyJson: JSON.stringify(metadata) });
  writeAllRows(spreadsheet, TAB, rows);
}
