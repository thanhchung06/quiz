/**
 * Generic per-tab row storage: column A is the record id, column B its
 * current Google version, column C the JSON-serialized record body
 * (everything except id/version, which are tracked structurally). One tab
 * per entity type per the spreadsheet structure in spec.md.
 */
export interface StoredRow {
  id: string;
  version: number;
  bodyJson: string;
}

function getOrCreateSheet(spreadsheet: GoogleSpreadsheet, tabName: string): GoogleSheet {
  return spreadsheet.getSheetByName(tabName) ?? spreadsheet.insertSheet(tabName);
}

export function readAllRows(spreadsheet: GoogleSpreadsheet, tabName: string): Map<string, StoredRow> {
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const lastRow = sheet.getLastRow();
  const result = new Map<string, StoredRow>();
  if (lastRow === 0) return result;

  const values = sheet.getRange(1, 1, lastRow, 3).getValues();
  for (const [id, version, bodyJson] of values) {
    if (!id) continue;
    result.set(String(id), { id: String(id), version: Number(version), bodyJson: String(bodyJson) });
  }
  return result;
}

/** Rewrites the entire tab from the given row map (small-scale, single-household dataset per spec Scale/Scope). */
export function writeAllRows(spreadsheet: GoogleSpreadsheet, tabName: string, rows: Map<string, StoredRow>): void {
  const sheet = getOrCreateSheet(spreadsheet, tabName);
  const values = Array.from(rows.values()).map((r) => [r.id, r.version, r.bodyJson]);
  const lastRow = sheet.getLastRow();
  if (lastRow > 0) {
    sheet.getRange(1, 1, lastRow, 3).setValues(Array(lastRow).fill(['', '', '']));
  }
  if (values.length > 0) {
    sheet.getRange(1, 1, values.length, 3).setValues(values);
  }
}
