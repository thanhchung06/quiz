import { currentDeviceId } from '../data/repositories/base-repository';
import { ReadSpec, SyncOp, SyncRequest, SyncResponse } from './protocol';
import { syncEndpointUrl, syncSharedSecret } from './sync-config';

/** A request Google didn't accept, with a message for the parent/child (Vietnamese). */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'server' | 'secret' | 'schema' | 'busy' | 'config',
  ) {
    super(message);
  }
}

/**
 * Upload batches are cut by size: every request pays a few seconds of Apps
 * Script overhead, so small records go many at a time and long ones fewer.
 */
export const BATCH_MAX_CHARS = 1_000_000;
export const BATCH_MAX_OPS = 500;

export function batchBySize<T>(items: T[], maxChars = BATCH_MAX_CHARS, maxItems = BATCH_MAX_OPS): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const length = JSON.stringify(item).length;
    if (current.length > 0 && (size + length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Apps Script reports a thrown error as an HTML page; keep just the readable message. */
export function describeServerError(body: string): string {
  const text = body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const match = /((?:Exception|Error|TypeError|ReferenceError|SyntaxError)[^.]*(?:\.[^.]*){0,2})/.exec(text);
  return (match?.[1] ?? text).slice(0, 400) || 'Máy chủ trả về phản hồi không hợp lệ.';
}

export const transportOptions = {
  /** Waits before re-sending a request that failed in transit or came back as an error page (every request is safe to repeat). */
  retryDelaysMs: [2000, 5000, 10000],
  busyDelaysMs: [500, 1000, 2000, 4000],
  /**
   * The first request after the script sat idle hits Apps Script's cold start
   * (can take tens of seconds, sometimes fails): the app-start "connect" ping
   * gives up on one try after this long and tries again, up to wakeUpDelaysMs.
   */
  wakeUpTimeoutMs: 25_000,
  wakeUpDelaysMs: [3000, 5000, 10000, 15000, 20000],
};

export interface SendOptions {
  /** Abandon one try after this long (then retry). */
  timeoutMs?: number;
  /** Waits between tries (default transportOptions.retryDelaysMs). */
  retryDelaysMs?: number[];
  /** Before each retry: attempt number (2, 3, …) and the total. */
  onRetry?: (attempt: number, attempts: number) => void;
}

export async function sendWrite(ops: SyncOp[]): Promise<Extract<SyncResponse, { ok: true }>> {
  return send({ action: 'WRITE', sharedSecret: syncSharedSecret(), deviceId: currentDeviceId(), ops });
}

/** Google's current sync hash (and a check that the connection works). */
export async function sendPing(options: SendOptions = {}): Promise<Extract<SyncResponse, { ok: true }>> {
  return send({ action: 'PING', sharedSecret: syncSharedSecret(), deviceId: currentDeviceId() }, options);
}

/**
 * Wakes the script up (app start): a PING that allows for Apps Script's cold
 * start — each try is cut off after wakeUpTimeoutMs and repeated with growing
 * pauses, reporting each retry so the app can say it is still connecting.
 */
export async function wakeUp(onRetry?: SendOptions['onRetry']): Promise<Extract<SyncResponse, { ok: true }>> {
  return sendPing({ timeoutMs: transportOptions.wakeUpTimeoutMs, retryDelaysMs: transportOptions.wakeUpDelaysMs, onRetry });
}

export async function sendRead(read: ReadSpec): Promise<Extract<SyncResponse, { ok: true }>> {
  return send({ action: 'READ', sharedSecret: syncSharedSecret(), deviceId: currentDeviceId(), read });
}

async function send(request: SyncRequest, options: SendOptions = {}): Promise<Extract<SyncResponse, { ok: true }>> {
  const endpoint = syncEndpointUrl();
  if (!endpoint || !request.sharedSecret) throw new SyncError('Chưa cấu hình kết nối Google (URL Web App và mã bí mật).', 'config');
  const retryDelays = options.retryDelaysMs ?? transportOptions.retryDelaysMs;
  let busyTries = 0;
  for (let retry = 0; ; retry++) {
    try {
      const response = await postOnce(endpoint, request, options.timeoutMs);
      if (response.ok) return response;
      if (response.error === 'BUSY' && busyTries < transportOptions.busyDelaysMs.length) {
        await delay(transportOptions.busyDelaysMs[busyTries++]);
        retry--;
        continue;
      }
      throw rejection(response);
    } catch (error) {
      const transient = error instanceof SyncError && (error.kind === 'network' || error.kind === 'server');
      if (!transient || retry >= retryDelays.length) throw error;
      await delay(retryDelays[retry]);
      options.onRetry?.(retry + 2, retryDelays.length + 1);
    }
  }
}

function rejection(response: Extract<SyncResponse, { ok: false }>): SyncError {
  switch (response.error) {
    case 'BAD_SECRET':
      return new SyncError('Google từ chối: mã bí mật không khớp với SHARED_SECRET trong Apps Script.', 'secret');
    case 'SCHEMA_MISMATCH':
      return new SyncError(
        `Google Sheet đang ở định dạng cũ (phiên bản ${response.sheetSchemaVersion ?? '?'}). Cần cập nhật Apps Script và làm trống sheet (resetSheetForNewLayout) trước khi đồng bộ.`,
        'schema',
      );
    case 'BUSY':
      return new SyncError('Google Sheet đang bận với thiết bị khác. Thử lại sau ít phút.', 'busy');
    default:
      return new SyncError(`Apps Script báo lỗi: ${response.message ?? 'yêu cầu không hợp lệ'}`, 'server');
  }
}

async function postOnce(endpoint: string, request: SyncRequest, timeoutMs?: number): Promise<SyncResponse> {
  const payload = JSON.stringify(request);
  let text: string;
  let status = 0;
  const abort = timeoutMs ? new AbortController() : undefined;
  const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(endpoint, {
      signal: abort?.signal,
      method: 'POST',
      // Apps Script Web Apps don't handle CORS preflight requests, so this must
      // stay a CORS "simple request": text/plain and no custom headers.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
      // Lets a small write fired while the app is closing finish after the page is gone (browsers cap keepalive at 64 KB).
      keepalive: payload.length < 60_000,
    });
    status = res.status;
    text = await res.text();
  } catch {
    throw new SyncError(
      abort?.signal.aborted
        ? 'Google không trả lời (Apps Script có thể đang khởi động). Thử lại sau ít phút.'
        : 'Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
  try {
    return JSON.parse(text) as SyncResponse;
  } catch {
    // The script threw (quota, bad deployment…) — Apps Script answers with an HTML error page.
    throw new SyncError(`Apps Script báo lỗi (HTTP ${status || '?'}): ${text.trim() ? describeServerError(text) : 'phản hồi trống'}`, 'server');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
