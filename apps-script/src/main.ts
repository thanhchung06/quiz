import { withExclusiveLock } from './lock';
import { adoptIdenticalVersion, decideVersion } from './versioning';
import { findPriorCommit, reserveNextRevision, saveCommittedTransaction } from './transactions';
import { readMetadata, isSchemaCompatible } from './sheets/metadata';
import { readAllRows, writeAllRows, StoredRow } from './sheets/generic-table';
import { EntityTab } from './sheets/entity-tabs';

const CLIENT_SUPPORTED_SCHEMA_VERSION = 1;
const LOCK_TIMEOUT_MS = 5000;

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
  action: 'SYNC_NORMAL' | 'REPLACE_GOOGLE_WITH_LOCAL' | 'REPLACE_LOCAL_WITH_GOOGLE' | 'RESOLVE_CONFLICT' | 'DEBUG_DUMP';
  changes: ChangeInput[];
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

  if (request.action === 'DEBUG_DUMP') {
    // Read-only inspection of tab contents, for setup verification. Never
    // used by the app itself — no lock needed since nothing is written.
    return debugDump(request);
  }

  const outcome = withExclusiveLock(LOCK_TIMEOUT_MS, () => processLocked(request));
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
  'Profiles',
  'Categories',
  'QuizItems',
  'Exercises',
  'Assignments',
  'Rotations',
  'Attempts',
  'AnswerResults',
  'Rewards',
];

function processLocked(request: SyncRequest): SyncResponse {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const metadata = readMetadata(spreadsheet);
  if (!isSchemaCompatible(metadata, CLIENT_SUPPORTED_SCHEMA_VERSION)) {
    return { syncId: request.syncId, result: 'SYNC_REJECTED', schemaCompatible: false };
  }

  const priorCommit = findPriorCommit(spreadsheet, request.syncId);
  if (priorCommit) {
    return JSON.parse(priorCommit.resultJson) as SyncResponse;
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
  const tabCache = new Map<EntityTab, Map<string, StoredRow>>();

  const getTab = (tab: EntityTab) => {
    if (!tabCache.has(tab)) tabCache.set(tab, readAllRows(spreadsheet, tab));
    return tabCache.get(tab)!;
  };

  for (const [groupId, changes] of byGroup) {
    const decisions = changes.map((change) => {
      const rows = getTab(change.entityType);
      const existing = rows.get(change.entityId);
      const googleVersion = existing?.version ?? 0;
      return {
        change,
        googleVersion,
        decision: decideVersion({
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
      const adopted = adoptIdenticalVersion(d.change.localVersion, d.googleVersion, rows.get(d.change.entityId)?.bodyJson, JSON.stringify(d.change.payload));
      if (adopted !== undefined) {
        rows.set(d.change.entityId, { id: d.change.entityId, version: adopted, bodyJson: JSON.stringify(d.change.payload) });
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
        const nextVersion = d.googleVersion + 1;
        if (d.change.operation === 'delete') {
          rows.set(d.change.entityId, { id: d.change.entityId, version: nextVersion, bodyJson: JSON.stringify({ deleted: true }) });
        } else {
          rows.set(d.change.entityId, { id: d.change.entityId, version: nextVersion, bodyJson: JSON.stringify(d.change.payload) });
        }
      } else if (d.decision === 'download') {
        const row = rows.get(d.change.entityId);
        if (row) {
          downloads!.push({ entityType: d.change.entityType, entityId: d.change.entityId, version: row.version, payload: JSON.parse(row.bodyJson) });
        }
      }
      // 'noop' requires no action.
    }
    committedGroupIds.push(groupId);
  }

  for (const tab of tabCache.keys()) {
    writeAllRows(spreadsheet, tab, tabCache.get(tab)!);
  }

  const commitSequence = reserveNextRevision(spreadsheet);
  const response: SyncResponse = {
    syncId: request.syncId,
    result: 'SYNC_SUCCESS',
    commitSequence,
    committedChangeGroupIds: committedGroupIds,
    conflicts,
    downloads,
    schemaCompatible: true,
  };
  // Persist the final response so a retried syncId can replay it verbatim (FR-059).
  saveCommittedTransaction(spreadsheet, request.syncId, commitSequence, JSON.stringify(response));
  return response;
}
