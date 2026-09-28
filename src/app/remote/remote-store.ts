import { Signal } from '@angular/core';

/** Sentinel for "the server's time" (Firebase stamps it; security rules require it for updatedAt/createdAt). */
export const SERVER_TIME = Object.freeze({ '.sv': 'timestamp' });

/** Sentinel for an atomic "add n" (points, try counts). */
export interface Increment {
  readonly increment: number;
}
export function increment(n: number): Increment {
  return { increment: n };
}
export function isIncrement(value: unknown): value is Increment {
  return !!value && typeof value === 'object' && typeof (value as Increment).increment === 'number' && Object.keys(value).length === 1;
}

export interface ListQuery {
  /** Child field to order by (must be indexed in the rules). */
  orderBy: string;
  /** Only children after this value of the field (and, with startAfterKey, after that key among equal values). */
  startAfter?: number;
  startAfterKey?: string;
  limitToFirst?: number;
  limitToLast?: number;
}

/**
 * The family's online database (specs/003-firebase/plan.md): paths are relative
 * to `families/<familyKey>`. The app uses FirebaseRemoteStore; tests use
 * MemoryRemoteStore.
 */
export abstract class RemoteStore {
  /** False while the connection to the server is lost (the app shows "Mất kết nối"). */
  abstract readonly connected: Signal<boolean>;

  /** Signs in (anonymously) and connects; resolves once the database can be used. */
  abstract ready(): Promise<void>;

  abstract get<T>(path: string): Promise<T | undefined>;

  /** The children of `path`, in query order (key order without a query), each with its key. */
  abstract list<T>(path: string, query?: ListQuery): Promise<Array<{ key: string; value: T }>>;

  /**
   * Several writes at once, all or nothing: path → value, `null` removes,
   * SERVER_TIME / increment(n) anywhere in a value are applied by the server.
   */
  abstract update(values: Record<string, unknown>): Promise<void>;

  /** Calls back with the value now and on every change; returns the unsubscribe function. */
  abstract watch<T>(path: string, callback: (value: T | undefined) => void): () => void;
}
