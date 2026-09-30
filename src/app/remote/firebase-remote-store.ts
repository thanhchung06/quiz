import { Injectable, signal } from '@angular/core';
import { FirebaseApp, initializeApp } from '@firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from '@firebase/auth';
import {
  Database,
  endBefore,
  equalTo,
  get,
  getDatabase,
  increment as dbIncrement,
  limitToFirst,
  limitToLast,
  onValue,
  orderByChild,
  orderByKey,
  query,
  QueryConstraint,
  ref,
  serverTimestamp,
  startAfter,
  startAt,
  update,
} from '@firebase/database';
import { FIREBASE_CONFIG } from '../firebase-config.generated';
import { isIncrement, ListQuery, RemoteStore, SERVER_TIME, WriteRejectedError } from './remote-store';

/** How long a read waits for a lost connection to come back before failing. */
const READ_WAIT_MS = 20_000;

export class RemoteError extends Error {}

/**
 * The family's Firebase Realtime Database (specs/003-firebase/plan.md). Each
 * device signs in anonymously and automatically (the SDK keeps the sign-in);
 * security rules only allow the family path from config/firebase.json. Writes
 * made while the connection is lost are held by the SDK and sent when it is
 * back; reads wait for the connection (up to READ_WAIT_MS).
 */
@Injectable({ providedIn: 'root' })
export class FirebaseRemoteStore extends RemoteStore {
  private readonly _connected = signal(true);
  readonly connected = this._connected.asReadonly();
  private app?: FirebaseApp;
  private db?: Database;
  private starting?: Promise<void>;

  ready(): Promise<void> {
    this.starting ??= this.start().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const c = FIREBASE_CONFIG;
    if (!c.databaseURL || !c.apiKey || !c.familyKey) throw new RemoteError('Ứng dụng chưa có cấu hình Firebase (config/firebase.json).');
    this.app ??= initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, databaseURL: c.databaseURL, projectId: c.projectId, appId: c.appId });
    const auth = getAuth(this.app);
    // The SDK remembers the anonymous sign-in; only a first start (or a cleared browser) signs in again.
    await new Promise<void>((resolve) => {
      const stop = onAuthStateChanged(auth, () => {
        stop();
        resolve();
      });
    });
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        throw new RemoteError(`Không đăng nhập được vào máy chủ: ${message(error)}`);
      }
    }
    this.db = getDatabase(this.app, c.databaseURL);
    onValue(ref(this.db, '.info/connected'), (snap) => this._connected.set(snap.val() === true));
  }

  private path(path: string) {
    return ref(this.db!, `families/${FIREBASE_CONFIG.familyKey}/${path}`.replace(/\/+$/, ''));
  }

  async get<T>(path: string): Promise<T | undefined> {
    await this.ready();
    await this.waitForConnection();
    try {
      const snap = await get(this.path(path));
      return snap.exists() ? (snap.val() as T) : undefined;
    } catch (error) {
      throw new RemoteError(`Không đọc được dữ liệu: ${message(error)}`);
    }
  }

  async list<T>(path: string, q?: ListQuery): Promise<Array<{ key: string; value: T }>> {
    await this.ready();
    await this.waitForConnection();
    const constraints: QueryConstraint[] = [];
    if (q) {
      constraints.push(q.orderBy ? orderByChild(q.orderBy) : orderByKey());
      if (q.equalTo !== undefined) constraints.push(equalTo(q.equalTo));
      if (q.startAt !== undefined) constraints.push(startAt(q.startAt));
      if (q.startAfter !== undefined) constraints.push(q.startAfterKey !== undefined ? startAfter(q.startAfter, q.startAfterKey) : startAfter(q.startAfter));
      if (q.endBefore !== undefined) constraints.push(endBefore(q.endBefore));
      if (q.limitToFirst !== undefined) constraints.push(limitToFirst(q.limitToFirst));
      if (q.limitToLast !== undefined) constraints.push(limitToLast(q.limitToLast));
    }
    try {
      const snap = await get(constraints.length ? query(this.path(path), ...constraints) : this.path(path));
      const out: Array<{ key: string; value: T }> = [];
      snap.forEach((child) => {
        out.push({ key: child.key!, value: child.val() as T });
      });
      return out;
    } catch (error) {
      throw new RemoteError(`Không đọc được dữ liệu: ${message(error)}`);
    }
  }

  async update(values: Record<string, unknown>): Promise<void> {
    await this.ready();
    const converted = Object.fromEntries(Object.entries(values).map(([path, value]) => [path, convert(value)]));
    try {
      await update(this.path(''), converted);
    } catch (error) {
      if ((error as { code?: string }).code === 'PERMISSION_DENIED' || /permission_denied/i.test(message(error))) throw new WriteRejectedError(`Máy chủ từ chối ghi: ${message(error)}`);
      throw new RemoteError(`Không lưu được lên máy chủ: ${message(error)}`);
    }
  }

  watch<T>(path: string, callback: (value: T | undefined) => void): () => void {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void this.ready().then(() => {
      if (!cancelled) stop = onValue(this.path(path), (snap) => callback(snap.exists() ? (snap.val() as T) : undefined));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  private async waitForConnection(): Promise<void> {
    if (this._connected()) return;
    const started = Date.now();
    while (!this._connected()) {
      if (Date.now() - started > READ_WAIT_MS) throw new RemoteError('Mất kết nối tới máy chủ. Kiểm tra mạng rồi thử lại.');
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** SERVER_TIME / increment(n) → the SDK's own sentinels; undefined fields dropped (Firebase refuses them). */
function convert(value: unknown): unknown {
  if (value === SERVER_TIME || (value && typeof value === 'object' && (value as Record<string, unknown>)['.sv'] === 'timestamp')) return serverTimestamp();
  if (isIncrement(value)) return dbIncrement(value.increment);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, convert(v)]),
    );
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
