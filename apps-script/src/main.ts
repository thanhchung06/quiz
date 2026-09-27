import { withExclusiveLock } from './lock';
import { adoptIdenticalVersion, decideVersion } from './versioning';
import { findPriorCommit, reserveNextRevision, saveCommittedTransaction } from './transactions';
import { readMetadata, isSchemaCompatible } from './sheets/metadata';
import { readAllRows, readIndex, readRowBodies, readRowBody, writeChangedRows, StoredRow } from './sheets/generic-table';
import { appendChangeLog, readChangeLogAfter, selectPull, ChangeLogEntry } from './sheets/change-log';

const CLIENT_SUPPORTED_SCHEMA_VERSION = 1;
const LOCK_TIMEOUT_MS = 5000;
/** About how many records one pull response carries; the client keeps asking while `hasMore`. */
const PULL_LIMIT = 500;

/** Each entity type is stored in the tab of the same name (Profile, Category, QuizItem, …). */
type EntityTab = string;

interface ChangeInput {
  changeGroupId: string;
  entityType: EntityTab;
  entityId: string;
  localVersion: number;
  lastGoogleVersion: number;
  operation: 'upsert' | 'delete';
  payload: Record<string, unknown>;
}

interface SyncRequest {
  syncId: string;
  deviceId: string;
  sharedSecret: string;
  action: 'SYNC_NORMAL' | 'REPLACE_GOOGLE_WITH_LOCAL' | 'REPLACE_PRUNE' | 'SNAPSHOT' | 'REPLACE_LOCAL_WITH_GOOGLE' | 'RESOLVE_CONFLICT' | 'DEBUG_DUMP';
  changes: ChangeInput[];
  /** When present, the response also carries other devices' changes committed after this revision (paged). */
  pullSince?: number;
  /** With pullSince: only these entity types (e.g. just QuizItem + Category for the question sync). */
  pullTypes?: string[];
  /** REPLACE_PRUNE: every id the device has, per entity type; other rows of those types become deleted tombstones. */
  keepIds?: Record<string, string[]>;
  /** SNAPSHOT: which tabs to read, and where to continue (position in snapshotTypes + row offset). */
  snapshotTypes?: string[];
  snapshotCursor?: { typeIndex: number; offset: number };
  /** Only read for action = DEBUG_DUMP. */
  debugTabs?: EntityTab[];
}

interface DebugDumpResponse {
  syncId: string;
  result: 'DEBUG_DUMP';
  tabs: Record<string, Array<{ id: string; version: number; body: unknown }>>;
}

interface SyncResponse {
  syncId: string;
  result: 'SYNC_SUCCESS' | 'SYNC_BUSY' | 'SYNC_REJECTED';
  commitSequence?: number;
  committedChangeGroupIds?: string[];
  conflicts?: Array<{ entityType: string; entityId: string; localVersion: number; googleVersion: number; lastGoogleVersion: number }>;
  downloads?: Array<{ entityType: string; entityId: string; version: number; payload: unknown }>;
  schemaCompatible?: boolean;
  /** With pullSince: the revision the client has now pulled up to. */
  dataRevision?: number;
  /** With pullSince: more changes remain after dataRevision; ask again. */
  hasMore?: boolean;
  /** REPLACE_GOOGLE_WITH_LOCAL: the version each record now has on Google (the client stores it as its own). */
  versions?: Record<string, number>;
  /** REPLACE_PRUNE: how many Google records were marked deleted. */
  removed?: number;
  /** SNAPSHOT: where to continue; absent once every requested tab has been sent. */
  nextCursor?: { typeIndex: number; offset: number };
}

