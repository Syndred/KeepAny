import { checkHeader, VAULT_MAX_BYTES } from '../../password-vault/src/header';

export interface VaultRecord { id: 'local'; revision: string; bytes: Uint8Array; updatedAt: string }
export const PASSWORD_VAULT_LIMIT = VAULT_MAX_BYTES;

// Only encrypted KDBX files are admitted to this store. Opening and decrypting
// the complete format belongs to the password engine, never the asset payload.
export function checkedPasswordVaultBytes(input: Uint8Array): Uint8Array {
  checkHeader(input);
  return new Uint8Array(input);
}

export function checkedPasswordVaultRecord(input: VaultRecord): VaultRecord {
  if (input?.id !== 'local' || typeof input.revision !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.revision) ||
    !z.string().datetime().safeParse(input.updatedAt).success) throw Error('vault-invalid');
  return { id: 'local', revision: input.revision, updatedAt: input.updatedAt, bytes: checkedPasswordVaultBytes(input.bytes) };
}
import { z } from 'zod';
