import { SERVER_TIME } from './remote-store';

/**
 * How records are stored in Firebase: the record as JSON text (Firebase drops
 * empty lists and refuses `undefined`, so plain objects wouldn't round-trip),
 * next to the fields the rules and queries need (updatedAt/createdAt set by
 * the server, and counters such as tries).
 */
export interface StoredNode {
  json: string;
  updatedAt?: number;
  createdAt?: number;
  [field: string]: unknown;
}

/** A record to write, stamped with the server's time under `timeField`. */
export function encode(record: object, timeField: 'updatedAt' | 'createdAt' = 'updatedAt', extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { updatedAt: _u, createdAt: _c, ...rest } = record as Record<string, unknown>;
  return { json: JSON.stringify(rest), [timeField]: SERVER_TIME, ...extra };
}

/** The record back, with the server's time as an ISO string under the same name, plus the stored extra fields. */
export function decode<T>(node: StoredNode | undefined): T | undefined {
  if (!node || typeof node.json !== 'string') return undefined;
  const { json, ...fields } = node;
  const record = JSON.parse(json) as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    record[key] = (key === 'updatedAt' || key === 'createdAt') && typeof value === 'number' ? new Date(value).toISOString() : value;
  }
  return record as T;
}
