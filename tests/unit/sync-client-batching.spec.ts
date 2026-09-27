import { SyncClientService, SyncRunOptions, batchBySize, describeServerError } from '../../src/app/sync-engine/sync-client.service';
import { BatchBuilderService } from '../../src/app/sync-engine/batch-builder.service';
import { GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';
import { DownloadApplierService } from '../../src/app/sync-engine/download-applier.service';
import { AppSettingsRepository } from '../../src/app/data/repositories/app-settings.repository';
import { SyncChange, SyncRequestBody } from '../../src/app/sync-engine/sync-api.types';
import { randomUUID } from 'node:crypto';

// jsdom has no crypto.randomUUID; the app runs in real browsers, which do.
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

/** Upload-only runs (downloads need IndexedDB — see sync-end-to-end.spec.ts). */
function client(changeCount: number, entityType = 'Exercise', payloadChars = 10) {
  const changes = Array.from(
    { length: changeCount },
    (_, i) => ({ changeGroupId: `g${i}`, entityId: `g${i}`, entityType, lastGoogleVersion: 1, localVersion: 2, payload: { text: 'x'.repeat(payloadChars) } }) as unknown as SyncChange,
  );
  const c = new SyncClientService(
    { collectPendingChanges: async () => changes, collectAll: async () => changes } as unknown as BatchBuilderService,
    { sharedSecret: () => 'secret' } as unknown as GoogleAuthService,
    {} as unknown as DownloadApplierService,
    {} as unknown as AppSettingsRepository,
  );
  c.retryDelaysMs = [0, 0, 0];
  return { c };
}
const push = (extra: Partial<SyncRunOptions> = {}): SyncRunOptions => ({
  scopes: ['data'],
  push: true,
  pull: false,
  mode: 'changes',
  uploader: { role: 'parent', profileId: 'p' },
  ...extra,
});

const reply = (body: unknown) => Promise.resolve({ text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) } as Response);
const ok = (extra: object = {}) => ({ result: 'SYNC_SUCCESS', committedChangeGroupIds: [], downloads: [], versions: {}, ...extra });
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

  it('uploads changed records as overwrites, only those of the scope, and reports progress', async () => {
    global.fetch = jest.fn(() => reply(ok())) as unknown as typeof fetch;
    const { c } = client(250);
    expect(await c.run('https://x/exec', push())).toBe('success');
    expect(bodies().map((b) => [b.action, b.changes.length])).toEqual([['REPLACE_GOOGLE_WITH_LOCAL', 250]]);
    expect(c.lastSummary()).toMatchObject({ outcome: 'success', sent: 250, toSend: 250, received: 0, removed: 0 });

    (global.fetch as jest.Mock).mockClear();
    expect(await c.run('https://x/exec', push({ scopes: ['questions'] }))).toBe('success');
    expect(global.fetch).not.toHaveBeenCalled(); // no question changes
  });

  it('uploads nothing that the logged-in person may not upload', async () => {
    global.fetch = jest.fn(() => reply(ok())) as unknown as typeof fetch;
    expect(await client(20, 'Attempt').c.run('https://x/exec', push())).toBe('success'); // a child's results, parent logged in
    expect(await client(20, 'Exercise').c.run('https://x/exec', push({ uploader: undefined }))).toBe('success'); // nobody logged in
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parent's mirror push prunes parent-managed types only; added-questions-only sends new questions and prunes none of them", async () => {
    global.fetch = jest.fn(() => reply(ok({ removed: 3 }))) as unknown as typeof fetch;
    const { c } = client(5);
    await c.run('https://x/exec', push({ mode: 'mirror' }));
    const prune = bodies().find((b) => b.action === 'REPLACE_PRUNE')!;
    expect(Object.keys(prune.keepIds!).sort()).toEqual(['Assignment', 'Exercise', 'PointRedemption', 'Rotation']);
    expect(prune.keepIds!['Exercise']).toHaveLength(5);
    expect(c.lastSummary()).toMatchObject({ removed: 3 });

    (global.fetch as jest.Mock).mockClear();
    const questions = client(4, 'QuizItem'); // all already on Google (lastGoogleVersion 1)
    await questions.c.run('https://x/exec', push({ mode: 'mirror', scopes: ['questions'], addedQuestionsOnly: true }));
    expect(bodies()).toHaveLength(0);
  });

  it('stops at the first failing batch and shows the Apps Script error message', async () => {
    let call = 0;
    global.fetch = jest.fn(() =>
      reply(
        [ok()][call++] ??
          '<html><body><div>Exception: Your input contains more than the maximum of 50000 characters in a single cell. (line 12, file "Code")</div></body></html>',
      ),
    ) as unknown as typeof fetch;
    const { c } = client(4, 'Exercise', 400_000); // ~1.6 MB -> two requests of ~800 KB
    expect(await c.run('https://x/exec', push())).toBe('server-error');
    expect(c.progress()).toEqual({ sent: 2, total: 4 });
    expect(c.lastError()).toContain('maximum of 50000 characters');
  });

  it('asks for a script update when Google runs the old script', async () => {
    global.fetch = jest.fn(() => reply({ result: 'SYNC_SUCCESS', committedChangeGroupIds: [] })) as unknown as typeof fetch;
    const { c } = client(3);
    expect(await c.run('https://x/exec', push())).toBe('server-error');
    expect(c.lastError()).toContain('New version');
  });

  it('re-sends the same request (same syncId) after a transient failure, then carries on', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call++;
      if (call === 1) return Promise.reject(new TypeError('Failed to fetch')); // the upload fails once
      if (call === 2) return reply('<html><body></body></html>'); // and then gets an empty error page
      return reply(ok());
    }) as unknown as typeof fetch;
    const { c } = client(150);
    expect(await c.run('https://x/exec', push())).toBe('success');
    const ids = bodies().map((b) => b.syncId);
    expect(new Set(ids).size).toBe(1);
    expect(c.progress()).toEqual({ sent: 150, total: 150 });
  });

  it('explains a wrong shared secret and an unreachable network', async () => {
    global.fetch = jest.fn(() => reply({ result: 'SYNC_REJECTED' })) as unknown as typeof fetch;
    const { c } = client(1);
    expect(await c.run('https://x/exec', push())).toBe('rejected');
    expect(c.lastError()).toContain('mã bí mật');

    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect(await c.run('https://x/exec', push())).toBe('network-error');
    expect(c.lastError()).toContain('Không kết nối');
  });

  it('extracts the message from an HTML error page', () => {
    expect(describeServerError('<html><style>x{}</style><div>TypeError: Cannot read properties of undefined (reading &#39;id&#39;)</div></html>')).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
  });
});
