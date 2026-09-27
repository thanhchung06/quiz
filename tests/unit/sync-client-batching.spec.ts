import { SyncClientService, batchBySize, describeServerError } from '../../src/app/sync-engine/sync-client.service';
import { BatchBuilderService } from '../../src/app/sync-engine/batch-builder.service';
import { GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';
import { ConflictStateService } from '../../src/app/sync-engine/conflict-state.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { DownloadApplierService } from '../../src/app/sync-engine/download-applier.service';
import { SyncChange, SyncRequestBody } from '../../src/app/sync-engine/sync-api.types';
import { randomUUID } from 'node:crypto';

// jsdom has no crypto.randomUUID; the app runs in real browsers, which do.
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

function client(changeCount: number, lastPulledRevision = 0, entityType = 'Attempt', payloadChars = 10) {
  const changes = Array.from(
    { length: changeCount },
    (_, i) => ({ changeGroupId: `g${i}`, entityId: `g${i}`, entityType, payload: { text: 'x'.repeat(payloadChars) } }) as unknown as SyncChange,
  );
  let settings: Record<string, number> = { lastPulledRevision, lastPulledQuestionsRevision: 0 };
  const applied: unknown[][] = [];
  const c = new SyncClientService(
    { collectPendingChanges: async () => changes } as unknown as BatchBuilderService,
    { sharedSecret: () => 'secret' } as unknown as GoogleAuthService,
    { hasUnresolvedConflicts: () => false, setConflicts: () => undefined, conflicts: () => [] } as unknown as ConflictStateService,
    { get: async () => settings, update: async (p: object) => (settings = { ...settings, ...p }) } as unknown as AppSettingsRepository,
    { apply: async (d: unknown[]) => (applied.push(d), d.length) } as unknown as DownloadApplierService,
  );
  c.retryDelaysMs = [0, 0, 0];
  return { c, settings: () => settings, applied };
}

const reply = (body: unknown) => Promise.resolve({ text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) } as Response);
const ok = (extra: object = {}) => ({ result: 'SYNC_SUCCESS', committedChangeGroupIds: [], downloads: [], conflicts: [], ...extra });
const bodies = () => (global.fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(String(init.body)) as SyncRequestBody);

