import { expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from './backup-crypto';

it('round-trips an encrypted backup and rejects a changed ciphertext', async () => {
  const original = new Uint8Array([1, 2, 3, 4, 5]);
  const password = 'a-long-test-password';
  const encrypted = await encryptBackup(original, password);
  expect(Array.from(await decryptBackup(encrypted, password))).toEqual(Array.from(original));
  const altered = encrypted.slice();
  altered[altered.length - 1] ^= 1;
  await expect(decryptBackup(altered, password)).rejects.toThrow();
  await expect(decryptBackup(encrypted, 'wrong-test-password')).rejects.toThrow();
});
