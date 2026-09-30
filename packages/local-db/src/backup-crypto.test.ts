import { afterEach, expect, it, vi } from 'vitest';
import { BACKUP_ARCHIVE_MAX_BYTES, BACKUP_CONTAINER_MAX_BYTES, decryptBackup, encryptBackup } from './backup-crypto';

afterEach(() => vi.restoreAllMocks());

// Boundary checks use mocked primitives so large buffers do not perform PBKDF2 or AES.
function mockPrimitives() {
  const operations: string[] = [];
  const opaqueKey = {} as CryptoKey;
  vi.spyOn(crypto.subtle, 'importKey').mockImplementation(async () => { operations.push('importKey'); return opaqueKey; });
  vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async () => { operations.push('deriveKey'); return opaqueKey; });
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async () => { operations.push('encrypt'); return new ArrayBuffer(16); });
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async () => { operations.push('decrypt'); return new ArrayBuffer(0); });
  return operations;
}

const archiveLimit = BACKUP_ARCHIVE_MAX_BYTES;
const containerLimit = BACKUP_CONTAINER_MAX_BYTES;

it('matches the archive limit and fixed encrypted-container overhead', () => {
  expect(archiveLimit).toBe(100 * 1024 * 1024);
  expect(containerLimit).toBe(archiveLimit + 52);
});

it('rejects plaintext above the archive limit before cryptography', async () => {
  const operations = mockPrimitives();
  let reason: string | undefined;
  try { await encryptBackup(new Uint8Array(archiveLimit + 1), 'synthetic-test-password'); }
  catch (error) { reason = error instanceof Error ? error.message : undefined; }
  expect(reason).toBe('backup-size');
  expect(operations).toEqual([]);
});

it('rejects a container above the size limit before cryptography', async () => {
  const operations = mockPrimitives();
  const bytes = new Uint8Array(containerLimit + 1);
  bytes.set(new TextEncoder().encode('KEEPANY1'));
  let reason: string | undefined;
  try { await decryptBackup(bytes, 'synthetic-test-password'); }
  catch (error) { reason = error instanceof Error ? error.message : undefined; }
  expect(reason).toBe('backup-size');
  expect(operations).toEqual([]);
});

it('allows exactly the plaintext size limit to reach encryption', async () => {
  const operations = mockPrimitives();
  await encryptBackup(new Uint8Array(archiveLimit), 'synthetic-test-password');
  expect(operations).toEqual(['importKey', 'deriveKey', 'encrypt']);
});

it('allows exactly the container size limit to reach decryption', async () => {
  const operations = mockPrimitives();
  const bytes = new Uint8Array(containerLimit);
  bytes.set(new TextEncoder().encode('KEEPANY1'));
  await decryptBackup(bytes, 'synthetic-test-password');
  expect(operations).toEqual(['importKey', 'deriveKey', 'decrypt']);
});

it('rejects a short password and malformed containers before cryptography', async () => {
  const operations = mockPrimitives();
  await expect(encryptBackup(new Uint8Array(1), '12345678901')).rejects.toThrow('password');
  await expect(decryptBackup(new Uint8Array(51), 'synthetic-test-password')).rejects.toThrow('format');
  await expect(decryptBackup(new Uint8Array(52), 'synthetic-test-password')).rejects.toThrow('format');
  expect(operations).toEqual([]);
});

it('round-trips an encrypted backup and rejects a changed ciphertext', async () => {
  const original = new Uint8Array([1, 2, 3, 4, 5]);
  const password = '123456789012';
  const encrypted = await encryptBackup(original, password);
  expect(encrypted.length).toBe(original.length + 52);
  expect(Array.from(await decryptBackup(encrypted, password))).toEqual(Array.from(original));
  const altered = encrypted.slice();
  altered[altered.length - 1] ^= 1;
  await expect(decryptBackup(altered, password)).rejects.toThrow();
  await expect(decryptBackup(encrypted, 'wrong-test-password')).rejects.toThrow();
});
