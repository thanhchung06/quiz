import { readAllRows } from './generic-table';
import { DATA_SCHEMA_VERSION } from '../../../src/app/sync/protocol';

const TAB = 'Metadata';
const PROPERTY = 'SYNC_METADATA';

/** Sheet-wide state (plan §3): layout version, updateSequence counter per sheet, next Result id, sync hash. */
export interface Metadata {
  schemaVersion: number;
  sequences: Record<string, number>;
  nextResultId: number;
  /** Hash chain over every write that changed something (nextSyncHash): a device holding the same value has nothing new to pull. */
  syncHash?: string;
}

function normalize(stored: Partial<Metadata>): Metadata {
  return { schemaVersion: stored.schemaVersion ?? 1, sequences: stored.sequences ?? {}, nextResultId: stored.nextResultId ?? 1, syncHash: stored.syncHash };
}

/**
 * Kept in Script Properties, not in the spreadsheet: reading it takes
 * milliseconds without opening the file, so a PING (every app start) never
 * waits for a large spreadsheet to load. Only when the property doesn't exist
 * yet is the spreadsheet's "Metadata" tab consulted — an older layout (schema
 * version 1) is recognised there, and a sheet this script wrote before the
 * move is carried over. Undefined for a sheet nothing has been written to yet.
 */
export function readMetadata(openSpreadsheet: () => GoogleSpreadsheet): Metadata | undefined {
  const json = PropertiesService.getScriptProperties().getProperty(PROPERTY);
  if (json) return normalize(JSON.parse(json) as Partial<Metadata>);
  const row = readAllRows(openSpreadsheet(), TAB).get('singleton');
  if (!row) return undefined;
  const metadata = normalize(JSON.parse(row.bodyJson) as Partial<Metadata>);
  if (metadata.schemaVersion === DATA_SCHEMA_VERSION) writeMetadata(metadata);
  return metadata;
}

export function writeMetadata(metadata: Metadata): void {
  PropertiesService.getScriptProperties().setProperty(PROPERTY, JSON.stringify(metadata));
}
