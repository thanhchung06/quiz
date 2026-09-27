/**
 * @jest-environment node
 *
 * Scale check for the Apps Script sync code: with 50,000 long questions (and a
 * 50,000-entry change log) already in the sheet, a sync that sends or receives
 * a handful of records must read about the same, small amount of data — not
 * the whole tab.
 */
const cellsRead = { count: 0 };
function fakeSheet() {
  const grid: unknown[][] = [];
  const nonEmpty = (v: unknown) => v !== '' && v !== undefined && v !== null;
  let lastRowCache = -1;
  return {
    getLastRow: () => {
      if (lastRowCache >= 0) return lastRowCache;
      for (let r = grid.length; r > 0; r--) if ((grid[r - 1] ?? []).some(nonEmpty)) return (lastRowCache = r);
      return (lastRowCache = 0);
    },
    getLastColumn: () => grid.reduce((m, row) => Math.max(m, row.length), 0),
    getRange: (row: number, col: number, numRows = 1, numCols = 1) => ({
      getValues: () => {
        cellsRead.count += numRows * numCols;
        return Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => grid[row - 1 + r]?.[col - 1 + c] ?? ''));
      },
      setValues: (values: unknown[][]) => {
        lastRowCache = -1;
        values.forEach((vals, r) => vals.forEach((v, c) => ((grid[row - 1 + r] ??= [])[col - 1 + c] = v)));
      },
    }),
  };
}
const sheets = new Map<string, ReturnType<typeof fakeSheet>>();
const spreadsheet = {
  getSheetByName: (name: string) => sheets.get(name) ?? null,
  insertSheet: (name: string) => (sheets.set(name, fakeSheet()), sheets.get(name)!),
};
Object.assign(globalThis, {
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'secret' }) },
  ContentService: { createTextOutput: (text: string) => ({ setMimeType: () => text }), MimeType: { JSON: 'json' } },
});

import { doPost } from '../../apps-script/src/main';

const N = 50_000;
const body = (i: number) => JSON.stringify({ prompt: `Câu ${i}`, passage: 'đoạn văn dài '.repeat(150) }); // ~2 KB each

function call(request: object): Record<string, unknown> {
  return JSON.parse(doPost({ postData: { contents: JSON.stringify({ sharedSecret: 'secret', action: 'SYNC_NORMAL', startedAt: '', lastKnownDataRevision: 0, ...request }) } } as never) as string);
}

describe('sync cost with 50,000 questions in the sheet', () => {
  beforeAll(() => {
    const quiz = spreadsheet.insertSheet('QuizItem');
    quiz.getRange(1, 1, N, 3).setValues(Array.from({ length: N }, (_, i) => [`q${i}`, 1, body(i)]));
    const log = spreadsheet.insertSheet('ChangeLog');
    log.getRange(1, 1, N, 4).setValues(Array.from({ length: N }, (_, i) => [1 + Math.floor(i / 500), 'QuizItem', `q${i}`, 'pc']));
    spreadsheet.insertSheet('Metadata').getRange(1, 1, 1, 3).setValues([['singleton', 1, JSON.stringify({ googleSchemaVersion: 1, dataRevision: 100 })]]);
  });

  it('uploading 5 edited questions reads only ids/versions, not 50,000 bodies', () => {
    cellsRead.count = 0;
    const changes = [10, 20, 30, 40, 49_999].map((i) => ({
      changeGroupId: `q${i}`, entityType: 'QuizItem', entityId: `q${i}`, localVersion: 2, lastGoogleVersion: 1, operation: 'upsert', payload: { prompt: `sửa ${i}` },
    }));
    const t0 = Date.now();
    const res = call({ syncId: 'up-1', deviceId: 'pc', changes });
    expect(res.result).toBe('SYNC_SUCCESS');
    expect(res.committedChangeGroupIds).toHaveLength(5);
    // Index of the 50,000-row tab = 100,000 cells (ids + versions); the bodies would be 150,000+ more.
    expect(cellsRead.count).toBeLessThan(2 * N + 5_000);
    console.log(`upload: ${cellsRead.count} cells read, ${Date.now() - t0} ms`);
  });

  it("a phone pulling the latest 10 changes reads the log's tail and 10 bodies, not the whole tab", () => {
    const changes = Array.from({ length: 10 }, (_, k) => ({
      changeGroupId: `n${k}`, entityType: 'QuizItem', entityId: `new${k}`, localVersion: 1, lastGoogleVersion: 0, operation: 'upsert', payload: { prompt: `mới ${k}` },
    }));
    const committed = call({ syncId: 'up-2', deviceId: 'pc', changes });
    const since = Number(committed.commitSequence) - 1;

    cellsRead.count = 0;
    const t0 = Date.now();
    const res = call({ syncId: 'pull-1', deviceId: 'phone', changes: [], pullSince: since, pullTypes: ['QuizItem', 'Category'] });
    expect((res.downloads as unknown[]).length).toBe(10);
    expect(res.hasMore).toBe(false);
    // Log column A (~50k) + the tab index (~100k) + a few rows — never the 50,000 bodies (~150k+ cells).
    expect(cellsRead.count).toBeLessThan(3 * N + 5_000);
    console.log(`pull 10: ${cellsRead.count} cells read, ${Date.now() - t0} ms`);
  });
});
