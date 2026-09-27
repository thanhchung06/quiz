import { SyncClientService, SYNC_BATCH_SIZE, describeServerError } from '../../src/app/sync-engine/sync-client.service';
import { BatchBuilderService } from '../../src/app/sync-engine/batch-builder.service';
import { GoogleAuthService } from '../../src/app/features/sync/services/google-auth.service';
import { ConflictStateService } from '../../src/app/sync-engine/conflict-state.service';
import { SyncChange } from '../../src/app/sync-engine/sync-api.types';
import { randomUUID } from 'node:crypto';

// jsdom has no crypto.randomUUID; the app runs in real browsers, which do.
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

function client(changeCount: number) {
  const changes = Array.from({ length: changeCount }, (_, i) => ({ changeGroupId: `g${i}`, entityId: `g${i}` }) as SyncChange);
  return new SyncClientService(
    { collectPendingChanges: async () => changes } as unknown as BatchBuilderService,
    { sharedSecret: () => 'secret' } as unknown as GoogleAuthService,
    { hasUnresolvedConflicts: () => false, setConflicts: () => undefined } as unknown as ConflictStateService,
  );
}

function reply(body: string) {
  return Promise.resolve({ text: () => Promise.resolve(body) } as Response);
}

const ok = JSON.stringify({ result: 'SYNC_SUCCESS', committedChangeGroupIds: [], downloads: [], conflicts: [] });

describe('SyncClientService', () => {
  afterEach(() => jest.restoreAllMocks());

  it(`uploads in batches of ${SYNC_BATCH_SIZE} and reports progress`, async () => {
    const sizes: number[] = [];
    global.fetch = jest.fn((_url, init) => {
      sizes.push(JSON.parse(String(init?.body)).changes.length);
      return reply(ok);
    }) as unknown as typeof fetch;
    const c = client(250);
    expect(await c.syncNormally('https://x/exec')).toBe('success');
    expect(sizes).toEqual([100, 100, 50]);
    expect(c.progress()).toEqual({ sent: 250, total: 250 });
  });

  it('still sends one request when nothing is pending (to receive other devices\' changes)', async () => {
    global.fetch = jest.fn(() => reply(ok)) as unknown as typeof fetch;
    await client(0).syncNormally('https://x/exec');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failing batch and shows the Apps Script error message', async () => {
    let call = 0;
    global.fetch = jest.fn(() =>
      reply(call++ === 0 ? ok : '<html><body><div>Exception: Your input contains more than the maximum of 50000 characters in a single cell. (line 12, file "Code")</div></body></html>'),
    ) as unknown as typeof fetch;
    const c = client(250);
    expect(await c.syncNormally('https://x/exec')).toBe('server-error');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(c.progress()).toEqual({ sent: 100, total: 250 });
    expect(c.lastError()).toContain('maximum of 50000 characters');
  });

  it('explains a wrong shared secret and an unreachable network', async () => {
    global.fetch = jest.fn(() => reply(JSON.stringify({ result: 'SYNC_REJECTED' }))) as unknown as typeof fetch;
    const c = client(1);
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
