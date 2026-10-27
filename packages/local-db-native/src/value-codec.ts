import type { NativeStore, FilePointer } from './store';

type Value = null | string | number | boolean | { t: 'array'; v: Value[] } | { t: 'object'; v: [string, Value][] } |
  { t: 'bytes' | 'blob'; v: FilePointer; mime?: string } | { t: 'undefined' };

/** Explicit envelopes prevent user fields from colliding with binary references. */
export async function encodeNativeValue(store: NativeStore, value: unknown): Promise<string> {
  const seen = new Set<object>();
  async function encode(input: unknown, depth = 0): Promise<Value> {
    if (depth > 100) throw Error('native-value-depth');
    if (input === undefined) return { t: 'undefined' };
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || seen.has(input)) throw Error('native-value-format');
    if (input instanceof Uint8Array || input instanceof Blob) {
      const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input.slice();
      const kdbx = bytes[0] === 3 && bytes[1] === 217 && bytes[2] === 162 && bytes[3] === 154;
      const mime = input instanceof Blob ? input.type : 'application/octet-stream';
      return { t: input instanceof Blob ? 'blob' : 'bytes', v: await store.prepareFile(bytes, kdbx ? 'vaults' : 'files', kdbx ? 'password-vault.kdbx' : 'binary', mime), mime };
    }
    seen.add(input);
    try {
      if (Array.isArray(input)) {
        const children: Value[] = [];
        for (const child of input) children.push(await encode(child, depth + 1));
        return { t: 'array', v: children };
      }
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw Error('native-value-format');
      const entries: [string, Value][] = [];
      for (const [key, child] of Object.entries(input)) entries.push([key, await encode(child, depth + 1)]);
      return { t: 'object', v: entries };
    } finally { seen.delete(input); }
  }
  return JSON.stringify({ format: 'keepany-sqlite-value', version: 1, value: await encode(value) });
}
export async function decodeNativeValue<T>(store: NativeStore, json: string): Promise<T> {
  const envelope = JSON.parse(json);
  if (envelope?.format !== 'keepany-sqlite-value' || envelope.version !== 1) throw Error('native-value-format');
  async function decode(value: Value, depth = 0): Promise<unknown> {
    if (depth > 100) throw Error('native-value-depth');
    if (value === null || typeof value !== 'object') return value;
    if (value.t === 'undefined') return undefined;
    if (value.t === 'bytes' || value.t === 'blob') {
      const bytes = await store.readPointer(value.v);
      return value.t === 'bytes' ? bytes : new Blob([bytes as BlobPart], { type: value.mime });
    }
    if (value.t === 'array') return Promise.all(value.v.map(child => decode(child, depth + 1)));
    if (value.t === 'object') return Object.fromEntries(await Promise.all(value.v.map(async ([key, child]) => [key, await decode(child, depth + 1)])));
    throw Error('native-value-format');
  }
  return await decode(envelope.value) as T;
}
