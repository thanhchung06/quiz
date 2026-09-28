import { withExclusiveLock } from './lock';
import { readMetadata, writeMetadata, Metadata } from './sheets/metadata';
import { readAllRows, readIndex, readIndexAfter, readRowBodies, writeChangedRows, StoredRow } from './sheets/generic-table';
import {
  DATA_SCHEMA_VERSION,
  JsonRecord,
  OpResult,
  ReadSpec,
  RESULT_CIRCLE_SIZE,
  SequencedSheet,
  SyncOp,
  SyncRequest,
  SyncResponse,
} from '../../src/app/sync/protocol';

const LOCK_TIMEOUT_MS = 10000;
/** A read answer stops near this many characters of records; the app asks again from where it ended. */
const READ_MAX_CHARS = 4_000_000;
/** Rows whose bodies are read per call while paging. */
const READ_CHUNK = 200;
/** How many removed assignment ids a child's row remembers (so a late re-add can't bring one back). */
const REMOVED_ASSIGNMENTS_KEPT = 500;

/**
 * Contract: specs/002-sync-data-redesign/plan.md §4. One doPost entry point:
 * WRITE applies a list of operations under the script lock, READ returns
 * records without locking.
 *
 * This script must be CONTAINER-BOUND to exactly one spreadsheet (created via
 * Extensions > Apps Script from inside that Sheet) and only ever uses
 * `getActiveSpreadsheet()`: with the `spreadsheets.currentonly` scope (see
 * appsscript.json) it is structurally unable to touch any other file.
 * `sharedSecret` (Script Properties → SHARED_SECRET) authenticates callers.
 *
 * Every sheet row is [key, number, body…]: the number is the updateSequence
 * (Profile, Category, QuizItem, Exercise), the result id (Result) or 0; the
 * body is the record's JSON, split over several cells when long.
 */
export function doPost(e: GoogleAppsScriptDoPostEvent): unknown {
  let response: SyncResponse;
  try {
    response = handle(JSON.parse(e.postData.contents) as SyncRequest);
  } catch (error) {
    response = { ok: false, error: 'BAD_REQUEST', message: String(error) };
  }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

export function handle(request: SyncRequest): SyncResponse {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expectedSecret || request.sharedSecret !== expectedSecret) return { ok: false, error: 'BAD_SECRET' };

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const metadata = readMetadata(spreadsheet);
  if (metadata && metadata.schemaVersion !== DATA_SCHEMA_VERSION) {
    return { ok: false, error: 'SCHEMA_MISMATCH', sheetSchemaVersion: metadata.schemaVersion ?? 1 };
  }

  if (request.action === 'PING') return { ok: true, syncId: metadata?.syncId };
  if (request.action === 'READ') return read(spreadsheet, request.read);

  const outcome = withExclusiveLock(LOCK_TIMEOUT_MS, () => write(spreadsheet, request.ops));
  if ('busy' in outcome) return { ok: false, error: 'BUSY' };
  return outcome;
}

// --- Writes -----------------------------------------------------------------

/** Rows of the sheets touched by one request, written back once at the end. */
class Workspace {
  private readonly indexes = new Map<string, Map<string, StoredRow>>();
  private readonly changed = new Map<string, Set<string>>();

  constructor(
    readonly spreadsheet: GoogleSpreadsheet,
    readonly metadata: Metadata,
  ) {}

  rows(sheet: string): Map<string, StoredRow> {
    let rows = this.indexes.get(sheet);
    if (!rows) {
      rows = readIndex(this.spreadsheet, sheet);
      this.indexes.set(sheet, rows);
    }
    return rows;
  }

  /** The record stored under `key`, parsed (undefined when absent or empty). */
  body(sheet: string, key: string): Record<string, unknown> | undefined {
    const row = this.rows(sheet).get(key);
    if (!row) return undefined;
    if (row.bodyJson === '' && row.rowIndex !== undefined) {
      row.bodyJson = readRowBodies(this.spreadsheet, sheet, [row.rowIndex]).get(row.rowIndex) ?? '';
    }
    return parseBody(row.bodyJson);
  }

  put(sheet: string, key: string, number: number, body: unknown): StoredRow {
    const rows = this.rows(sheet);
    const existing = rows.get(key);
    const row: StoredRow = { id: key, version: number, bodyJson: JSON.stringify(body), rowIndex: existing?.rowIndex };
    rows.set(key, row);
    if (!this.changed.has(sheet)) this.changed.set(sheet, new Set());
    this.changed.get(sheet)!.add(key);
    return row;
  }

  nextSequence(sheet: SequencedSheet): number {
    const next = (this.metadata.sequences[sheet] ?? 0) + 1;
    this.metadata.sequences[sheet] = next;
    return next;
  }

  /** Whether this request wrote anything at all. */
  get changedAnything(): boolean {
    return this.changed.size > 0;
  }

  flush(): void {
    for (const [sheet, keys] of this.changed) writeChangedRows(this.spreadsheet, sheet, this.rows(sheet), keys);
  }
}

