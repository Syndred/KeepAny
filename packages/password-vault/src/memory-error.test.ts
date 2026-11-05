import { afterEach, describe, expect, it, vi } from 'vitest';
import { argon2d, argon2id } from 'hash-wasm';
import { Consts, CryptoEngine, Int64, Kdbx } from 'kdbxweb';
import { configureDatabase, credentials, safeError } from './engine';
import { VaultSession } from './session';
import type { VaultPersistence, VaultRecord } from './types';

vi.mock('hash-wasm', async (original) => {
  const actual = await original<typeof import('hash-wasm')>();
  return { ...actual, argon2d: vi.fn(actual.argon2d), argon2id: vi.fn(actual.argon2id) };
});
afterEach(() => { vi.mocked(argon2d).mockClear(); vi.mocked(argon2id).mockClear(); });
const run = (type: 0 | 2 = CryptoEngine.Argon2TypeArgon2id, memory = 65536) => CryptoEngine.argon2(new Uint8Array(32).buffer, new Uint8Array(32).buffer, memory, 3, 32, 1, type, 0x13);

describe('KDBX KDF allocation errors', () => {
  it('classifies the captured WASM growth failure without changing the 64 MiB request', async () => {
    vi.mocked(argon2id).mockRejectedValueOnce(new RangeError('Invalid typed array length: 67109888'));
    await expect(run()).rejects.toThrow('vault-memory');
    expect(argon2id).toHaveBeenLastCalledWith(expect.objectContaining({ memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 }));
    expect(safeError(Error('vault-memory')).message).toBe('vault-memory');
  });
  it('classifies an allocation failure for the supported Argon2d path too', async () => {
    vi.mocked(argon2d).mockRejectedValueOnce(new RangeError('Array buffer allocation failed'));
    await expect(run(CryptoEngine.Argon2TypeArgon2d)).rejects.toThrow('vault-memory');
  });
  it('does not turn unrelated input or program errors into memory errors', async () => {
    vi.mocked(argon2id).mockRejectedValueOnce(new RangeError('Synthetic unrelated range failure'));
    await expect(run()).rejects.toThrow('Synthetic unrelated range failure');
    vi.mocked(argon2id).mockRejectedValueOnce(new TypeError('Invalid typed array length: 67109888'));
    await expect(run()).rejects.toBeInstanceOf(TypeError);
    expect(safeError(new RangeError('Synthetic unrelated range failure')).message).toBe('vault-invalid');
  });
  it('rejects an over-budget KDF before invoking the library', async () => {
    await expect(run(CryptoEngine.Argon2TypeArgon2id, 128 * 1024 + 1)).rejects.toThrow('vault-kdf');
    expect(argon2id).not.toHaveBeenCalled();
  });
  it('continues to write 64 MiB, three passes and Argon2id into new KDBX headers', () => {
    const database = Kdbx.create(credentials('SyntheticMemoryCheck2026!', true), 'Synthetic');
    configureDatabase(database);
    const params = database.header.kdfParameters!;
    expect((params.get('M') as Int64).value).toBe(64 * 1024 * 1024);
    expect((params.get('I') as Int64).value).toBe(3);
    expect(params.get('P')).toBe(1);
    expect(params.get('$UUID')).toEqual(Uint8Array.from(atob(Consts.KdfId.Argon2id), c => c.charCodeAt(0)).buffer);
  });
  it('leaves the committed entry and revision intact on allocation failure and supports an explicit retry', async () => {
    let record: VaultRecord | null = null, writes = 0;
    const storage: VaultPersistence = { read: async () => record, write: async (bytes, expected) => {
      if ((record?.revision ?? null) !== expected) throw Error('vault-stale');
      writes++; record = { id: 'local', revision: crypto.randomUUID(), bytes: bytes.slice(), updatedAt: new Date().toISOString() }; return record;
    } };
    const session = new VaultSession(storage); await session.initialize(); await session.create('SyntheticMemoryFailure2026!');
    try {
      const id = await session.saveEntry({ title: 'Synthetic memory test', username: 'synthetic@example.test', password: 'SyntheticOnly', notes: 'Original note', url: '', linkedAssetIds: [] });
      const original = session.readEntry(id), proposed = { ...original, notes: 'Changed note' }, revision = session.getSnapshot().revision, previousWrites = writes;
      vi.mocked(argon2id).mockRejectedValueOnce(new RangeError('Invalid typed array length: 67109888'));
      await expect(session.saveEntryIfCurrent(proposed, original)).rejects.toThrow('vault-memory');
      expect(writes).toBe(previousWrites); expect(session.getSnapshot().revision).toBe(revision); expect(session.readEntry(id)).toEqual(original);
      await session.saveEntryIfCurrent(proposed, original);
      expect(session.readEntry(id).notes).toBe('Changed note'); expect(session.history(id)).toHaveLength(1);
    } finally { session.lock(); }
  }, 60000);
});
