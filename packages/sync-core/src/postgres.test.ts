import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { SyncOperation } from '../../contracts/src';
import { generateWorkspaceKey, openEnvelope, ReplayGuard, sealEnvelope } from '../../crypto/src';
import { PostgresSyncService, SyncForbiddenError, type SqlPool } from './postgres';

const migrations = await Promise.all(['001_sync', '003_change_operation_id'].map(id =>
  readFile(new URL(`../../../apps/sync-server/migrations/${id}.sql`, import.meta.url), 'utf8')));
const operation = (id: string, changes: Partial<SyncOperation> = {}): SyncOperation => ({
  operationId: crypto.randomUUID(), id, kind: 'asset', schemaVersion: 1,
  expectedVersion: 0, ciphertext: 'opaque-ciphertext', tombstone: false, intent: 'write', ...changes,
});
async function fixture() {
  const pg = new PGlite();
  for (const migration of migrations) await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({
    query: async (text, values) => pg.query(text, values),
    release: () => {},
  }) };
  return { pg, service: new PostgresSyncService(pool) };
}

describe('PostgreSQL transaction sync', () => {
  it('returns enough pull metadata to authenticate an encrypted envelope', async () => {
    const { pg, service } = await fixture();
    try {
      const workspaceId = await service.createWorkspace('alice');
      const id = `asset:${crypto.randomUUID()}`;
      const operationId = crypto.randomUUID();
      const key = await generateWorkspaceKey();
      const envelope = await sealEnvelope(new TextEncoder().encode('private-value'), key, {
        workspaceId, recordId: id, schemaVersion: 1, keyEpoch: 1, sequence: 1, operationId, tombstone: false,
      });
      await service.push({ workspaceId, operations: [operation(id, {
        operationId, ciphertext: JSON.stringify(envelope),
      })] }, 'alice');
      const change = (await service.pull({ workspaceId, cursor: 0, limit: 1 }, 'alice')).changes[0];
      const plaintext = await openEnvelope(JSON.parse(change.ciphertext), key, {
        workspaceId, recordId: change.id, schemaVersion: change.schemaVersion, keyEpoch: 1,
        sequence: change.sequence, operationId: change.operationId, tombstone: change.tombstone,
      }, new ReplayGuard());
      expect(new TextDecoder().decode(plaintext)).toBe('private-value');
    } finally { await pg.close(); }
  }, 20_000);

  it('persists idempotent operations, version conflicts and tombstones', async () => {
    const { pg, service } = await fixture();
    try {
      const workspaceId = await service.createWorkspace('alice');
      const id = `asset:${crypto.randomUUID()}`;
      const first = operation(id);
      expect((await service.push({ workspaceId, operations: [first] }, 'alice')).results[0]).toMatchObject({ status: 'accepted', version: 1, sequence: 1 });
      expect((await service.push({ workspaceId, operations: [first] }, 'alice')).results[0]).toMatchObject({ status: 'duplicate', version: 1, sequence: 1 });
      expect((await service.pull({ workspaceId, cursor: 0, limit: 100 }, 'alice')).changes[0].operationId).toBe(first.operationId);
      expect((await service.push({ workspaceId, operations: [{ ...first, ciphertext: 'changed' }] }, 'alice')).results[0]).toMatchObject({ status: 'rejected', reason: 'operation-reused' });
      expect((await service.push({ workspaceId, operations: [operation(id, { expectedVersion: 0 })] }, 'alice')).results[0]).toMatchObject({ status: 'conflict', version: 1 });
      expect((await service.push({ workspaceId, operations: [operation(id, { expectedVersion: 1, tombstone: true })] }, 'alice')).results[0]).toMatchObject({ status: 'accepted', version: 2, sequence: 2 });
      expect((await service.push({ workspaceId, operations: [operation(id, { expectedVersion: 2 })] }, 'alice')).results[0]).toMatchObject({ status: 'conflict', reason: 'tombstone' });
      expect((await service.push({ workspaceId, operations: [operation(id, { expectedVersion: 2, intent: 'restore' })] }, 'alice')).results[0]).toMatchObject({ status: 'accepted', version: 3, sequence: 3 });
      const count = await pg.query<{ count: string }>('SELECT count(*)::text AS count FROM sync_changes WHERE workspace_id=$1', [workspaceId]);
      expect(count.rows[0].count).toBe('3');
    } finally { await pg.close(); }
  }, 20_000);

  it('rejects cross-tenant reads and writes, including revoked membership', async () => {
    const { pg, service } = await fixture();
    try {
      const aliceWorkspace = await service.createWorkspace('alice');
      const bobWorkspace = await service.createWorkspace('bob');
      await expect(service.push({ workspaceId: aliceWorkspace, operations: [operation(`asset:${crypto.randomUUID()}`)] }, 'bob')).rejects.toBeInstanceOf(SyncForbiddenError);
      await expect(service.pull({ workspaceId: aliceWorkspace, cursor: 0, limit: 100 }, 'bob')).rejects.toBeInstanceOf(SyncForbiddenError);
      await service.push({ workspaceId: bobWorkspace, operations: [operation(`asset:${crypto.randomUUID()}`)] }, 'bob');
      await pg.query('UPDATE sync_memberships SET revoked_at=now() WHERE workspace_id=$1 AND subject_id=$2', [bobWorkspace, 'bob']);
      await expect(service.pull({ workspaceId: bobWorkspace, cursor: 0, limit: 100 }, 'bob')).rejects.toBeInstanceOf(SyncForbiddenError);
    } finally { await pg.close(); }
  }, 20_000);

  it('rolls back sequence and document writes when a change insert fails', async () => {
    const pg = new PGlite();
    for (const migration of migrations) await pg.exec(migration);
    let failNextChange = true;
    const pool: SqlPool = { connect: async () => ({
      query: async (text, values) => {
        if (text.includes('INSERT INTO sync_changes') && failNextChange) {
          failNextChange = false;
          throw Error('injected-database-failure');
        }
        return pg.query(text, values);
      },
      release: () => {},
    }) };
    const service = new PostgresSyncService(pool);
    try {
      const workspaceId = await service.createWorkspace('alice');
      const change = operation(`asset:${crypto.randomUUID()}`);
      await expect(service.push({ workspaceId, operations: [change] }, 'alice')).rejects.toThrow('injected-database-failure');
      const state = await pg.query<{ next_sequence: string }>('SELECT next_sequence::text FROM sync_workspaces WHERE workspace_id=$1', [workspaceId]);
      expect(state.rows[0].next_sequence).toBe('0');
      expect((await pg.query('SELECT doc_id FROM sync_documents')).rows).toHaveLength(0);
      expect((await service.push({ workspaceId, operations: [change] }, 'alice')).results[0]).toMatchObject({ status: 'accepted', version: 1, sequence: 1 });
    } finally { await pg.close(); }
  }, 20_000);

  it('paginates by workspace sequence and preserves order across record kinds', async () => {
    const { pg, service } = await fixture();
    try {
      const workspaceId = await service.createWorkspace('alice');
      const operations: SyncOperation[] = [
        operation(`asset:${crypto.randomUUID()}`),
        operation(`relation:${crypto.randomUUID()}`, { kind: 'relation' }),
        operation(`task:${crypto.randomUUID()}`, { kind: 'task' }),
      ];
      expect((await service.push({ workspaceId, operations }, 'alice')).results.map(result => result.status)).toEqual(['accepted', 'accepted', 'accepted']);
      const first = await service.pull({ workspaceId, cursor: 0, limit: 2 }, 'alice');
      const second = await service.pull({ workspaceId, cursor: first.nextCursor, limit: 2 }, 'alice');
      expect([...first.changes, ...second.changes].map(change => change.kind)).toEqual(['asset', 'relation', 'task']);
      expect([...first.changes, ...second.changes].map(change => change.operationId))
        .toEqual(operations.map(operation => operation.operationId));
      expect(second.nextCursor).toBe(3);
    } finally { await pg.close(); }
  }, 20_000);
});
