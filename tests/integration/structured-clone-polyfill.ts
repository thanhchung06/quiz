import { deserialize, serialize } from 'node:v8';

/** jsdom lacks structuredClone, which fake-indexeddb needs; import this before it. */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => deserialize(serialize(value));
}
