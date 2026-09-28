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
  const allowed = new Set([workspaceId]);
  let disconnected = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith('/sync/preflight')) return allowed.has(body.workspaceId)
      ? new Response(JSON.stringify({ accountId: 'self-host-owner', workspaceId: body.workspaceId }), { status: 200 })
      : new Response('{}', { status: 403 });
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
  return { service, config, grant: (id: string) => { allowed.add(id); } };
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
  const authenticatedFetch = fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => String(url).endsWith('/sync/preflight')
    ? new Response('{}', { status: 401 }) : authenticatedFetch(url, init)));
  const denied = await clientB.run();
  expect(denied.status).toBe('failed');
  expect(denied.error).toBe('sync-auth');
  expect(denied.conflict).toBeNull();
  vi.stubGlobal('fetch', authenticatedFetch);
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

it('refuses asset transfer when a local record references a photo', async () => {
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
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sync/push') || String(url).endsWith('/sync/pull'))).toBe(false);
  await db.close();
});

it('rejects a different workspace key before asset transfer', async () => {
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
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sync/push') || String(url).endsWith('/sync/pull'))).toBe(false);
  await db.close();
});

it('sends independent local records in one bounded push request', async () => {
  const { config } = server(crypto.randomUUID());
  const db = await openLocalRepository(name());
  for (let index = 0; index < 3; index++) await db.save('asset', { ...newAsset('project'), name: `Batch ${index}` });
  expect((await new SelfHostSyncClient(db, config).run()).status).toBe('synced');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/sync/push'))).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/sync/pull'))).toHaveLength(3);
  await db.close();
});

it('binds one local dataset to one remote and rejects workspace, endpoint and account switches without transfer', async () => {
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const { service, config, grant } = server(workspaceA);
  grant(workspaceB);
  const db = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Only in A' };
  await db.save('asset', asset);
  const a = new SelfHostSyncClient(db, config);
  expect((await a.run()).status).toBe('synced');
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockClear();
  const b = new SelfHostSyncClient(db, { ...config, workspaceId: workspaceB });
  expect((await b.report()).error).toBe('sync-dataset-bound');
  expect((await b.run()).error).toBe('sync-dataset-bound');
  expect((await service.pull({ workspaceId: workspaceB, cursor: 0, limit: 10 })).changes).toHaveLength(0);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sync/push') || String(url).endsWith('/sync/pull'))).toBe(false);
  const endpointChanged = new SelfHostSyncClient(db, { ...config, endpoint: 'http://127.0.0.1:3200' });
  expect((await endpointChanged.run()).error).toBe('sync-dataset-bound');
  const originalFetch = fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => String(url).endsWith('/sync/preflight')
    ? new Response(JSON.stringify({ accountId: 'another-owner', workspaceId: config.workspaceId }), { status: 200 }) : originalFetch(url, init)));
  expect((await a.run()).error).toBe('sync-account-mismatch');
  vi.stubGlobal('fetch', originalFetch);
  await db.save('asset', { ...asset, name: 'Back in A' });
  expect((await a.run()).status).toBe('synced');
  expect((await service.pull({ workspaceId: workspaceA, cursor: 0, limit: 10 })).changes).toHaveLength(2);
  await db.close();
});

it('does not bind an unrecognized workspace and can sync the corrected workspace after reopen', async () => {
  const validWorkspace = crypto.randomUUID();
  const { service, config } = server(validWorkspace);
  const dbName = name();
  const db = await openLocalRepository(dbName);
  const asset = { ...newAsset('project'), name: 'Preserved locally' };
  await db.save('asset', asset);
  const wrong = new SelfHostSyncClient(db, { ...config, workspaceId: crypto.randomUUID() });
  expect((await wrong.run()).error).toBe('sync-auth');
  expect(await db.getDatasetBinding()).toBeNull();
  expect(await db.fileStore.scopedMeta.count()).toBe(0);
  await db.close();
  const reopened = await openLocalRepository(dbName);
  expect(await reopened.getDatasetBinding()).toBeNull();
  expect((await new SelfHostSyncClient(reopened, config).run()).status).toBe('synced');
  expect((await service.pull({ workspaceId: validWorkspace, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('Preserved locally');
  await reopened.close();
});

it('does not bind when workspace preflight fails on the network', async () => {
  const { config } = server(crypto.randomUUID());
  const authenticatedFetch = fetch;
  const db = await openLocalRepository(name());
  await db.save('asset', { ...newAsset('project'), name: 'Still local' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => String(url).endsWith('/sync/preflight')
    ? Promise.reject(Error('offline')) : authenticatedFetch(url, init)));
  expect((await new SelfHostSyncClient(db, config).run()).error).toBe('offline');
  expect(await db.getDatasetBinding()).toBeNull();
  vi.stubGlobal('fetch', authenticatedFetch);
  expect((await new SelfHostSyncClient(db, config).run()).status).toBe('synced');
  await db.close();
});

it('allows only one remote to claim an initially unbound dataset across concurrent sync clients', async () => {
  const workspaceA = crypto.randomUUID();
  const workspaceB = crypto.randomUUID();
  const { config, grant, service } = server(workspaceA);
  grant(workspaceB);
  const db = await openLocalRepository(name());
  await db.save('asset', { ...newAsset('project'), name: 'Shared local row' });
  const [a, b] = await Promise.all([
    new SelfHostSyncClient(db, config).run(),
    new SelfHostSyncClient(db, { ...config, workspaceId: workspaceB }).run(),
  ]);
  expect([a.status, b.status].sort()).toEqual(['failed', 'synced']);
  expect([a.error, b.error]).toContain('sync-dataset-bound');
  const aChanges = (await service.pull({ workspaceId: workspaceA, cursor: 0, limit: 10 })).changes;
  const bChanges = (await service.pull({ workspaceId: workspaceB, cursor: 0, limit: 10 })).changes;
  expect(aChanges.length + bChanges.length).toBe(1);
  await db.close();
});

it('rejects a malformed pull page before writing any record or cursor', async () => {
  const workspaceId = crypto.randomUUID();
  const { config } = server(workspaceId);
  const remoteId = `asset:${crypto.randomUUID()}`;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith('/sync/preflight')
    ? { accountId: 'self-host-owner', workspaceId } : { changes: [{
      operationId: crypto.randomUUID(), id: remoteId, kind: 'asset', schemaVersion: 1,
      ciphertext: 'opaque', tombstone: false, version: 1, sequence: 1,
    }], nextCursor: 2 }), { status: 200 })));
  const db = await openLocalRepository(name());
  const result = await new SelfHostSyncClient(db, config).run();
  expect(result.status).toBe('failed');
  expect(result.error).toBe('sync-cursor');
  expect(result.cursor).toBe(0);
  expect(await db.allRecords()).toEqual([]);
  await db.close();
});

async function scope(config: { endpoint: string; token: string }): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.endpoint, 'self-host-owner']))));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