function parseBody(json: string): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function write(spreadsheet: GoogleSpreadsheet, ops: SyncOp[]): SyncResponse {
  const metadata = readMetadata(spreadsheet) ?? { schemaVersion: DATA_SCHEMA_VERSION, sequences: {}, nextResultId: 1 };
  const ws = new Workspace(spreadsheet, metadata);
  /** Appended rows only know their row number after flush(). */
  const pendingRows: Array<{ result: OpResult; row: StoredRow }> = [];

  const results = ops.map((op): OpResult => {
    switch (op.op) {
      case 'WRITE_RECORD':
        return writeRecord(ws, op.sheet, op.record, !!op.onlyIfAbsent);
      case 'PRUNE':
        return prune(ws, op.sheet, new Set(op.keepIds));
      case 'SET_TOTAL_POINTS': {
        const body = ws.body('Profile', op.profileId);
        if (!body) return { skipped: true };
        const updateSequence = ws.nextSequence('Profile');
        ws.put('Profile', op.profileId, updateSequence, { ...body, totalPoints: op.totalPoints });
        return { updateSequence };
      }
      case 'ADD_ASSIGNMENT':
      case 'REMOVE_ASSIGNMENT':
      case 'SET_TRY':
        return changeAssignments(ws, op);
      case 'START_SESSION':
        ws.put('Session', op.childId, 0, { ...op.session, childId: op.childId });
        return {};
      case 'UPDATE_PROGRESS': {
        const session = ws.body('Session', op.childId);
        if (!session || session['id'] !== op.sessionId) return { skipped: true };
        ws.put('Session', op.childId, 0, { ...session, progress: op.progress });
        return {};
      }
      case 'END_SESSION': {
        const session = ws.body('Session', op.childId);
        if (!session || session['id'] !== op.sessionId) return { skipped: true };
        ws.put('Session', op.childId, 0, {});
        return {};
      }
      case 'INSERT_RESULT':
        return insertResult(ws, op.result);
      case 'APPEND_HISTORY':
      case 'APPEND_POINT_USAGE': {
        const sheet = op.op === 'APPEND_HISTORY' ? 'HistoryResult' : 'PointUsage';
        const record = op.op === 'APPEND_HISTORY' ? op.history : op.usage;
        const existing = ws.rows(sheet).get(record.id);
        if (existing) return { row: existing.rowIndex, skipped: true };
        const result: OpResult = {};
        pendingRows.push({ result, row: ws.put(sheet, record.id, 0, withoutLocalFields(record)) });
        return result;
      }
    }
  });

  ws.flush();
  for (const { result, row } of pendingRows) result.row = row.rowIndex;
  // A new syncId whenever something changed. previousSyncId lets the device tell whether anyone else
  // wrote since it last caught up (then it must still pull on its next start).
  const previousSyncId = metadata.syncId;
  if (ws.changedAnything) metadata.syncId = Utilities.getUuid();
  writeMetadata(spreadsheet, metadata);
  return { ok: true, results, syncId: metadata.syncId, previousSyncId };
}

/** Fields that only mean something on one device, or that the sheet's number column holds. */
function withoutLocalFields(record: JsonRecord): JsonRecord {
  const { updateSequence: _s, resultId: _r, row: _row, ...rest } = record;
  return rest as JsonRecord;
}

function writeRecord(ws: Workspace, sheet: SequencedSheet, record: JsonRecord, onlyIfAbsent: boolean): OpResult {
  const existing = ws.rows(sheet).get(record.id);
  if (existing && onlyIfAbsent) return { updateSequence: existing.version, skipped: true };
  let body = withoutLocalFields(record);
  if (sheet === 'Profile' && existing) {
    // totalPoints only changes through SET_TOTAL_POINTS.
    const stored = ws.body(sheet, record.id);
    body = { ...body, totalPoints: stored?.['totalPoints'] ?? 0 };
  }
  const updateSequence = ws.nextSequence(sheet);
  ws.put(sheet, record.id, updateSequence, body);
  return { updateSequence };
}

function prune(ws: Workspace, sheet: SequencedSheet, keep: Set<string>): OpResult {
  const deletedAt = new Date().toISOString();
  let removed = 0;
  const candidates = Array.from(ws.rows(sheet).values()).filter((row) => !keep.has(row.id));
  const bodies = readRowBodies(
    ws.spreadsheet,
    sheet,
    candidates.filter((row) => row.rowIndex !== undefined && row.bodyJson === '').map((row) => row.rowIndex!),
  );
  for (const row of candidates) {
    const body = parseBody(row.bodyJson || bodies.get(row.rowIndex!) || '') ?? { id: row.id };
    if (body['deletedAt']) continue;
    ws.put(sheet, row.id, ws.nextSequence(sheet), { ...body, deletedAt });
    removed++;
  }
  return { removed };
}

interface AssignmentRow {
  childId: string;
  assignments: Array<Record<string, unknown> & { id: string; tries?: number }>;
  removed: string[];
}

