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

/** Above this many in-place updates, one rewrite of the whole tab is cheaper than one Sheets call per row. */
const MAX_ROW_UPDATES = 40;

/**
 * Writes only the given records: changed rows in place (padded so a body that
 * got shorter leaves no stale chunks), new rows appended in one block. Keeps a
 * sync of a few records cheap no matter how big the tab has grown.
 */
export function writeChangedRows(spreadsheet: GoogleSpreadsheet, tabName: string, rows: Map<string, StoredRow>, changedIds: Iterable<string>): void {
  const changed = Array.from(new Set(changedIds))
    .map((id) => rows.get(id))
    .filter((row): row is StoredRow => !!row);
  if (changed.length === 0) return;

  const updates = changed.filter((row) => row.rowIndex !== undefined);
  if (updates.length > MAX_ROW_UPDATES) {
    writeAllRows(spreadsheet, tabName, rows);
    return;
  }

  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const lastColumn = Math.max(3, sheet.getLastColumn());
  for (const row of updates) {
    const cells: unknown[] = [row.id, row.version, ...splitBody(row.bodyJson)];
    const width = Math.max(lastColumn, cells.length);
    sheet.getRange(row.rowIndex!, 1, 1, width).setValues([[...cells, ...Array(width - cells.length).fill('')]]);
  }

  const appends = changed.filter((row) => row.rowIndex === undefined);
  if (appends.length > 0) {
    const firstRow = sheet.getLastRow() + 1;
    const cells = appends.map((row) => [row.id, row.version, ...splitBody(row.bodyJson)] as unknown[]);
    const width = Math.max(3, ...cells.map((c) => c.length));
    sheet.getRange(firstRow, 1, cells.length, width).setValues(cells.map((c) => [...c, ...Array(width - c.length).fill('')]));
    appends.forEach((row, i) => (row.rowIndex = firstRow + i));
  }
}
