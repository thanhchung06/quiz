/**
 * Change log for pulling (tab "ChangeLog"): one row per committed record
 * change — [revision, entityType, entityId, deviceId]. Rows are only ever
 * appended, in revision order, so a device can ask "what changed after
 * revision N?" and receive other devices' records without re-reading
 * everything it already has.
 */
const TAB = 'ChangeLog';

export interface ChangeLogEntry {
  revision: number;
  entityType: string;
  entityId: string;
  deviceId: string;
}

function getSheet(spreadsheet: GoogleSpreadsheet): GoogleSheet {
  return spreadsheet.getSheetByName(TAB) ?? spreadsheet.insertSheet(TAB);
}

export function appendChangeLog(spreadsheet: GoogleSpreadsheet, entries: ChangeLogEntry[]): void {
  if (entries.length === 0) return;
  const sheet = getSheet(spreadsheet);
  sheet
    .getRange(sheet.getLastRow() + 1, 1, entries.length, 4)
    .setValues(entries.map((e) => [e.revision, e.entityType, e.entityId, e.deviceId]));
}

export function readChangeLog(spreadsheet: GoogleSpreadsheet): ChangeLogEntry[] {
  const sheet = getSheet(spreadsheet);
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return [];
  return sheet
    .getRange(1, 1, lastRow, 4)
    .getValues()
    .filter(([revision, , entityId]) => revision !== '' && entityId !== '')
    .map(([revision, entityType, entityId, deviceId]) => ({
      revision: Number(revision),
      entityType: String(entityType),
      entityId: String(entityId),
      deviceId: String(deviceId),
    }));
}

export interface PullPage {
  /** Records to send, each at most once (its latest state is read from its tab). */
  records: Array<{ entityType: string; entityId: string }>;
  /** What the device should remember as "pulled up to". */
  nextRevision: number;
  hasMore: boolean;
}

/**
 * Picks the changes after `since` made by other devices, whole revisions at a
 * time, until about `limit` records. Its own changes are skipped (the device
 * already has them) but still counted as seen via `nextRevision`.
 */
export function selectPull(entries: ChangeLogEntry[], since: number, deviceId: string, limit: number, currentRevision: number): PullPage {
  const newer = entries.filter((e) => e.revision > since).sort((a, b) => a.revision - b.revision);
  const seen = new Set<string>();
  const records: PullPage['records'] = [];
  let nextRevision = currentRevision;
  let hasMore = false;
  for (let i = 0; i < newer.length; i++) {
    const entry = newer[i];
    const startsNewRevision = i === 0 || entry.revision !== newer[i - 1].revision;
    if (startsNewRevision && records.length >= limit) {
      nextRevision = newer[i - 1].revision;
      hasMore = true;
      break;
    }
    if (entry.deviceId === deviceId) continue;
    const key = entry.entityType + '\u0000' + entry.entityId;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ entityType: entry.entityType, entityId: entry.entityId });
  }
  return { records, nextRevision, hasMore };
}