/**
 * contracts/sync-api.md: the single doPost entry point implementing the
 * exclusive-lock sync algorithm. This script must be CONTAINER-BOUND to
 * exactly one spreadsheet (created via Extensions > Apps Script from
 * inside that Sheet, not as a standalone script) and uses
 * `getActiveSpreadsheet()` rather than `openById(someId)`. This is
 * deliberate: `openById` can open *any* spreadsheet the deploying account
 * can reach, which forces Google's OAuth consent to request the broad
 * "all your Spreadsheets" scope. A bound script that never calls `openById`
 * can instead request the much narrower `spreadsheets.currentonly` scope
 * (see appsscript.json) — Google's consent screen then reads "only this
 * spreadsheet," and the running script is structurally unable to touch any
 * other sheet, regardless of what a request claims.
 *
 * `sharedSecret` is the caller-auth mechanism on top of that: Apps Script
 * Web Apps have no clean way to verify an arbitrary Google OAuth bearer
 * token, so instead the deployer sets a random secret in Script Properties
 * (see setup docs) and every request must include the matching value.
 */
export function doPost(e: GoogleAppsScriptDoPostEvent): unknown {
  const request = JSON.parse(e.postData.contents) as SyncRequest;
  const response = handleSyncRequest(request);
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function handleSyncRequest(request: SyncRequest): SyncResponse | DebugDumpResponse {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expectedSecret || request.sharedSecret !== expectedSecret) {
    return { syncId: request.syncId, result: 'SYNC_REJECTED' };
  }

  if (request.action === 'SNAPSHOT') {
    // Read-only, like DEBUG_DUMP: one page of full records for a "Google → this device" overwrite.
    return snapshot(request);
  }

  if (request.action === 'DEBUG_DUMP') {
    // Read-only inspection of tab contents, for setup verification. Never
    // used by the app itself — no lock needed since nothing is written.
    return debugDump(request);
  }

  const outcome = withExclusiveLock(LOCK_TIMEOUT_MS, () => (request.action === 'REPLACE_PRUNE' ? prune(request) : processLocked(request)));
  if ('busy' in outcome) {
    return { syncId: request.syncId, result: 'SYNC_BUSY' };
  }
  return outcome;
}

