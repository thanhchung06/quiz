import { batchBySize, describeServerError, sendWrite, transportOptions } from '../../src/app/sync/sync-transport';
import { randomUUID } from 'node:crypto';

if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: randomUUID });

const reply = (body: unknown) => Promise.resolve({ status: 200, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) } as Response);
const bodies = () => (global.fetch as jest.Mock).mock.calls.map(([, init]) => String(init.body));

describe('sync transport', () => {
  beforeAll(() => {
    localStorage.setItem('quiz-app.syncEndpoint', 'https://script/exec');
    localStorage.setItem('quiz-app.sharedSecret', 'secret');
    transportOptions.retryDelaysMs = [0, 0, 0];
    transportOptions.busyDelaysMs = [0, 0];
  });

  it('cuts batches by size: many small items per request, fewer big ones', () => {
    expect(batchBySize(Array.from({ length: 1200 }, (_, i) => ({ i }))).map((b) => b.length)).toEqual([500, 500, 200]);
    expect(batchBySize(Array.from({ length: 10 }, () => ({ t: 'y'.repeat(300_000) }))).map((b) => b.length)).toEqual([3, 3, 3, 1]);
    expect(batchBySize([{ t: 'z'.repeat(3_000_000) }]).length).toBe(1);
  });

  it('re-sends the very same request after a network failure or an error page (every write is safe to repeat)', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call++;
      if (call === 1) return Promise.reject(new TypeError('Failed to fetch'));
      if (call === 2) return reply('<html><body></body></html>');
      return reply({ ok: true, results: [{}] });
    }) as unknown as typeof fetch;
    await expect(sendWrite([{ op: 'END_SESSION', childId: 'k', sessionId: 's' }])).resolves.toEqual({ ok: true, results: [{}] });
    expect(new Set(bodies()).size).toBe(1);
    expect(bodies()).toHaveLength(3);
  });

  it('waits and retries while Google is busy', async () => {
    let call = 0;
    global.fetch = jest.fn(() => reply(++call === 1 ? { ok: false, error: 'BUSY' } : { ok: true })) as unknown as typeof fetch;
    await expect(sendWrite([])).resolves.toEqual({ ok: true });
  });

  it('explains a wrong secret, an old sheet layout, and an unreachable network', async () => {
    global.fetch = jest.fn(() => reply({ ok: false, error: 'BAD_SECRET' })) as unknown as typeof fetch;
    await expect(sendWrite([])).rejects.toThrow('mã bí mật');
    global.fetch = jest.fn(() => reply({ ok: false, error: 'SCHEMA_MISMATCH', sheetSchemaVersion: 1 })) as unknown as typeof fetch;
    await expect(sendWrite([])).rejects.toThrow('định dạng cũ');
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    await expect(sendWrite([])).rejects.toThrow('Không kết nối');
  });

  it('extracts the message from an HTML error page', () => {
    expect(describeServerError('<html><style>x{}</style><div>TypeError: Cannot read properties of undefined (reading &#39;id&#39;)</div></html>')).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id')",
    );
  });
});
