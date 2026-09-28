import { signal } from '@angular/core';
import { isIncrement, ListQuery, RemoteStore, SERVER_TIME } from './remote-store';

type Tree = Record<string, unknown>;

/**
 * In-memory stand-in for the Firebase database (tests, and nothing else):
 * same paths, multi-path updates, server time, atomic increments and queries.
 * Security rules are not applied here — they are checked against the real
 * database (firebase/database.rules.json).
 */
export class MemoryRemoteStore extends RemoteStore {
  readonly connected = signal(true);
  root: Tree = {};
  /** Fails the next N calls (to test error handling). */
  failNext = 0;
  calls = 0;
  private lastTime = 0;
  private readonly watchers: Array<{ path: string; callback: (value: unknown) => void }> = [];

  async ready(): Promise<void> {
    this.check();
  }

  async get<T>(path: string): Promise<T | undefined> {
    this.check();
    return clone(this.at(path)) as T | undefined;
  }

  async list<T>(path: string, query?: ListQuery): Promise<Array<{ key: string; value: T }>> {
    this.check();
    const node = this.at(path);
    if (!node || typeof node !== 'object') return [];
    let entries = Object.entries(node as Tree).map(([key, value]) => ({ key, value: clone(value) as T }));
    if (query) {
      const field = (e: { value: T }) => ((e.value as Tree)?.[query.orderBy] as number) ?? 0;
      entries.sort((a, b) => field(a) - field(b) || a.key.localeCompare(b.key));
      if (query.startAfter !== undefined) {
        const v = query.startAfter;
        const k = query.startAfterKey;
        entries = entries.filter((e) => field(e) > v || (k !== undefined && field(e) === v && e.key > k));
      }
      if (query.limitToFirst !== undefined) entries = entries.slice(0, query.limitToFirst);
      if (query.limitToLast !== undefined) entries = entries.slice(-query.limitToLast);
    }
    return entries;
  }

  async update(values: Record<string, unknown>): Promise<void> {
    this.check();
    const now = this.now();
    for (const [path, value] of Object.entries(values)) {
      const current = this.at(path);
      this.set(path, resolve(value, current, now));
    }
    for (const w of this.watchers) w.callback(clone(this.at(w.path)));
  }

  watch<T>(path: string, callback: (value: T | undefined) => void): () => void {
    const entry = { path, callback: callback as (value: unknown) => void };
    this.watchers.push(entry);
    callback(clone(this.at(path)) as T | undefined);
    return () => this.watchers.splice(this.watchers.indexOf(entry), 1);
  }

  private check(): void {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Client is offline.');
    }
  }

  /** Strictly increasing, like distinct server commits. */
  private now(): number {
    this.lastTime = Math.max(Date.now(), this.lastTime + 1);
    return this.lastTime;
  }

  private at(path: string): unknown {
    let node: unknown = this.root;
    for (const part of parts(path)) {
      if (!node || typeof node !== 'object') return undefined;
      node = (node as Tree)[part];
    }
    return node;
  }

  private set(path: string, value: unknown): void {
    const keys = parts(path);
    let node = this.root;
    for (const key of keys.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      node = node[key] as Tree;
    }
    const last = keys[keys.length - 1];
    if (value === null || value === undefined) delete node[last];
    else node[last] = value;
    prune(this.root);
  }
}

function parts(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function clone(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function resolve(value: unknown, current: unknown, now: number): unknown {
  if (value === SERVER_TIME || (value && typeof value === 'object' && (value as Tree)['.sv'] === 'timestamp')) return now;
  if (isIncrement(value)) return (typeof current === 'number' ? current : 0) + value.increment;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Tree = {};
    for (const [key, child] of Object.entries(value as Tree)) {
      const resolved = resolve(child, (current as Tree | undefined)?.[key], now);
      if (resolved !== null && resolved !== undefined) out[key] = resolved;
    }
    return out;
  }
  return value;
}

/** Firebase keeps no empty objects. */
function prune(node: Tree): void {
  for (const [key, child] of Object.entries(node)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      prune(child as Tree);
      if (Object.keys(child as Tree).length === 0) delete node[key];
    }
  }
}
