import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import {
  AttachmentConflictError, AttachmentIntegrityError, AttachmentInvalidError, AttachmentNotFoundError, AttachmentService,
  type CiphertextObjectStore,
} from './attachments';
import { PostgresSyncService, SyncForbiddenError, type SqlPool } from './postgres';

const migrations = await Promise.all(['001_sync', '002_attachments'].map(id =>
  readFile(new URL(`../../../apps/sync-server/migrations/${id}.sql`, import.meta.url), 'utf8')));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const pg = new PGlite();
  for (const migration of migrations) await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({
    query: async (text, values) => pg.query(text, values), release: () => {},
  }) };
  const objects = new Map<string, Uint8Array>();
  let failNextPut = false;
  const store: CiphertextObjectStore = {
    put: async (key, bytes) => {
      if (failNextPut) { failNextPut = false; throw Error('object-store-offline'); }
      objects.set(key, Uint8Array.from(bytes));
    },
    get: async key => objects.get(key) ?? null,
  };
  return { pg, service: new AttachmentService(pool, store), sync: new PostgresSyncService(pool), objects,
    failNext: () => { failNextPut = true; } };
}

it('binds ciphertext objects to authorized workspace members and rejects ID reuse with different bytes', async () => {
  const { pg, service, sync, objects } = await fixture();
  try {
    const alice = await sync.createWorkspace('alice');
    const bob = await sync.createWorkspace('bob');
    const attachmentId = crypto.randomUUID();
    const bytes = Uint8Array.from([33, 44, 55, 66]);
    const input = { workspaceId: alice, attachmentId, sha256: sha(bytes), bytes };
    await expect(service.put(input, 'bob')).rejects.toBeInstanceOf(SyncForbiddenError);
    expect(objects.size).toBe(0);
    expect(await service.put(input, 'alice')).toMatchObject({ status: 'stored', sha256: sha(bytes), size: bytes.length });
    expect(await service.put(input, 'alice')).toMatchObject({ status: 'duplicate' });
    expect((await service.get(alice, attachmentId, 'alice')).bytes).toEqual(bytes);
    await expect(service.get(alice, attachmentId, 'bob')).rejects.toBeInstanceOf(SyncForbiddenError);
    await expect(service.put({ ...input, bytes: Uint8Array.from([1]), sha256: sha(Uint8Array.from([1])) }, 'alice'))
      .rejects.toBeInstanceOf(AttachmentConflictError);
    await expect(service.put({ ...input, sha256: '0'.repeat(64) }, 'alice')).rejects.toBeInstanceOf(AttachmentInvalidError);
    expect(await service.put({ ...input, workspaceId: bob }, 'bob')).toMatchObject({ status: 'stored' });
    expect(objects.size).toBe(2);
  } finally { await pg.close(); }
}, 20_000);

it('retries a pending upload after object-store interruption and refuses corrupted readback', async () => {
  const { pg, service, sync, objects, failNext } = await fixture();
  try {
    const workspaceId = await sync.createWorkspace('alice');
    const attachmentId = crypto.randomUUID();
    const bytes = Uint8Array.from([71, 72, 73]);
    const input = { workspaceId, attachmentId, sha256: sha(bytes), bytes };
    failNext();
    await expect(service.put(input, 'alice')).rejects.toThrow('object-store-offline');
    const pending = await pg.query<{ status: string }>('SELECT status FROM sync_attachments WHERE workspace_id=$1', [workspaceId]);
    expect(pending.rows[0].status).toBe('pending');
    await expect(service.get(workspaceId, attachmentId, 'alice')).rejects.toBeInstanceOf(AttachmentNotFoundError);
    expect(await service.put(input, 'alice')).toMatchObject({ status: 'stored' });
    objects.set(`${workspaceId}/${attachmentId}`, Uint8Array.from([99, 99, 99]));
    await expect(service.get(workspaceId, attachmentId, 'alice')).rejects.toBeInstanceOf(AttachmentIntegrityError);
    expect(await service.put(input, 'alice')).toMatchObject({ status: 'duplicate' });
    expect((await service.get(workspaceId, attachmentId, 'alice')).bytes).toEqual(bytes);
  } finally { await pg.close(); }
}, 20_000);
