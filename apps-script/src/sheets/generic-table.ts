/**
 * Generic per-tab row storage: column A is the record id, column B its
 * current Google version, column C onward the JSON-serialized record body
 * (split over C, D, E… when longer than one cell allows — see splitBody)
 * (everything except id/version, which are tracked structurally). One tab
 * per entity type per the spreadsheet structure in spec.md.
 */
export interface StoredRow {
  id: string;
  version: number;
  bodyJson: string;
  /** 1-based sheet row this record was read from / written to; absent for a record not yet in the sheet. */
  rowIndex?: number;
}

function getOrCreateSheet(spreadsheet: GoogleSpreadsheet, tabName: string): GoogleSheet {
  return spreadsheet.getSheetByName(tabName) ?? spreadsheet.insertSheet(tabName);
}

/**
 * Google Sheets rejects any cell over 50,000 characters, and some bodies are
 * bigger than that (an Attempt snapshots every question it contains; a large
 * sync's stored response lists every committed id). So a long body is split
 * across consecutive cells C, D, E… of its row and joined again on read.
 */
export const MAX_CELL_CHARS = 45000;

export function splitBody(bodyJson: string): string[] {
  if (bodyJson.length <= MAX_CELL_CHARS) return [bodyJson];
  const parts: string[] = [];
  for (let i = 0; i < bodyJson.length; i += MAX_CELL_CHARS) parts.push(bodyJson.slice(i, i + MAX_CELL_CHARS));
  return parts;
}

export function readAllRows(spreadsheet: GoogleSpreadsheet, tabName: string): Map<string, StoredRow> {
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const lastRow = sheet.getLastRow();
  const result = new Map<string, StoredRow>();
  if (lastRow === 0) return result;

  const width = Math.max(3, sheet.getLastColumn());
  const values = sheet.getRange(1, 1, lastRow, width).getValues();
  values.forEach(([id, version, ...bodyParts], index) => {
    if (!id) return;
    result.set(String(id), {
      id: String(id),
      version: Number(version),
      bodyJson: bodyParts.map((part) => String(part ?? '')).join(''),
      rowIndex: index + 1,
    });
  });
  return result;
}

/** Rewrites the entire tab from the given row map (small-scale, single-household dataset per spec Scale/Scope). */
export function writeAllRows(spreadsheet: GoogleSpreadsheet, tabName: string, rows: Map<string, StoredRow>): void {
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const split = Array.from(rows.values()).map((r) => [r.id, r.version, ...splitBody(r.bodyJson)] as unknown[]);
  const width = Math.max(3, ...split.map((row) => row.length));
  const values = split.map((row) => [...row, ...Array(width - row.length).fill('')]);

  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(3, sheet.getLastColumn());
  if (lastRow > 0) {
    sheet.getRange(1, 1, lastRow, lastColumn).setValues(Array.from({ length: lastRow }, () => Array(lastColumn).fill('')));
  }
  if (values.length > 0) {
    sheet.getRange(1, 1, values.length, width).setValues(values);
  }
  Array.from(rows.values()).forEach((row, index) => (row.rowIndex = index + 1));
}

/**
 * Only ids, versions and row positions (columns A:B) — what a sync needs to
 * decide upload / no-op / conflict. Reading every body of a tab with thousands
 * of long questions on each request was the slow part of a sync; bodies are
 * read one row at a time with readRowBody when actually needed. Rows from
 * here have an EMPTY bodyJson: never write them back unless you set it.
 */
export function readIndex(spreadsheet: GoogleSpreadsheet, tabName: string): Map<string, StoredRow> {
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const lastRow = sheet.getLastRow();
  const result = new Map<string, StoredRow>();
  if (lastRow === 0) return result;
  sheet
    .getRange(1, 1, lastRow, 2)
    .getValues()
    .forEach(([id, version], index) => {
      if (id) result.set(String(id), { id: String(id), version: Number(version), bodyJson: '', rowIndex: index + 1 });
    });
  return result;
}

/** The full body stored in one row (columns C onward, joined). */
export function readRowBody(spreadsheet: GoogleSpreadsheet, tabName: string, rowIndex: number): string {
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const width = Math.max(3, sheet.getLastColumn());
  const [row] = sheet.getRange(rowIndex, 1, 1, width).getValues();
  return row
    .slice(2)
    .map((part) => String(part ?? ''))
    .join('');
}

/** Rows closer together than this are read in one call (reading a few extra rows beats one call per row). */
const READ_GAP = 20;

/**
 * Bodies of the given rows only, keyed by row index — for sending a page of
 * pulled records without reading every body of a large tab.
 */
export function readRowBodies(spreadsheet: GoogleSpreadsheet, tabName: string, rowIndexes: number[]): Map<number, string> {
  const result = new Map<number, string>();
  const wanted = Array.from(new Set(rowIndexes)).sort((a, b) => a - b);
  if (wanted.length === 0) return result;
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const width = Math.max(3, sheet.getLastColumn());
  for (let i = 0; i < wanted.length; ) {
    let j = i + 1;
    while (j < wanted.length && wanted[j] - wanted[j - 1] <= READ_GAP) j++;
    const first = wanted[i];
    const values = sheet.getRange(first, 1, wanted[j - 1] - first + 1, width).getValues();
    for (const rowIndex of wanted.slice(i, j)) {
      result.set(
        rowIndex,
        values[rowIndex - first]
          .slice(2)
          .map((part) => String(part ?? ''))
          .join(''),
      );
    }
    i = j;
  }
  return result;
}

/**
 * Writes only the given records: rows that already exist in place — adjacent
 * ones together in one call — padded so a body that got shorter leaves no
 * stale chunks; new rows appended in one block. Keeps a sync cheap no matter
 * how big the tab has grown. Every record written must carry its real body.
 */
export function writeChangedRows(spreadsheet: GoogleSpreadsheet, tabName: string, rows: Map<string, StoredRow>, changedIds: Iterable<string>): void {
  const changed = Array.from(new Set(changedIds))
    .map((id) => rows.get(id))
    .filter((row): row is StoredRow => !!row);
  if (changed.length === 0) return;

  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const lastColumn = Math.max(3, sheet.getLastColumn());
  const cellsOf = (row: StoredRow): unknown[] => [row.id, row.version, ...splitBody(row.bodyJson)];

  const updates = changed.filter((row) => row.rowIndex !== undefined).sort((a, b) => a.rowIndex! - b.rowIndex!);
  for (let i = 0; i < updates.length; ) {
    let j = i + 1;
    while (j < updates.length && updates[j].rowIndex === updates[j - 1].rowIndex! + 1) j++;
    const run = updates.slice(i, j).map(cellsOf);
    const width = Math.max(lastColumn, ...run.map((c) => c.length));
    sheet.getRange(updates[i].rowIndex!, 1, run.length, width).setValues(run.map((c) => [...c, ...Array(width - c.length).fill('')]));
    i = j;
  }

  const appends = changed.filter((row) => row.rowIndex === undefined);
  if (appends.length > 0) {
    const firstRow = sheet.getLastRow() + 1;
    const cells = appends.map(cellsOf);
    const width = Math.max(3, ...cells.map((c) => c.length));
    sheet.getRange(firstRow, 1, cells.length, width).setValues(cells.map((c) => [...c, ...Array(width - c.length).fill('')]));
    appends.forEach((row, i) => (row.rowIndex = firstRow + i));
  }
}
