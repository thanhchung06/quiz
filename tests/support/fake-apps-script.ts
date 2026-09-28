/**
 * An in-memory Google Sheet (with Google's 50,000-characters-per-cell limit)
 * and the Apps Script globals the sync script uses, so the real script code
 * can run in Jest. Import this before the script.
 */
function fakeSheet() {
  const grid: unknown[][] = [];
  const nonEmpty = (v: unknown) => v !== '' && v !== undefined && v !== null;
  return {
    grid,
    getLastRow: () => {
      for (let r = grid.length; r > 0; r--) if ((grid[r - 1] ?? []).some(nonEmpty)) return r;
      return 0;
    },
    getLastColumn: () => grid.reduce((m, row) => Math.max(m, (row ?? []).reduce((c: number, v, i) => (nonEmpty(v) ? i + 1 : c), 0)), 0),
    getRange: (row: number, col: number, numRows = 1, numCols = 1) => ({
      getValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => grid[row - 1 + r]?.[col - 1 + c] ?? '')),
      setValues: (values: unknown[][]) =>
        values.forEach((vals, r) =>
          vals.forEach((v, c) => {
            if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
            (grid[row - 1 + r] ??= [])[col - 1 + c] = v;
          }),
        ),
    }),
    appendRow: (values: unknown[]) => grid.push(values),
  };
}

let uuidCount = 0;
export const sheets = new Map<string, ReturnType<typeof fakeSheet>>();
export let requestCount = 0;
const spreadsheet = {
  getSheetByName: (name: string) => sheets.get(name) ?? null,
  insertSheet: (name: string) => (sheets.set(name, fakeSheet()), sheets.get(name)!),
};
Object.assign(globalThis, {
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'secret' }) },
  Utilities: { getUuid: () => `uuid-${++uuidCount}` },
  ContentService: { createTextOutput: (text: string) => ({ setMimeType: () => text }), MimeType: { JSON: 'json' } },
});

export function resetSheets(): void {
  sheets.clear();
}

/** Number of data rows in a tab. */
export function rowCount(tab: string): number {
  return sheets.get(tab)?.getLastRow() ?? 0;
}