function debugDump(request: SyncRequest): DebugDumpResponse {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const tabsToRead = request.debugTabs && request.debugTabs.length > 0 ? request.debugTabs : ENTITY_TABS_FOR_DEBUG;
  const tabs: DebugDumpResponse['tabs'] = {};
  for (const tab of tabsToRead) {
    const rows = readAllRows(spreadsheet, tab);
    tabs[tab] = Array.from(rows.values()).map((r) => ({
      id: r.id,
      version: r.version,
      body: safeParse(r.bodyJson),
    }));
  }
  return { syncId: request.syncId, result: 'DEBUG_DUMP', tabs };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

const ENTITY_TABS_FOR_DEBUG: EntityTab[] = [
  'Profile',
  'Category',
  'QuizItem',
  'Exercise',
  'Assignment',
  'Rotation',
  'Attempt',
  'AnswerResult',
  'Reward',
  'PointRedemption',
];

function processLocked(request: SyncRequest): SyncResponse {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const metadata = readMetadata(spreadsheet);
  if (!isSchemaCompatible(metadata, CLIENT_SUPPORTED_SCHEMA_VERSION)) {
    return { syncId: request.syncId, result: 'SYNC_REJECTED', schemaCompatible: false };
  }

  // Ids/versions/positions only — bodies are read per row when needed (see readIndex).
  const tabCache = new Map<EntityTab, Map<string, StoredRow>>();
  const getTab = (tab: EntityTab) => {
    if (!tabCache.has(tab)) tabCache.set(tab, readIndex(spreadsheet, tab));
    return tabCache.get(tab)!;
  };
  const bodyOf = (tab: EntityTab, row: StoredRow | undefined) =>
    row?.rowIndex !== undefined && row.bodyJson === '' ? readRowBody(spreadsheet, tab, row.rowIndex) : row?.bodyJson;

  const priorCommit = findPriorCommit(spreadsheet, request.syncId);
  if (priorCommit) {
    const replay = JSON.parse(priorCommit.resultJson) as SyncResponse;
    return addPull(spreadsheet, request, replay, readMetadata(spreadsheet).dataRevision);
  }

  // Group changes so a changeGroupId commits or rejects atomically (FR-060).
  const byGroup = new Map<string, ChangeInput[]>();
  for (const change of request.changes) {
    const group = byGroup.get(change.changeGroupId) ?? [];
    group.push(change);
    byGroup.set(change.changeGroupId, group);
  }

  const committedGroupIds: string[] = [];
  const conflicts: SyncResponse['conflicts'] = [];
  const downloads: SyncResponse['downloads'] = [];
  /** Records written by this request, per tab — only these rows are written back and logged. */
  const changedIds = new Map<EntityTab, Set<string>>();
  const markChanged = (tab: EntityTab, id: string) => {
    if (!changedIds.has(tab)) changedIds.set(tab, new Set());
    changedIds.get(tab)!.add(id);
  };

  // "This device → Google" overwrite: every record is written as sent, whatever Google holds (no version checks, no conflicts).
  const overwrite = request.action === 'REPLACE_GOOGLE_WITH_LOCAL';
  const versions: Record<string, number> = {};

  for (const [groupId, changes] of byGroup) {
    const decisions = changes.map((change) => {
      const rows = getTab(change.entityType);
      const existing = rows.get(change.entityId);
      const googleVersion = existing?.version ?? 0;
      return {
        change,
        googleVersion,
        decision: overwrite
          ? ('upload' as const)
          : decideVersion({
              localVersion: change.localVersion,
              lastGoogleVersion: change.lastGoogleVersion,
              googleVersion,
            }),
      };
    });

    const hasInvalid = decisions.some((d) => d.decision === 'invalid');
    if (hasInvalid) {
      return { syncId: request.syncId, result: 'SYNC_REJECTED' };
    }

    // Leftovers of an earlier sync that failed after writing (identical content) are adopted, not reported.
    for (const d of decisions) {
      if (d.decision !== 'conflict' || d.change.operation !== 'upsert') continue;
      const rows = getTab(d.change.entityType);
      const adopted = adoptIdenticalVersion(d.change.localVersion, d.googleVersion, bodyOf(d.change.entityType, rows.get(d.change.entityId)), JSON.stringify(d.change.payload));
      if (adopted !== undefined) {
        const existing = rows.get(d.change.entityId);
        rows.set(d.change.entityId, { id: d.change.entityId, version: adopted, bodyJson: JSON.stringify(d.change.payload), rowIndex: existing?.rowIndex });
        markChanged(d.change.entityType, d.change.entityId);
        d.decision = 'noop';
      }
    }

    const hasConflict = decisions.some((d) => d.decision === 'conflict');
    if (hasConflict) {
      for (const d of decisions.filter((x) => x.decision === 'conflict')) {
        conflicts!.push({
          entityType: d.change.entityType,
          entityId: d.change.entityId,
          localVersion: d.change.localVersion,
          googleVersion: d.googleVersion,
          lastGoogleVersion: d.change.lastGoogleVersion,
        });
      }
      continue; // whole group excluded from commit (FR-060)
    }

    for (const d of decisions) {
      const rows = getTab(d.change.entityType);
      if (d.decision === 'upload') {
        // A delete keeps the full record (with its deletedAt tombstone) so other devices pulling it delete it too.
        const existing = rows.get(d.change.entityId);
        // The client's own version (always ≥ G + 1 here, since L > B = G): the client records exactly this
        // as lastGoogleVersion, so both sides agree on the next sync.
        const version = Math.max(d.googleVersion + 1, d.change.localVersion);
        rows.set(d.change.entityId, {
          id: d.change.entityId,
          version,
          bodyJson: JSON.stringify(d.change.payload),
          rowIndex: existing?.rowIndex,
        });
        markChanged(d.change.entityType, d.change.entityId);
        if (overwrite) versions[d.change.entityId] = version;
      } else if (d.decision === 'download') {
        const row = rows.get(d.change.entityId);
        if (row) {
          downloads!.push({ entityType: d.change.entityType, entityId: d.change.entityId, version: row.version, payload: JSON.parse(bodyOf(d.change.entityType, row)!) });
        }
      }
      // 'noop' requires no action.
    }
    committedGroupIds.push(groupId);
  }

  for (const [tab, ids] of changedIds) {
    writeChangedRows(spreadsheet, tab, getTab(tab), ids);
  }

  // A request that wrote nothing (e.g. a pure pull) creates no revision and no transaction record.
  const wroteSomething = changedIds.size > 0;
  const commitSequence = wroteSomething ? reserveNextRevision(spreadsheet) : metadata.dataRevision;
  if (wroteSomething) {
    const entries: ChangeLogEntry[] = [];
    for (const [tab, ids] of changedIds) {
      for (const id of ids) entries.push({ revision: commitSequence, entityType: tab, entityId: id, deviceId: request.deviceId });
    }
    appendChangeLog(spreadsheet, entries);
  }

  const response: SyncResponse = {
    syncId: request.syncId,
    result: 'SYNC_SUCCESS',
    commitSequence,
    committedChangeGroupIds: committedGroupIds,
    conflicts,
    downloads,
    schemaCompatible: true,
    ...(overwrite ? { versions } : {}),
  };
  if (wroteSomething) {
    // Persist the final response so a retried syncId can replay it verbatim (FR-059).
    saveCommittedTransaction(spreadsheet, request.syncId, commitSequence, JSON.stringify(response));
  }
  return addPull(spreadsheet, request, response, commitSequence);
}

/** Adds other devices' changes after `request.pullSince` (one page) to the response. Read-only. */
function addPull(
  spreadsheet: GoogleSpreadsheet,
  request: SyncRequest,
  response: SyncResponse,
  currentRevision: number,
): SyncResponse {
  if (typeof request.pullSince !== 'number') return response;
  const page = selectPull(readChangeLogAfter(spreadsheet, request.pullSince), request.pullSince, request.deviceId, PULL_LIMIT, currentRevision, request.pullTypes);
  const pulled: NonNullable<SyncResponse['downloads']> = [];
  // Only the rows being sent are read (see readRowBodies), never a whole tab.
  const byTab = new Map<EntityTab, string[]>();
  for (const { entityType, entityId } of page.records) byTab.set(entityType, [...(byTab.get(entityType) ?? []), entityId]);
  for (const [tab, ids] of byTab) {
    const index = readIndex(spreadsheet, tab);
    const rows = ids.map((id) => index.get(id)).filter((row): row is StoredRow => row?.rowIndex !== undefined);
    const bodies = readRowBodies(spreadsheet, tab, rows.map((row) => row.rowIndex!));
    for (const row of rows) {
      pulled.push({ entityType: tab, entityId: row.id, version: row.version, payload: safeParse(bodies.get(row.rowIndex!) ?? '') });
    }
  }
  return { ...response, downloads: [...(response.downloads ?? []), ...pulled], dataRevision: page.nextRevision, hasMore: page.hasMore };
}

/**
 * Last step of a "this device → Google" overwrite: rows of the given types that
 * the device does not have become deleted tombstones (deletedAt set, version
 * bumped, logged), so Google matches the device and other devices delete them
 * too on their next pull. Rows that are already tombstones are left alone.
 */
function prune(request: SyncRequest): SyncResponse {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const priorCommit = findPriorCommit(spreadsheet, request.syncId);
  if (priorCommit) return JSON.parse(priorCommit.resultJson) as SyncResponse;

  const deletedAt = new Date().toISOString();
  const changed: Array<{ tab: EntityTab; rows: Map<string, StoredRow>; ids: string[] }> = [];
  for (const [tab, keepList] of Object.entries(request.keepIds ?? {}) as Array<[EntityTab, string[]]>) {
    const keep = new Set(keepList);
    const rows = readIndex(spreadsheet, tab);
    const candidates = Array.from(rows.values()).filter((row) => !keep.has(row.id) && row.rowIndex !== undefined);
    if (candidates.length === 0) continue;
    const bodies = readRowBodies(spreadsheet, tab, candidates.map((row) => row.rowIndex!));
    const ids: string[] = [];
    for (const row of candidates) {
      const parsed = safeParse(bodies.get(row.rowIndex!) ?? '');
      const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { id: row.id };
      if (body['deletedAt']) continue;
      rows.set(row.id, { id: row.id, version: row.version + 1, bodyJson: JSON.stringify({ ...body, deletedAt }), rowIndex: row.rowIndex });
      ids.push(row.id);
    }
    if (ids.length > 0) changed.push({ tab, rows, ids });
  }

  const removed = changed.reduce((sum, c) => sum + c.ids.length, 0);
  let commitSequence = readMetadata(spreadsheet).dataRevision;
  if (removed > 0) {
    for (const { tab, rows, ids } of changed) writeChangedRows(spreadsheet, tab, rows, new Set(ids));
    commitSequence = reserveNextRevision(spreadsheet);
    const entries: ChangeLogEntry[] = [];
    for (const { tab, ids } of changed) {
      for (const id of ids) entries.push({ revision: commitSequence, entityType: tab, entityId: id, deviceId: request.deviceId });
    }
    appendChangeLog(spreadsheet, entries);
  }
  const response: SyncResponse = {
    syncId: request.syncId,
    result: 'SYNC_SUCCESS',
    commitSequence,
    committedChangeGroupIds: [],
    conflicts: [],
    downloads: [],
    schemaCompatible: true,
    removed,
  };
  if (removed > 0) saveCommittedTransaction(spreadsheet, request.syncId, commitSequence, JSON.stringify(response));
  return response;
}

/** Rows per SNAPSHOT page — whole records, so kept moderate for Apps Script's response size and run time. */
const SNAPSHOT_PAGE_ROWS = 400;

/**
 * One page of every record (tombstones included) of the requested tabs, in
 * sheet order, for a "Google → this device" overwrite. Read-only. The cursor
 * walks the tabs one after another; `dataRevision` lets the device carry on
 * with incremental pulls from this point afterwards.
 */
function snapshot(request: SyncRequest): SyncResponse {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const types = (request.snapshotTypes ?? []) as EntityTab[];
  let { typeIndex, offset } = request.snapshotCursor ?? { typeIndex: 0, offset: 0 };
  const dataRevision = readMetadata(spreadsheet).dataRevision;
  const downloads: NonNullable<SyncResponse['downloads']> = [];

  while (typeIndex < types.length && downloads.length === 0) {
    const tab = types[typeIndex];
    const rows = Array.from(readIndex(spreadsheet, tab).values())
      .filter((row) => row.rowIndex !== undefined)
      .sort((a, b) => a.rowIndex! - b.rowIndex!);
    const page = rows.slice(offset, offset + SNAPSHOT_PAGE_ROWS);
    if (page.length > 0) {
      const bodies = readRowBodies(spreadsheet, tab, page.map((row) => row.rowIndex!));
      for (const row of page) {
        downloads.push({ entityType: tab, entityId: row.id, version: row.version, payload: safeParse(bodies.get(row.rowIndex!) ?? '') });
      }
    }
    if (offset + SNAPSHOT_PAGE_ROWS < rows.length) {
      offset += SNAPSHOT_PAGE_ROWS;
    } else {
      typeIndex++;
      offset = 0;
    }
  }

  return {
    syncId: request.syncId,
    result: 'SYNC_SUCCESS',
    downloads,
    schemaCompatible: true,
    dataRevision,
    ...(typeIndex < types.length ? { nextCursor: { typeIndex, offset } } : {}),
  };
}
