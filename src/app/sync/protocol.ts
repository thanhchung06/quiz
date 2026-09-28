/**
 * The request/response contract between the app and the Apps Script web app
 * (specs/002-sync-data-redesign/plan.md §4). Types only — imported by both
 * sides (apps-script/src bundles it through esbuild).
 */

/**
 * The sheet's sync hash chain: every write that changes something gets a new
 * write id, and the hash becomes nextSyncHash(hash, writeId) — a new fixed-size
 * hash computed from the previous hash and the write id (never a growing string) — on Google and,
 * with the returned write id, on the device that wrote. A device whose hash
 * equals Google's has seen every write; another device's write in between
 * leaves it behind (plan §5). Shared by both sides so they compute the same.
 */
export function nextSyncHash(previous: string | undefined, writeId: string): string {
  // cyrb53: a fast 53-bit string hash — good enough to tell chains apart, no crypto needed.
  const text = `${previous ?? ''}|${writeId}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // A fixed-size value (53 bits → always 14 hex digits), whatever the chain's length.
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Bumped whenever the sheet layout changes; the script refuses a different one, the app drops its local data. */
export const DATA_SCHEMA_VERSION = 2;

/** One sheet (tab) per entity. */
export type SheetName =
  | 'Profile'
  | 'Category'
  | 'QuizItem'
  | 'Exercise'
  | 'Assignment'
  | 'Session'
  | 'Result'
  | 'HistoryResult'
  | 'PointUsage';

/** Sheets whose records carry an updateSequence handed out by the script. */
export type SequencedSheet = 'Profile' | 'Category' | 'QuizItem' | 'Exercise';
export const SEQUENCED_SHEETS: SequencedSheet[] = ['Profile', 'Category', 'QuizItem', 'Exercise'];

/** How many detailed results the Result sheet keeps (a circle shared by all children). */
export const RESULT_CIRCLE_SIZE = 1000;

export type JsonRecord = Record<string, unknown> & { id: string };

// --- Writes -----------------------------------------------------------------

/**
 * One write. Every operation is safe to repeat (records are keyed by a UUID
 * the device made; the script never stores the same UUID twice).
 */
export type SyncOp =
  /** Insert or overwrite a whole record (Exercise, QuizItem, Category, Profile). `onlyIfAbsent`: skip if the id already exists (seeded defaults). Profile: `totalPoints` on Google is kept. */
  | { op: 'WRITE_RECORD'; sheet: SequencedSheet; record: JsonRecord; onlyIfAbsent?: boolean }
  /** "Máy này → Google": records of the sheet the device doesn't have are marked deleted. */
  | { op: 'PRUNE'; sheet: SequencedSheet; keepIds: string[] }
  | { op: 'SET_TOTAL_POINTS'; profileId: string; totalPoints: number }
  | { op: 'ADD_ASSIGNMENT'; childId: string; assignment: JsonRecord }
  | { op: 'REMOVE_ASSIGNMENT'; childId: string; assignmentId: string }
  /** The script keeps max(current, tries). */
  | { op: 'SET_TRY'; childId: string; assignmentId: string; tries: number }
  | { op: 'START_SESSION'; childId: string; session: JsonRecord }
  /** Ignored unless `sessionId` is the child's current session. */
  | { op: 'UPDATE_PROGRESS'; childId: string; sessionId: string; progress: Record<string, unknown> }
  /** Removes the child's session if it is `sessionId`. */
  | { op: 'END_SESSION'; childId: string; sessionId: string }
  | { op: 'INSERT_RESULT'; result: JsonRecord }
  | { op: 'APPEND_HISTORY'; history: JsonRecord }
  | { op: 'APPEND_POINT_USAGE'; usage: JsonRecord };

/** What one operation gave back (same position as in the request). */
export interface OpResult {
  /** WRITE_RECORD, SET_TOTAL_POINTS: the record's new updateSequence (the existing one when skipped). */
  updateSequence?: number;
  /** INSERT_RESULT: the result's id (position in the circle). */
  resultId?: number;
  /** APPEND_HISTORY, APPEND_POINT_USAGE: the sheet row it is stored in. */
  row?: number;
  /** PRUNE: how many records were marked deleted. */
  removed?: number;
  /** The operation changed nothing (duplicate, unknown session, …). */
  skipped?: boolean;
}

// --- Reads ------------------------------------------------------------------

export type ReadSpec =
  /** Every row (Profile, Assignment, Session). */
  | { mode: 'ALL'; sheet: 'Profile' | 'Assignment' | 'Session' }
  /** Records with updateSequence > after (sequenced sheets), oldest first. */
  | { mode: 'SEQUENCE_AFTER'; sheet: SequencedSheet; after: number }
  /** Rows after `after` (HistoryResult, PointUsage). */
  | { mode: 'ROWS_AFTER'; sheet: 'HistoryResult' | 'PointUsage'; after: number }
  /** Results with id > after (only the last RESULT_CIRCLE_SIZE exist). */
  | { mode: 'RESULTS_AFTER'; after: number }
  /** These records only (e.g. the questions an exercise needs). */
  | { mode: 'BY_ID'; sheet: SequencedSheet; ids: string[] };

export interface ReadRecord {
  /** The record as stored, with updateSequence / resultId / row filled in. */
  record: JsonRecord;
}

// --- Envelope ---------------------------------------------------------------

export type SyncRequest =
  /** `requestId`: the same on every resend of this request, so a resend doesn't count as another write in the sync hash chain. */
  | { action: 'WRITE'; sharedSecret: string; deviceId: string; requestId?: string; ops: SyncOp[] }
  | { action: 'READ'; sharedSecret: string; deviceId: string; read: ReadSpec }
  | { action: 'PING'; sharedSecret: string; deviceId: string };

export type SyncResponse =
  | {
      ok: true;
      results?: OpResult[];
      records?: JsonRecord[];
      truncated?: boolean;
      /** PING: the sheet's current sync hash (see nextSyncHash). */
      syncHash?: string;
      /** WRITE: the id of this write, when it changed something — the device folds it into its own hash. */
      writeId?: string;
    }
  | { ok: false; error: 'BAD_SECRET' | 'SCHEMA_MISMATCH' | 'BUSY' | 'BAD_REQUEST'; message?: string; sheetSchemaVersion?: number };
