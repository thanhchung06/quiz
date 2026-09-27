import { SyncClientService, SYNC_BATCH_SIZE, describeServerError } from '../../src/app/sync-engine/sync-client.service';
import { BatchBuilderService } from '../../src/app/sync-engine/batch-builder.service';
import { GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';
import { ConflictStateService } from '../../src/app/sync-engine/conflict-state.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { DownloadApplierService } from '../../src/app/sync-engine/download-applier.service';
import { SyncChange, SyncRequestBody } from '../../src/app/sync-engine/sync-api.types';
import { randomUUID } from 'node:crypto';

// jsdom has no crypto.randomUUID; the app runs in real browsers, which do.
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

function client(changeCount: number, lastPulledRevision = 0) {
  const changes = Array.from({ length: changeCount }, (_, i) => ({ changeGroupId: `g${i}`, entityId: `g${i}`, entityType: 'Nothing' }) as unknown as SyncChange);
  let settings = { lastPulledRevision };
  const applied: unknown[][] = [];
  const c = new SyncClientService(
    { collectPendingChanges: async () => changes } as unknown as BatchBuilderService,
    { sharedSecret: () => 'secret' } as unknown as GoogleAuthService,
    { hasUnresolvedConflicts: () => false, setConflicts: () => undefined } as unknown as ConflictStateService,
    { get: async () => settings, update: async (p: object) => (settings = { ...settings, ...p }) } as unknown as AppSettingsRepository,
    { apply: async (d: unknown[]) => (applied.push(d), d.length) } as unknown as DownloadApplierService,
  );
  return { c, settings: () => settings, applied };
}

const reply = (body: unknown) => Promise.resolve({ text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) } as Response);
const ok = (extra: object = {}) => ({ result: 'SYNC_SUCCESS', committedChangeGroupIds: [], downloads: [], conflicts: [], ...extra });
const bodies = () => (global.fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(String(init.body)) as SyncRequestBody);

describe('SyncClientService', () => {
  afterEach(() => jest.restoreAllMocks());

  it(`pulls first, then uploads in batches of ${SYNC_BATCH_SIZE}`, async () => {
    global.fetch = jest.fn((_u, init) => {
      const b = JSON.parse(String(init?.body));
      return reply(b.pullSince !== undefined ? ok({ dataRevision: 7, hasMore: false }) : ok());
    }) as unknown as typeof fetch;
    const { c, settings } = client(250, 3);
    expect(await c.syncNormally('https://x/exec')).toBe('success');
    const sent = bodies();
    expect(sent[0]).toMatchObject({ pullSince: 3, changes: [] });
    expect(sent.slice(1).map((b) => b.changes.length)).toEqual([100, 100, 50]);
    expect(sent.slice(1).every((b) => b.pullSince === undefined)).toBe(true);
    expect(settings().lastPulledRevision).toBe(7);
    expect(c.progress()).toEqual({ sent: 250, total: 250 });
  });

  it('keeps asking while the server says hasMore, applying every page', async () => {
    const pages = [ok({ dataRevision: 2, hasMore: true, downloads: [{}, {}] }), ok({ dataRevision: 5, hasMore: false, downloads: [{}] })];
    global.fetch = jest.fn(() => reply(pages.shift() ?? ok())) as unknown as typeof fetch;
    const { c, settings } = client(0);
    await c.syncNormally('https://x/exec');
    expect(bodies().map((b) => b.pullSince)).toEqual([0, 2]);
    expect(c.received()).toBe(3);
    expect(settings().lastPulledRevision).toBe(5);
  });

  it('works against an older script without pull support (no dataRevision)', async () => {
    global.fetch = jest.fn(() => reply(ok())) as unknown as typeof fetch;
    const { c, settings } = client(5);
    expect(await c.syncNormally('https://x/exec')).toBe('success');
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
    const { c } = client(250);
    expect(await c.syncNormally('https://x/exec')).toBe('server-error');
    expect(c.progress()).toEqual({ sent: 100, total: 250 });
    expect(c.lastError()).toContain('maximum of 50000 characters');
  });

  it('explains a wrong shared secret and an unreachable network', async () => {
    global.fetch = jest.fn(() => reply({ result: 'SYNC_REJECTED' })) as unknown as typeof fetch;
    const { c } = client(1);
    expect(await c.syncNormally('https://x/exec')).toBe('rejected');
    expect(c.lastError()).toContain('mã bí mật');

    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await c.syncNormally('https://x/exec')).toBe('network-error');
    expect(c.lastError()).toContain('Không kết nối');
  });

  it('extracts the message from an HTML error page', () => {
    expect(describeServerError('<html><style>x{}</style><div>TypeError: Cannot read properties of undefined (reading &#39;id&#39;)</div></html>')).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
  });
});