function changeAssignments(
  ws: Workspace,
  op: Extract<SyncOp, { op: 'ADD_ASSIGNMENT' | 'REMOVE_ASSIGNMENT' | 'SET_TRY' }>,
): OpResult {
  const stored = ws.body('Assignment', op.childId) as Partial<AssignmentRow> | undefined;
  const row: AssignmentRow = { childId: op.childId, assignments: stored?.assignments ?? [], removed: stored?.removed ?? [] };

  if (op.op === 'ADD_ASSIGNMENT') {
    const id = op.assignment.id;
    if (row.removed.includes(id) || row.assignments.some((a) => a.id === id)) return { skipped: true };
    row.assignments.push(op.assignment);
  } else if (op.op === 'REMOVE_ASSIGNMENT') {
    const present = row.assignments.some((a) => a.id === op.assignmentId);
    if (row.removed.includes(op.assignmentId) && !present) return { skipped: true };
    row.removed = [...row.removed.filter((id) => id !== op.assignmentId), op.assignmentId].slice(-REMOVED_ASSIGNMENTS_KEPT);
    row.assignments = row.assignments.filter((a) => a.id !== op.assignmentId);
    ws.put('Assignment', op.childId, 0, row);
    return present ? {} : { skipped: true };
  } else {
    const assignment = row.assignments.find((a) => a.id === op.assignmentId);
    if (!assignment) return { skipped: true };
    assignment.tries = Math.max(assignment.tries ?? 0, op.tries);
  }
  ws.put('Assignment', op.childId, 0, row);
  return {};
}

/** The circle: result id N lives in row (N − 1) mod RESULT_CIRCLE_SIZE + 1, overwriting id N − RESULT_CIRCLE_SIZE. */
function insertResult(ws: Workspace, result: JsonRecord): OpResult {
  const rows = ws.rows('Result');
  const existing = rows.get(result.id);
  if (existing) return { resultId: existing.version, skipped: true };

  const resultId = ws.metadata.nextResultId;
  ws.metadata.nextResultId = resultId + 1;
  const rowIndex = ((resultId - 1) % RESULT_CIRCLE_SIZE) + 1;
  for (const [key, row] of rows) {
    if (row.rowIndex === rowIndex) rows.delete(key);
  }
  ws.put('Result', result.id, resultId, withoutLocalFields(result)).rowIndex = rowIndex;
  return { resultId };
}

// --- Reads ------------------------------------------------------------------

function read(spreadsheet: GoogleSpreadsheet, spec: ReadSpec): SyncResponse {
  if (spec.mode === 'ALL') {
    const records: JsonRecord[] = [];
    for (const row of readAllRows(spreadsheet, spec.sheet).values()) {
      const body = parseBody(row.bodyJson);
      if (!body || Object.keys(body).length === 0) continue; // an ended session
      records.push(decorate(spec.sheet, row, body));
    }
    return { ok: true, records };
  }

  const sheet = spec.mode === 'RESULTS_AFTER' ? 'Result' : spec.sheet;
  let rows: StoredRow[];
  if (spec.mode === 'ROWS_AFTER') {
    rows = readIndexAfter(spreadsheet, sheet, spec.after).rows;
  } else if (spec.mode === 'BY_ID') {
    const index = readIndex(spreadsheet, sheet);
    rows = spec.ids.map((id) => index.get(id)).filter((row): row is StoredRow => !!row);
  } else {
    rows = Array.from(readIndex(spreadsheet, sheet).values())
      .filter((row) => row.version > spec.after)
      .sort((a, b) => a.version - b.version);
  }
  return readPage(spreadsheet, sheet, rows);
}

/** Bodies of `rows` in order, stopping near READ_MAX_CHARS (then `truncated`: ask again after the last one received). */
function readPage(spreadsheet: GoogleSpreadsheet, sheet: string, rows: StoredRow[]): SyncResponse {
  const records: JsonRecord[] = [];
  let size = 0;
  for (let start = 0; start < rows.length; start += READ_CHUNK) {
    const chunk = rows.slice(start, start + READ_CHUNK);
    const bodies = readRowBodies(spreadsheet, sheet, chunk.map((row) => row.rowIndex!));
    for (const [i, row] of chunk.entries()) {
      const json = bodies.get(row.rowIndex!) ?? '';
      size += json.length;
      const body = parseBody(json);
      if (body) records.push(decorate(sheet, row, body));
      const more = start + i + 1 < rows.length;
      if (more && size >= READ_MAX_CHARS) return { ok: true, records, truncated: true };
    }
  }
  return { ok: true, records };
}

/** Puts the sheet's number column (or row) back on the record under its own name. */
function decorate(sheet: string, row: StoredRow, body: Record<string, unknown>): JsonRecord {
  const record = { ...body, id: (body['id'] as string) ?? row.id } as JsonRecord;
  if (sheet === 'Result') record['resultId'] = row.version;
  else if (sheet === 'HistoryResult' || sheet === 'PointUsage') record['row'] = row.rowIndex;
  else if (sheet === 'Assignment') record['id'] = row.id;
  else if (sheet !== 'Session') record['updateSequence'] = row.version;
  return record;
}
