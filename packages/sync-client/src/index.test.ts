import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository } from '../../local-db/src';
import { MemorySyncStateStore, SyncService } from '../../sync-core/src';
import { SelfHostSyncClient, decodeWorkspaceKey, encodeWorkspaceKey, normalizeEndpoint } from './index';

afterEach(() => vi.unstubAllGlobals());
const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const token = 't'.repeat(40);
const endpoint = 'http://127.0.0.1:3199';

function server(workspaceId: string, disconnectAfterFirstPush = false) {
  const service = new SyncService(new MemorySyncStateStore());
  let disconnected = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith('/sync/push')) {
      const result = await service.push(body);
      if (disconnectAfterFirstPush && !disconnected) { disconnected = true; throw Error('offline'); }
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (url.endsWith('/sync/pull')) return new Response(JSON.stringify(await service.pull(body)), { status: 200 });
    throw Error('route');
  }));
  const key = new Uint8Array(32).fill(7);
  const config = { endpoint, token, workspaceId, key };
  return { service, config };
}

it('retries the same encrypted operation after server acceptance and browser interruption', async () => {
  const workspaceId = crypto.randomUUID();
  const { service, config } = server(workspaceId, true);
  const dbName = name();
  const db = await openLocalRepository(dbName);
  const asset = { ...newAsset('project'), name: 'Durable' };
  await db.save('asset', asset);
  const first = new SelfHostSyncClient(db, config);
  expect((await first.run()).status).toBe('failed');
  const accepted = (await service.pull({ workspaceId, cursor: 0, limit: 1 })).changes[0];
  await db.close();
  const reopened = await openLocalRepository(dbName);
  const second = new SelfHostSyncClient(reopened, { ...config, token: 'r'.repeat(40) });
  expect((await second.run()).status).toBe('synced');
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  expect((await reopened.listScopedOutbox(`${await scope(config)}:${workspaceId}`))).toHaveLength(0);
  expect(accepted.operationId).toBeTruthy();
  expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('Durable');
  await reopened.close();
});

it('shows a genuine same-record conflict and sends the chosen local edit at the next version', async () => {
  const workspaceId = crypto.randomUUID();
  const { service, config } = server(workspaceId);
  const a = await openLocalRepository(name());
  const b = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Initial' };
  await a.save('asset', asset);
  const clientA = new SelfHostSyncClient(a, config);
  const clientB = new SelfHostSyncClient(b, config);
  expect((await clientA.run()).status).toBe('synced');
  expect((await clientB.run()).status).toBe('synced');
  await a.save('asset', { ...asset, name: 'From A' });
  await b.save('asset', { ...asset, name: 'From B' });
  expect((await clientA.run()).status).toBe('synced');
  const result = await clientB.run();
  expect(result.status).toBe('conflict');
  expect(JSON.parse(result.conflict?.remotePayload ?? '{}').name).toBe('From A');
  expect(JSON.parse(result.conflict?.localPayload ?? '{}').name).toBe('From B');
  expect((await clientB.resolve('local')).status).toBe('pending');
  expect((await clientB.run()).status).toBe('synced');
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes.at(-1)?.version).toBe(3);
  expect((await a.get<Asset>('asset', asset.id))?.name).toBe('From A');
  expect((await b.get<Asset>('asset', asset.id))?.name).toBe('From B');
  await a.close();
  await b.close();
});

it('syncs a tombstone and requires explicit local restore before reviving a record', async () => {
  const workspaceId = crypto.randomUUID();
  const { service, config } = server(workspaceId);
  const a = await openLocalRepository(name());
  const b = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Reversible' };
  await a.save('asset', asset);
  const clientA = new SelfHostSyncClient(a, config);
  const clientB = new SelfHostSyncClient(b, config);
  expect((await clientA.run()).status).toBe('synced');
  expect((await clientB.run()).status).toBe('synced');
  await a.deleteEntity('asset', asset.id);
  expect((await clientA.run()).status).toBe('synced');
  expect((await clientB.run()).status).toBe('synced');
  expect((await b.get<Asset>('asset', asset.id))?.deleted).toBe(true);
  await b.restoreEntity('asset', asset.id);
  expect((await clientB.run()).status).toBe('synced');
  const changes = (await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes;
  expect(changes.map(change => change.tombstone)).toEqual([false, true, false]);
  expect(changes.map(change => change.version)).toEqual([1, 2, 3]);
  await a.close();
  await b.close();
});

it('clears a rejected pending write when the server already has the same final record', async () => {
  const workspaceId = crypto.randomUUID();
  const { config } = server(workspaceId);
  const a = await openLocalRepository(name());
  const b = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Initial' };
  await a.save('asset', asset);
  const clientA = new SelfHostSyncClient(a, config);
  const clientB = new SelfHostSyncClient(b, config);
  await clientA.run();
  await clientB.run();
  await a.save('asset', { ...asset, name: 'Same' });
  await b.save('asset', { ...asset, name: 'Same' });
  await clientA.run();
  const result = await clientB.run();
  expect(result.status).toBe('synced');
  expect(result.pending).toBe(0);
  await a.close();
  await b.close();
});

it('rejects unsafe URLs and checks the required 32-byte workspace key', () => {
  expect(normalizeEndpoint('https://example.com/')).toBe('https://example.com');
  expect(() => normalizeEndpoint('http://example.com')).toThrow('sync-endpoint');
  expect(() => normalizeEndpoint('https://user:pass@example.com')).toThrow('sync-endpoint');
  const key = new Uint8Array(32).fill(9);
  expect(decodeWorkspaceKey(encodeWorkspaceKey(key))).toEqual(key);
  expect(() => decodeWorkspaceKey('bad')).toThrow('sync-key');
});

it('refuses all network writes when a local record references a photo', async () => {
  const workspaceId = crypto.randomUUID();
  const { config } = server(workspaceId);
  const fetchMock = vi.mocked(fetch);
  const db = await openLocalRepository(name());
  const attachmentId = crypto.randomUUID();
  await db.fileStore.blobs.add({ id: attachmentId, blob: new Blob(['photo'], { type: 'image/png' }), name: 'photo.png' });
  await db.save('asset', { ...newAsset('project'), name: 'Has photo', attachments: [attachmentId] });
  const report = await new SelfHostSyncClient(db, config).run();
  expect(report.status).toBe('failed');
  expect(report.error).toBe('sync-attachments-unsupported');
  expect(fetchMock).not.toHaveBeenCalled();
  await db.close();
});

it('rejects a different workspace key before making another network request', async () => {
  const { config } = server(crypto.randomUUID());
  const db = await openLocalRepository(name());
  await db.save('asset', { ...newAsset('project'), name: 'Pinned key' });
  expect((await new SelfHostSyncClient(db, config).run()).status).toBe('synced');
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockClear();
  const wrong = new SelfHostSyncClient(db, { ...config, key: new Uint8Array(32).fill(8) });
  const report = await wrong.run();
  expect(report.status).toBe('failed');
  expect(report.error).toBe('sync-key-mismatch');
  expect(fetchMock).not.toHaveBeenCalled();
  await db.close();
});

async function scope(config: { endpoint: string; token: string }): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.endpoint, 'self-host-owner']))));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
