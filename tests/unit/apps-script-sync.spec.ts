/**
 * @jest-environment node
 */
import { properties, resetSheets, rowCount } from '../support/fake-apps-script';
import { handle } from '../../apps-script/src/main';
import { JsonRecord, nextSyncHash, ReadSpec, SyncOp, SyncResponse } from '../../src/app/sync/protocol';

const write = (...ops: SyncOp[]) => handle({ action: 'WRITE', sharedSecret: 'secret', deviceId: 'd', ops }) as Extract<SyncResponse, { ok: true }>;
const read = (spec: ReadSpec) => handle({ action: 'READ', sharedSecret: 'secret', deviceId: 'd', read: spec }) as Extract<SyncResponse, { ok: true }>;
type FakeSheet = { getRange(row: number, col: number, rows?: number, cols?: number): { setValues(values: unknown[][]): void } };
const spreadsheetApp = () => (globalThis as unknown as { SpreadsheetApp: { getActiveSpreadsheet(): { insertSheet(name: string): FakeSheet } } }).SpreadsheetApp;
const rec = (id: string, extra: object = {}): JsonRecord => ({ id, ...extra });

describe('Apps Script sync (new layout)', () => {
  beforeEach(() => resetSheets());

  it('rejects a wrong secret and an older sheet layout', () => {
    expect(handle({ action: 'PING', sharedSecret: 'nope', deviceId: 'd' })).toEqual({ ok: false, error: 'BAD_SECRET' });
    // A sheet of the old layout: its Metadata tab says schema 1, and no metadata property exists yet.
    const metadata = spreadsheetApp().getActiveSpreadsheet().insertSheet('Metadata');
    metadata.getRange(1, 1, 1, 3).setValues([['singleton', 1, JSON.stringify({ googleSchemaVersion: 1, dataRevision: 5 })]]);
    expect(handle({ action: 'PING', sharedSecret: 'secret', deviceId: 'd' })).toEqual({ ok: false, error: 'SCHEMA_MISMATCH', sheetSchemaVersion: 1 });
  });

  it('PING never opens the spreadsheet once the metadata is in Script Properties; older tab metadata is moved there', () => {
    // A sheet this script wrote before the move: metadata still in its tab.
    spreadsheetApp()
      .getActiveSpreadsheet()
      .insertSheet('Metadata')
      .getRange(1, 1, 1, 3)
      .setValues([['singleton', 1, JSON.stringify({ schemaVersion: 2, sequences: { QuizItem: 7 }, nextResultId: 3, syncHash: 'abc' })]]);
    expect(handle({ action: 'PING', sharedSecret: 'secret', deviceId: 'd' })).toEqual({ ok: true, syncHash: 'abc' });
    expect(JSON.parse(properties.get('SYNC_METADATA')!)).toMatchObject({ sequences: { QuizItem: 7 }, syncHash: 'abc' });
    expect(write({ op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q') }).results![0].updateSequence).toBe(8);

    const open = jest.spyOn(spreadsheetApp(), 'getActiveSpreadsheet');
    handle({ action: 'PING', sharedSecret: 'secret', deviceId: 'd' });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('records get increasing updateSequence per sheet; pulls return those above a number; deletes are marks', () => {
    const r = write(
      { op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q1', { prompt: 'a' }) },
      { op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q2', { prompt: 'b' }) },
      { op: 'WRITE_RECORD', sheet: 'Exercise', record: rec('e1') },
    );
    expect(r.results!.map((x) => x.updateSequence)).toEqual([1, 2, 1]);
    expect(write({ op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q1', { prompt: 'a2', updateSequence: 99 }) }).results![0].updateSequence).toBe(3);

    const after1 = read({ mode: 'SEQUENCE_AFTER', sheet: 'QuizItem', after: 1 }).records!;
    expect(after1.map((q) => [q.id, q['updateSequence'], q['prompt']])).toEqual([
      ['q2', 2, 'b'],
      ['q1', 3, 'a2'],
    ]);
    expect(rowCount('QuizItem')).toBe(2); // overwritten in place

    // onlyIfAbsent (seeded defaults) never overwrites
    expect(write({ op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q2', { prompt: 'seed' }), onlyIfAbsent: true }).results![0]).toEqual({ updateSequence: 2, skipped: true });

    const pruned = write({ op: 'PRUNE', sheet: 'QuizItem', keepIds: ['q1'] }).results![0];
    expect(pruned.removed).toBe(1);
    const q2 = read({ mode: 'BY_ID', sheet: 'QuizItem', ids: ['q2'] }).records![0];
    expect(q2['deletedAt']).toBeTruthy();
    expect(q2['updateSequence']).toBe(4);
  });

  it('profile: parent overwrites fields, totalPoints is its own operation and survives a profile edit', () => {
    write({ op: 'WRITE_RECORD', sheet: 'Profile', record: rec('kid', { displayName: 'Nam', totalPoints: 0 }) });
    write({ op: 'SET_TOTAL_POINTS', profileId: 'kid', totalPoints: 120 });
    write({ op: 'WRITE_RECORD', sheet: 'Profile', record: rec('kid', { displayName: 'Nam Anh', totalPoints: 5 }) });
    const [kid] = read({ mode: 'ALL', sheet: 'Profile' }).records!;
    expect(kid).toMatchObject({ displayName: 'Nam Anh', totalPoints: 120 });
    expect(write({ op: 'SET_TOTAL_POINTS', profileId: 'ghost', totalPoints: 1 }).results![0].skipped).toBe(true);
  });

  it('assignments: add / remove / try count per child, all safe to repeat; a removed one never comes back', () => {
    const a1 = rec('a1', { exerciseSnapshot: { title: 'Bài 1' } });
    write({ op: 'ADD_ASSIGNMENT', childId: 'kid', assignment: a1 }, { op: 'ADD_ASSIGNMENT', childId: 'kid', assignment: rec('a2') });
    expect(write({ op: 'ADD_ASSIGNMENT', childId: 'kid', assignment: a1 }).results![0].skipped).toBe(true);
    write({ op: 'SET_TRY', childId: 'kid', assignmentId: 'a1', tries: 2 }, { op: 'SET_TRY', childId: 'kid', assignmentId: 'a1', tries: 1 });
    write({ op: 'REMOVE_ASSIGNMENT', childId: 'kid', assignmentId: 'a2' });
    expect(write({ op: 'REMOVE_ASSIGNMENT', childId: 'kid', assignmentId: 'a2' }).results![0].skipped).toBe(true);
    expect(write({ op: 'ADD_ASSIGNMENT', childId: 'kid', assignment: rec('a2') }).results![0].skipped).toBe(true);
    write({ op: 'ADD_ASSIGNMENT', childId: 'kid2', assignment: rec('b1') });

    const rows = read({ mode: 'ALL', sheet: 'Assignment' }).records!;
    expect(rows).toHaveLength(2);
    const kid = rows.find((r) => r.id === 'kid')!;
    expect(kid['assignments']).toEqual([{ ...a1, tries: 2 }]);
  });

  it('session: one per child; progress only for the current session; ended sessions are not read', () => {
    write({ op: 'START_SESSION', childId: 'kid', session: rec('s1', { questions: ['q1'] }) });
    write({ op: 'UPDATE_PROGRESS', childId: 'kid', sessionId: 's1', progress: { index: 1 } });
    expect(write({ op: 'UPDATE_PROGRESS', childId: 'kid', sessionId: 'old', progress: { index: 9 } }).results![0].skipped).toBe(true);
    expect(read({ mode: 'ALL', sheet: 'Session' }).records).toEqual([{ id: 's1', childId: 'kid', questions: ['q1'], progress: { index: 1 } }]);
    write({ op: 'END_SESSION', childId: 'kid', sessionId: 's1' });
    expect(write({ op: 'UPDATE_PROGRESS', childId: 'kid', sessionId: 's1', progress: { index: 2 } }).results![0].skipped).toBe(true);
    expect(read({ mode: 'ALL', sheet: 'Session' }).records).toEqual([]);
  });

  it('results: increasing ids in a circle of 1000; a repeated insert is skipped; pull by id', () => {
    const first = write({ op: 'INSERT_RESULT', result: rec('r1') }, { op: 'INSERT_RESULT', result: rec('r2') });
    expect(first.results!.map((x) => x.resultId)).toEqual([1, 2]);
    expect(write({ op: 'INSERT_RESULT', result: rec('r1') }).results![0]).toEqual({ resultId: 1, skipped: true });

    const ops: SyncOp[] = Array.from({ length: 999 }, (_, i) => ({ op: 'INSERT_RESULT', result: rec(`x${i}`) }));
    const ids = write(...ops).results!.map((x) => x.resultId);
    expect(ids[ids.length - 1]).toBe(1001);
    expect(rowCount('Result')).toBe(1000); // id 1001 took row 1: r1 is gone
    expect(read({ mode: 'BY_ID', sheet: 'Result' as never, ids: ['r1'] }).records).toEqual([]);
    expect(read({ mode: 'RESULTS_AFTER', after: 999 }).records!.map((r) => [r.id, r['resultId']])).toEqual([
      ['x997', 1000],
      ['x998', 1001],
    ]);
  });

  it('history and point usage: append-only, a repeated uuid is skipped, pull by row', () => {
    const r = write({ op: 'APPEND_HISTORY', history: rec('h1', { points: 10 }) }, { op: 'APPEND_HISTORY', history: rec('h2', { points: 5 }) });
    expect(r.results!.map((x) => x.row)).toEqual([1, 2]);
    expect(write({ op: 'APPEND_HISTORY', history: rec('h1') }).results![0]).toEqual({ row: 1, skipped: true });
    expect(read({ mode: 'ROWS_AFTER', sheet: 'HistoryResult', after: 1 }).records).toEqual([{ id: 'h2', points: 5, row: 2 }]);

    write({ op: 'APPEND_POINT_USAGE', usage: rec('u1', { points: 30 }) });
    expect(read({ mode: 'ROWS_AFTER', sheet: 'PointUsage', after: 0 }).records).toEqual([{ id: 'u1', points: 30, row: 1 }]);
  });

  it('every write that changed something extends the hash chain; PING returns the hash, WRITE the write id', () => {
    const ping = () => (handle({ action: 'PING', sharedSecret: 'secret', deviceId: 'd' }) as { syncHash?: string }).syncHash;
    expect(ping()).toBeUndefined();
    const first = write({ op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q1') });
    expect(first.writeId).toBeTruthy();
    expect(ping()).toBe(nextSyncHash(undefined, first.writeId!));
    const second = write({ op: 'APPEND_HISTORY', history: rec('h1') });
    expect(ping()).toBe(nextSyncHash(nextSyncHash(undefined, first.writeId!), second.writeId!));
    // Nothing changed (a repeated insert): no write id, same hash.
    const before = ping();
    expect(write({ op: 'APPEND_HISTORY', history: rec('h1') }).writeId).toBeUndefined();
    expect(ping()).toBe(before);
    expect(nextSyncHash('a', 'b')).not.toBe(nextSyncHash('b', 'a'));

    // A resend of the same request (its answer was lost) doesn't extend the chain again.
    const send = () => handle({ action: 'WRITE', sharedSecret: 'secret', deviceId: 'd', requestId: 'r1', ops: [{ op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec('q2') }] }) as { writeId?: string };
    const once = send();
    const afterOnce = ping();
    expect(send().writeId).toBe(once.writeId);
    expect(ping()).toBe(afterOnce);
  });

  it('big records are split across cells and pages stop near the size limit', () => {
    const long = 'x'.repeat(120_000);
    write(...Array.from({ length: 40 }, (_, i): SyncOp => ({ op: 'WRITE_RECORD', sheet: 'QuizItem', record: rec(`q${i}`, { long }) })));
    const page = read({ mode: 'SEQUENCE_AFTER', sheet: 'QuizItem', after: 0 });
    expect(page.truncated).toBe(true);
    expect(page.records!.length).toBeLessThan(40);
    expect(page.records![0]['long']).toBe(long);
    const last = page.records![page.records!.length - 1]['updateSequence'] as number;
    const rest = read({ mode: 'SEQUENCE_AFTER', sheet: 'QuizItem', after: last });
    expect(page.records!.length + rest.records!.length).toBe(40);
  });
});
