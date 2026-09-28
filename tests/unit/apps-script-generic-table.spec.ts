/**
 * @jest-environment node
 */
import { MAX_CELL_CHARS, readAllRows, readIndex, readRowBody, splitBody, writeAllRows, writeChangedRows, StoredRow } from '../../apps-script/src/sheets/generic-table';

/** In-memory stand-in for a Google Sheet that enforces the real 50,000-characters-per-cell limit. */
function fakeSpreadsheet() {
  const grid: unknown[][] = [];
  let writes = 0;
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
        writes++;
        values.forEach((vals, r) => vals.forEach((v, c) => {
          if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
          (grid[row - 1 + r] ??= [])[col - 1 + c] = v;
        }));
      },
    }),
  };
  const spreadsheet = { getSheetByName: () => sheet, insertSheet: () => sheet } as unknown as GoogleSpreadsheet;
  return Object.assign(spreadsheet, { writes: () => writes, grid });
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
    expect(back.get('small')).toEqual({ id: 'small', version: 1, bodyJson: '{"a":1}', rowIndex: 1 });
  });

  it('rewriting with shorter bodies leaves no stale chunks behind', () => {
    const ss = fakeSpreadsheet();
    writeAllRows(ss, 'Attempts', new Map([['a', { id: 'a', version: 1, bodyJson: 'y'.repeat(100000) }]]));
    writeAllRows(ss, 'Attempts', new Map([['a', { id: 'a', version: 2, bodyJson: '{"done":true}' }]]));
    expect(readAllRows(ss, 'Attempts').get('a')).toEqual({ id: 'a', version: 2, bodyJson: '{"done":true}', rowIndex: 1 });
  });
});

describe('incremental writes', () => {
  function seeded(n: number) {
    const ss = fakeSpreadsheet() as GoogleSpreadsheet & { writes: () => number };
    const rows = new Map<string, StoredRow>(Array.from({ length: n }, (_, i) => [`q${i}`, { id: `q${i}`, version: 1, bodyJson: `{"n":${i}}` }]));
    writeAllRows(ss, 'QuizItem', rows);
    return { ss, rows: readAllRows(ss, 'QuizItem') };
  }

  it('updates changed rows in place and appends new ones, without rewriting the tab', () => {
    const { ss, rows } = seeded(1000);
    const before = ss.writes();
    rows.set('q5', { ...rows.get('q5')!, version: 2, bodyJson: '{"n":"edited"}' });
    rows.set('new1', { id: 'new1', version: 1, bodyJson: '{"n":"new"}' });
    writeChangedRows(ss, 'QuizItem', rows, ['q5', 'new1']);
    expect(ss.writes() - before).toBe(2); // one row update + one append block
    const back = readAllRows(ss, 'QuizItem');
    expect(back.size).toBe(1001);
    expect(back.get('q5')).toMatchObject({ version: 2, bodyJson: '{"n":"edited"}', rowIndex: 6 });
    expect(back.get('new1')).toMatchObject({ bodyJson: '{"n":"new"}', rowIndex: 1001 });
  });

  it('writes a run of adjacent updated rows in a single call', () => {
    const { ss, rows } = seeded(500);
    const before = ss.writes();
    const ids = Array.from({ length: 100 }, (_, i) => `q${200 + i}`);
    for (const id of ids) rows.set(id, { ...rows.get(id)!, version: 2, bodyJson: `{"edited":"${id}"}` });
    writeChangedRows(ss, 'QuizItem', rows, ids);
    expect(ss.writes() - before).toBe(1);
    const back = readAllRows(ss, 'QuizItem');
    expect(back.get('q250')).toMatchObject({ version: 2, bodyJson: '{"edited":"q250"}' });
    expect(back.get('q199')).toMatchObject({ version: 1, bodyJson: '{"n":199}' });
  });

  it('reads only ids and versions for the index, and single bodies on demand', () => {
    const { ss } = seeded(3);
    const index = readIndex(ss, 'QuizItem');
    expect(index.get('q1')).toEqual({ id: 'q1', version: 1, bodyJson: '', rowIndex: 2 });
    expect(readRowBody(ss, 'QuizItem', 2)).toBe('{"n":1}');
  });

  it('clears leftover chunks when an updated body gets shorter', () => {
    const ss = fakeSpreadsheet();
    writeAllRows(ss, 'Attempt', new Map([['a', { id: 'a', version: 1, bodyJson: 'z'.repeat(100000) }]]));
    const rows = readAllRows(ss, 'Attempt');
    rows.set('a', { ...rows.get('a')!, version: 2, bodyJson: '{"short":true}' });
    writeChangedRows(ss, 'Attempt', rows, ['a']);
    expect(readAllRows(ss, 'Attempt').get('a')?.bodyJson).toBe('{"short":true}');
  });
});