describe('SyncClientService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cuts upload batches by size: many small records per request, fewer big ones', () => {
    const small = Array.from({ length: 5000 }, (_, i) => ({ id: i }));
    expect(batchBySize(small).map((b) => b.length)).toEqual([2000, 2000, 1000]); // capped by count
    const big = Array.from({ length: 10 }, () => ({ text: 'y'.repeat(300_000) }));
    expect(batchBySize(big).map((b) => b.length)).toEqual([3, 3, 3, 1]); // ~1 MB per request
    expect(batchBySize([{ text: 'z'.repeat(3_000_000) }]).length).toBe(1); // an oversized record still goes, alone
  });

  it('data scope: pulls only data types from its own cursor, then uploads only data changes', async () => {
    global.fetch = jest.fn((_u, init) => {
      const b = JSON.parse(String(init?.body));
      return reply(b.pullSince !== undefined ? ok({ dataRevision: 7, hasMore: false }) : ok());
    }) as unknown as typeof fetch;
    const { c, settings } = client(250, 3);
    expect(await c.syncNormally('https://x/exec', 'data')).toBe('success');
    const sent = bodies();
    expect(sent[0]).toMatchObject({ pullSince: 3, changes: [] });
    expect(sent[0].pullTypes).toContain('Attempt');
    expect(sent[0].pullTypes).not.toContain('QuizItem');
    expect(sent.slice(1).map((b) => b.changes.length)).toEqual([250]); // small records: one request
    expect(settings().lastPulledRevision).toBe(7);
    expect(settings().lastPulledQuestionsRevision).toBe(0); // the question cursor is untouched
    expect(c.progress()).toEqual({ sent: 250, total: 250 });
  });

  it('question scope ignores data changes and keeps its own cursor', async () => {
    global.fetch = jest.fn((_u, init) =>
      reply(JSON.parse(String(init?.body)).pullSince !== undefined ? ok({ dataRevision: 9 }) : ok()),
    ) as unknown as typeof fetch;
    const { c, settings } = client(40, 3, 'Attempt');
    expect(await c.syncNormally('https://x/exec', 'questions')).toBe('success');
    expect(bodies()).toHaveLength(1); // just the pull: no QuizItem/Category changes pending
    expect(bodies()[0]).toMatchObject({ pullSince: 0, pullTypes: ['Category', 'QuizItem'] });
    expect(settings()).toMatchObject({ lastPulledQuestionsRevision: 9, lastPulledRevision: 3 });
  });

  it("'all' syncs questions first, then data", async () => {
    global.fetch = jest.fn((_u, init) =>
      reply(JSON.parse(String(init?.body)).pullSince !== undefined ? ok({ dataRevision: 1 }) : ok()),
    ) as unknown as typeof fetch;
    const { c } = client(0);
    await c.syncNormally('https://x/exec', 'all');
    expect(bodies().map((b) => b.pullTypes?.[0])).toEqual(['Category', 'Profile']);
  });

  it('one direction only: push-only never pulls, pull-only never uploads; the summary reports the run', async () => {
    global.fetch = jest.fn((_u, init) => {
      const b = JSON.parse(String(init?.body));
      return reply(b.pullSince !== undefined ? ok({ dataRevision: 4, downloads: [{}, {}] }) : ok());
    }) as unknown as typeof fetch;

    const pushOnly = client(30);
    await pushOnly.c.run('https://x/exec', { scopes: ['data'], push: true, pull: false });
    expect(bodies().every((b) => b.pullSince === undefined)).toBe(true);
    expect(pushOnly.c.lastSummary()).toMatchObject({ outcome: 'success', sent: 30, toSend: 30, received: 0, conflicts: 0 });

    (global.fetch as jest.Mock).mockClear();
    const pullOnly = client(30);
    await pullOnly.c.run('https://x/exec', { scopes: ['data'], push: false, pull: true });
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].pullSince).toBe(0);
    expect(pullOnly.c.lastSummary()).toMatchObject({ outcome: 'success', received: 2, sent: 0, toSend: 0 });
  });

  it('keeps asking while the server says hasMore, applying every page', async () => {
    const pages = [ok({ dataRevision: 2, hasMore: true, downloads: [{}, {}] }), ok({ dataRevision: 5, hasMore: false, downloads: [{}] })];
    global.fetch = jest.fn(() => reply(pages.shift() ?? ok())) as unknown as typeof fetch;
    const { c, settings } = client(0);
    await c.syncNormally('https://x/exec', 'data');
    expect(bodies().map((b) => b.pullSince)).toEqual([0, 2]);
    expect(c.received()).toBe(3);
    expect(settings().lastPulledRevision).toBe(5);
  });

  it('works against an older script without pull support (no dataRevision)', async () => {
    global.fetch = jest.fn(() => reply(ok())) as unknown as typeof fetch;
    const { c, settings } = client(5);
    expect(await c.syncNormally('https://x/exec', 'data')).toBe('success');
    expect(global.fetch).toHaveBeenCalledTimes(2); // one pull attempt + one upload batch
    expect(settings().lastPulledRevision).toBe(0);
  });

  it('stops at the first failing batch and shows the Apps Script error message', async () => {
    let call = 0;
    global.fetch = jest.fn(() =>
      reply(
        [ok({ dataRevision: 1 }), ok()][call++] ??
          '<html><body><div>Exception: Your input contains more than the maximum of 50000 characters in a single cell. (line 12, file "Code")</div></body></html>',
      ),
    ) as unknown as typeof fetch;
    const { c } = client(4, 0, 'Attempt', 400_000); // ~1.6 MB -> two requests of ~800 KB
    expect(await c.syncNormally('https://x/exec', 'data')).toBe('server-error');
    expect(c.progress()).toEqual({ sent: 2, total: 4 });
    expect(c.lastError()).toContain('maximum of 50000 characters');
  });

  it('re-sends the same request (same syncId) after a transient failure, then carries on', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call++;
      if (call === 2) return Promise.reject(new TypeError('Failed to fetch')); // first upload batch fails once
      if (call === 3) return reply('<html><body></body></html>'); // and then gets an empty error page
      return reply(call === 1 ? ok({ dataRevision: 1 }) : ok());
    }) as unknown as typeof fetch;
    const { c } = client(150);
    expect(await c.syncNormally('https://x/exec', 'data')).toBe('success');
    const ids = bodies().map((b) => b.syncId);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[2]).toBe(ids[3]);
    expect(c.progress()).toEqual({ sent: 150, total: 150 });
  });

  it('explains a wrong shared secret and an unreachable network', async () => {
    global.fetch = jest.fn(() => reply({ result: 'SYNC_REJECTED' })) as unknown as typeof fetch;
    const { c } = client(1);
    expect(await c.syncNormally('https://x/exec', 'data')).toBe('rejected');
    expect(c.lastError()).toContain('mã bí mật');

    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await c.syncNormally('https://x/exec', 'data')).toBe('network-error');
    expect(c.lastError()).toContain('Không kết nối');
  });

  it('extracts the message from an HTML error page', () => {
    expect(describeServerError('<html><style>x{}</style><div>TypeError: Cannot read properties of undefined (reading &#39;id&#39;)</div></html>')).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
  });
});
