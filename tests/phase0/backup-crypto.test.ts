import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from '../../packages/local-db/src/backup-crypto';

const password = 'phase-zero-test-password';
const payload = new TextEncoder().encode('KeepAny local backup tamper test');

describe('versioned encrypted local backup container', () => {
  it('round trips bytes and uses a fresh salt and IV', async () => {
    const first = await encryptBackup(payload, password);
    const second = await encryptBackup(payload, password);
    expect(Array.from(await decryptBackup(first, password))).toEqual(Array.from(payload));
    expect(first).not.toEqual(second);
  });

  it('rejects short passwords and incorrect credentials', async () => {
    await expect(encryptBackup(payload, 'short')).rejects.toThrow('password');
    await expect(decryptBackup(await encryptBackup(payload, password), 'wrong-password')).rejects.toThrow();
  });

  it.each([0, 8, 24, 36, 50])('rejects a one-byte mutation at offset %i', async offset => {
    const bytes = await encryptBackup(payload, password);
    bytes[offset] ^= 0x01;
    await expect(decryptBackup(bytes, password)).rejects.toThrow();
  });

  it('rejects truncation and unsupported header', async () => {
    const bytes = await encryptBackup(payload, password);
    await expect(decryptBackup(bytes.slice(0, 51), password)).rejects.toThrow('format');
    await expect(decryptBackup(bytes.slice(0, -1), password)).rejects.toThrow();
    bytes[0] = 0;
    await expect(decryptBackup(bytes, password)).rejects.toThrow('format');
  });

  it('documents that a valid backup ciphertext can be replayed', async () => {
    const bytes = await encryptBackup(payload, password);
    expect(await decryptBackup(bytes, password)).toEqual(await decryptBackup(bytes, password));
  });
});
