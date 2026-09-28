import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyncApp, JsonFileSyncStateStore, MemorySyncStateStore, SyncService } from './index';
import type { SyncOperation } from '../../contracts/src';

const workspaceId = crypto.randomUUID();
const docId = `asset:${crypto.randomUUID()}`;
const operation = (changes: Partial<SyncOperation> = {}): SyncOperation => ({
  operationId: crypto.randomUUID(), id: docId, kind: 'asset', schemaVersion: 1,
  expectedVersion: 0, ciphertext: 'opaque-ciphertext', tombstone: false, intent: 'write', ...changes,
});
const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('stage 0 sync state machine', () => {
  it('surfaces offline same-record conflicts without dropping either device change', async () => {
    const service = new SyncService(new MemorySyncStateStore());
    const created = (await service.push({ workspaceId, operations: [operation()] })).results[0];
    expect(created).toMatchObject({ status: 'accepted', version: 1, sequence: 1 });
    const deviceA = operation({ expectedVersion: 1, ciphertext: 'device-A-ciphertext' });
    const deviceB = operation({ expectedVersion: 1, ciphertext: 'device-B-ciphertext' });
    expect((await service.push({ workspaceId, operations: [deviceA] })).results[0]).toMatchObject({ status: 'accepted', version: 2 });
    expect((await service.push({ workspaceId, operations: [deviceB] })).results[0]).toMatchObject({ status: 'conflict', version: 2, reason: 'version' });
    const pull = await service.pull({ workspaceId, cursor: 0, limit: 100 });
    expect(pull.changes.map(change => change.ciphertext)).toEqual(['opaque-ciphertext', 'device-A-ciphertext']);
    expect(pull.nextCursor).toBe(2);
  });

  it('keeps tombstones, rejects a fresh silent resurrection, and requires explicit restore', async () => {
    const service = new SyncService(new MemorySyncStateStore());
    await service.push({ workspaceId, operations: [operation()] });
    expect((await service.push({ workspaceId, operations: [operation({ expectedVersion: 1, tombstone: true, ciphertext: 'encrypted-delete' })] })).results[0].version).toBe(2);
    expect((await service.push({ workspaceId, operations: [operation({ expectedVersion: 1, ciphertext: 'stale-write' })] })).results[0]).toMatchObject({ status: 'conflict', reason: 'version' });
    expect((await service.push({ workspaceId, operations: [operation({ expectedVersion: 2, ciphertext: 'fresh-write' })] })).results[0]).toMatchObject({ status: 'conflict', reason: 'tombstone' });
    expect((await service.push({ workspaceId, operations: [operation({ expectedVersion: 2, ciphertext: 'explicit-restore', intent: 'restore' })] })).results[0]).toMatchObject({ status: 'accepted', version: 3 });
  });

  it('treats repeat pushes as duplicates and rejects operation-id reuse with changed content', async () => {
    const service = new SyncService(new MemorySyncStateStore());
    const first = operation();
    expect((await service.push({ workspaceId, operations: [first] })).results[0].status).toBe('accepted');
    expect((await service.push({ workspaceId, operations: [first] })).results[0]).toMatchObject({ status: 'duplicate', version: 1, sequence: 1 });
    expect((await service.push({ workspaceId, operations: [{ ...first, ciphertext: 'different' }] })).results[0]).toMatchObject({ status: 'rejected', reason: 'operation-reused' });
    expect((await service.pull({ workspaceId, cursor: 0, limit: 100 })).changes).toHaveLength(1);
  });

  it('recovers a partially committed cross-kind batch after network failure and process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepany-sync-'));
    temporary.push(directory);
    const store = new JsonFileSyncStateStore(join(directory, 'state.json'));
    const operations: SyncOperation[] = [
      operation(),
      operation({ id: `relation:${crypto.randomUUID()}`, kind: 'relation', ciphertext: 'relation-ciphertext' }),
      operation({ id: `task:${crypto.randomUUID()}`, kind: 'task', ciphertext: 'task-ciphertext' }),
    ];
    let committed = false;
    const interrupted = new SyncService(store, () => { if (!committed) { committed = true; throw Error('network-disconnected'); } });
    await expect(interrupted.push({ workspaceId, operations })).rejects.toThrow('network-disconnected');
    const resumed = new SyncService(new JsonFileSyncStateStore(join(directory, 'state.json')));
    expect((await resumed.push({ workspaceId, operations })).results.map(result => result.status)).toEqual(['duplicate', 'accepted', 'accepted']);
    const firstPage = await resumed.pull({ workspaceId, cursor: 0, limit: 2 });
    const secondPage = await resumed.pull({ workspaceId, cursor: firstPage.nextCursor, limit: 2 });
    expect([...firstPage.changes, ...secondPage.changes].map(change => change.kind)).toEqual(['asset', 'relation', 'task']);
    expect(secondPage.nextCursor).toBe(3);
  });

  it('enforces the HTTP workspace boundary and validated request contract', async () => {
    const service = new SyncService(new MemorySyncStateStore());
    const app = createSyncApp(service, async (authorization, scope) => authorization === `Bearer ${scope}` ? workspaceId : null);
    const body = JSON.stringify({ workspaceId, operations: [operation()] });
    expect((await app.request('/sync/push', { method: 'POST', body, headers: { 'content-type': 'application/json' } })).status).toBe(401);
    expect((await app.request('/sync/push', { method: 'POST', body: JSON.stringify({ workspaceId: crypto.randomUUID(), operations: [operation()] }), headers: { authorization: 'Bearer sync:write', 'content-type': 'application/json' } })).status).toBe(403);
    expect((await app.request('/sync/push', { method: 'POST', body: '{}', headers: { authorization: 'Bearer sync:write', 'content-type': 'application/json' } })).status).toBe(400);
    const accepted = await app.request('/sync/push', { method: 'POST', body, headers: { authorization: 'Bearer sync:write', 'content-type': 'application/json' } });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).results[0].status).toBe('accepted');
    const pull = await app.request('/sync/pull', { method: 'POST', body: JSON.stringify({ workspaceId, cursor: 0 }), headers: { authorization: 'Bearer sync:read', 'content-type': 'application/json' } });
    expect(pull.status).toBe(200);
    expect((await pull.json()).changes).toHaveLength(1);
  });
});
