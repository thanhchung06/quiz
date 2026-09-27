/**
 * @jest-environment node
 */
import { MAX_CELL_CHARS, readAllRows, splitBody, writeAllRows, StoredRow } from '../../apps-script/src/sheets/generic-table';

/** In-memory stand-in for a Google Sheet that enforces the real 50,000-characters-per-cell limit. */
function fakeSpreadsheet() {
  const grid: unknown[][] = [];
  const sheet = {
    getLastRow: () => {
      for (let r = grid.length; r > 0; r--) if ((grid[r - 1] ?? []).some((v) => v !== '' && v !== undefined)) return r;
      return 0;
    },
    getLastColumn: () => {
      let max = 0;
      for (const row of grid) row.forEach((v, c) => { if (v !== '' && v !== undefined) max = Math.max(max, c + 1); });
      return max;
    },
    getRange: (row: number, col: number, numRows = 1, numCols = 1) => ({
      getValues: () => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => grid[row - 1 + r]?.[col - 1 + c] ?? '')),
      setValues: (values: unknown[][]) => {
        values.forEach((vals, r) => vals.forEach((v, c) => {
          if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
          (grid[row - 1 + r] ??= [])[col - 1 + c] = v;
        }));
      },
    }),
  };
  return { getSheetByName: () => sheet, insertSheet: () => sheet } as unknown as GoogleSpreadsheet;
}

describe('Apps Script row storage', () => {
  it('splits bodies longer than one cell and joins them back', () => {
    expect(splitBody('short')).toEqual(['short']);
    const long = 'x'.repeat(MAX_CELL_CHARS * 2 + 10);
    expect(splitBody(long).map((p) => p.length)).toEqual([MAX_CELL_CHARS, MAX_CELL_CHARS, 10]);
  });

  it('stores a 120,000-character body (e.g. a big sync result) without hitting the 50,000 cell limit', () => {
    const ss = fakeSpreadsheet();
    const big = JSON.stringify({ committedChangeGroupIds: Array.from({ length: 3000 }, (_, i) => `id-${i}-${'0'.repeat(30)}`) });
    const rows = new Map<string, StoredRow>([
      ['small', { id: 'small', version: 1, bodyJson: '{"a":1}' }],
      ['big', { id: 'big', version: 2, bodyJson: big }],
    ]);
    writeAllRows(ss, 'SyncTransactions', rows);
    const back = readAllRows(ss, 'SyncTransactions');
    expect(back.get('big')?.bodyJson).toBe(big);
    expect(back.get('small')).toEqual({ id: 'small', version: 1, bodyJson: '{"a":1}' });
  });

  it('rewriting with shorter bodies leaves no stale chunks behind', () => {
    const ss = fakeSpreadsheet();
    writeAllRows(ss, 'Attempts', new Map([['a', { id: 'a', version: 1, bodyJson: 'y'.repeat(100000) }]]));
    writeAllRows(ss, 'Attempts', new Map([['a', { id: 'a', version: 2, bodyJson: '{"done":true}' }]]));
    expect(readAllRows(ss, 'Attempts').get('a')).toEqual({ id: 'a', version: 2, bodyJson: '{"done":true}' });
  });
});
