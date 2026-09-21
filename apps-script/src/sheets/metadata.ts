import { readAllRows, writeAllRows } from './generic-table';

const TAB = 'Metadata';
const SUPPORTED_GOOGLE_SCHEMA_VERSION = 1;

export interface Metadata {
  googleSchemaVersion: number;
  dataRevision: number;
}

export function readMetadata(spreadsheet: GoogleSpreadsheet): Metadata {
  const rows = readAllRows(spreadsheet, TAB);
  const row = rows.get('singleton');
  if (!row) {
    return { googleSchemaVersion: SUPPORTED_GOOGLE_SCHEMA_VERSION, dataRevision: 0 };
  }
  return JSON.parse(row.bodyJson) as Metadata;
}

export function writeMetadata(spreadsheet: GoogleSpreadsheet, metadata: Metadata): void {
  const rows = readAllRows(spreadsheet, TAB);
  rows.set('singleton', { id: 'singleton', version: 1, bodyJson: JSON.stringify(metadata) });
  writeAllRows(spreadsheet, TAB, rows);
}

/** FR-065: refuse automatic sync when the Google schema is newer than this app build supports. */
export function isSchemaCompatible(metadata: Metadata, clientSupportedVersion: number): boolean {
  return metadata.googleSchemaVersion <= clientSupportedVersion;
}
