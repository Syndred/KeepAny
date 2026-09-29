import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository } from '../../local-db/src';
import { MemorySyncStateStore, SyncService } from '../../sync-core/src';
import { SelfHostSyncClient, createBoundWorkspace, createSessionWorkspace, decodeWorkspaceKey, encodeWorkspaceKey,
  getBoundIdentity, getSessionIdentity, listBoundWorkspaces, normalizeEndpoint, type BoundSyncAuthorizer } from './index';

afterEach(() => vi.unstubAllGlobals());
const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const token = 't'.repeat(40);
const endpoint = 'http://127.0.0.1:3199';

function server(workspaceId: string, disconnectAfterFirstPush = false, accountId = 'self-host-owner') {
  const service = new SyncService(new MemorySyncStateStore());
  const allowed = new Set([workspaceId]);
  const objects = new Map<string, Uint8Array>();
  let disconnected = false;
  let dropAttachmentAck = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/attachments/')) {
      const id = url.split('/').at(-1) ?? '';
      if (init.method === 'GET') {
        const bytes = objects.get(id);
        return bytes ? new Response(Uint8Array.from(bytes).buffer, { status: 200, headers: {
          'content-type': 'application/vnd.keepany.ciphertext', 'content-length': String(bytes.length),
          'x-ciphertext-sha256': await sha256(bytes),
        } }) : new Response(null, { status: 404 });
      }
      const bytes = new Uint8Array(init.body as ArrayBuffer);
      const previous = objects.get(id);
      if (previous && await sha256(previous) !== await sha256(bytes)) return new Response(null, { status: 409 });
      objects.set(id, Uint8Array.from(bytes));
      if (dropAttachmentAck) { dropAttachmentAck = false; throw Error('offline'); }
      return new Response(JSON.stringify({ sha256: await sha256(bytes), size: bytes.length,
        status: previous ? 'duplicate' : 'stored' }), { status: previous ? 200 : 201 });
    }
    const body = JSON.parse(String(init.body));
    if (url.endsWith('/sync/preflight')) return allowed.has(body.workspaceId)
      ? new Response(JSON.stringify({ accountId, workspaceId: body.workspaceId }), { status: 200 })
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
  return { service, config, objects, dropNextAttachmentAck: () => { dropAttachmentAck = true; },
    grant: (id: string) => { allowed.add(id); } };
}

it('moves a source archive across accounts and remotes with a durable target retry', async () => {
  const sourceWorkspace = crypto.randomUUID();
  const sourceServer = server(sourceWorkspace, false, 'selfhost:source');
  const source = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Cross-account transfer' };
  await source.save('asset', asset);
  const sourceClient = new SelfHostSyncClient(source, {
    endpoint: 'http://127.0.0.1:3199', sessionAccountId: 'selfhost:source',
    workspaceId: sourceWorkspace, key: sourceServer.config.key,
  });
  expect((await sourceClient.run()).status).toBe('synced');
  const archive = await source.exportArchive();
  const sourceBinding = await source.getDatasetBinding();

  const targetWorkspace = crypto.randomUUID();
  const targetServer = server(targetWorkspace, true, 'selfhost:target');
  const target = await openLocalRepository(name());
  const targetClient = new SelfHostSyncClient(target, {
    endpoint: 'http://127.0.0.1:3200', sessionAccountId: 'selfhost:target',
    workspaceId: targetWorkspace, key: targetServer.config.key,
  });
  expect((await targetClient.run()).status).toBe('synced');
  const preview = await target.previewArchiveMerge(archive);
  expect(preview.rows).toMatchObject([{ status: 'new' }]);
  await target.applyArchiveMerge(archive, {}, preview.targetFingerprint);
  const wrongKey = new SelfHostSyncClient(target, {
    endpoint: 'http://127.0.0.1:3200', sessionAccountId: 'selfhost:target',
    workspaceId: targetWorkspace, key: new Uint8Array(32).fill(8),
  });
  await expect(wrongKey.verifyTarget()).rejects.toThrow('sync-key-mismatch');
  expect(await target.pendingArchiveMerge()).toMatchObject({ phase: 'applied' });
  await targetClient.verifyTarget();
  await target.finalizeArchiveMerge();
  expect((await targetClient.run()).status).toBe('failed');
  expect(await target.pendingArchiveMerge()).toMatchObject({ phase: 'syncing' });
  expect((await targetClient.run()).status).toBe('synced');
  await target.completeArchiveMerge();
  expect(await target.pendingArchiveMerge()).toBeNull();
  expect((await target.get<Asset>('asset', asset.id))?.name).toBe('Cross-account transfer');
  expect((await source.getDatasetBinding())).toEqual(sourceBinding);
  expect((await target.getDatasetBinding())?.accountId).toBe('selfhost:target');
  expect((await target.getDatasetBinding())?.endpoint).toBe('http://127.0.0.1:3200');
  expect((await targetServer.service.pull({ workspaceId: targetWorkspace, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  await source.close();
  await target.close();
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
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

it('retries encrypted photo objects after lost acknowledgment and pulls verified bytes on a second device', async () => {
  const workspaceId = crypto.randomUUID();
  const { service, config, objects, dropNextAttachmentAck } = server(workspaceId);
  const dbName = name();
  const db = await openLocalRepository(dbName);
  const attachmentId = crypto.randomUUID();
  const photo = Uint8Array.from([137, 80, 78, 71, 0, 1, 2, 3]);
  await db.fileStore.blobs.add({ id: attachmentId, blob: new Blob([photo as BlobPart], { type: 'image/png' }), name: 'photo.png' });
  const asset = { ...newAsset('project'), name: 'Has photo', attachments: [attachmentId] };
  await db.save('asset', asset);
  dropNextAttachmentAck();
  const report = await new SelfHostSyncClient(db, config).run();
  expect(report.status).toBe('failed');
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(0);
  const scopeId = `${await scope(config)}:${workspaceId}`;
  const plan = await db.getScopedAttachmentUpload(scopeId, attachmentId);
  expect(plan?.objects.at(-1)?.id).toBe(attachmentId);
  expect(objects.size).toBe(1);
  const firstCiphertext = Uint8Array.from(objects.values().next().value ?? []);
  await db.close();
  const reopened = await openLocalRepository(dbName);
  expect((await new SelfHostSyncClient(reopened, config).run()).status).toBe('synced');
  expect(await reopened.getScopedAttachmentUpload(scopeId, attachmentId)).toBeNull();
  expect(objects.values().next().value).toEqual(firstCiphertext);
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  expect(Array.from(objects.values()).some(bytes => new TextDecoder().decode(bytes).includes('photo.png'))).toBe(false);
  const peer = await openLocalRepository(name());
  expect((await new SelfHostSyncClient(peer, config).run()).status).toBe('synced');
  expect((await peer.readFile(attachmentId))?.bytes).toEqual(photo);
  await peer.deleteEntity('asset', asset.id);
  expect((await new SelfHostSyncClient(peer, config).run()).status).toBe('synced');
  expect((await new SelfHostSyncClient(reopened, config).run()).status).toBe('synced');
  expect((await reopened.get<Asset>('asset', asset.id))?.deleted).toBe(true);
  await reopened.restoreEntity('asset', asset.id);
  expect((await new SelfHostSyncClient(reopened, config).run()).status).toBe('synced');
  expect((await new SelfHostSyncClient(peer, config).run()).status).toBe('synced');
  expect((await peer.get<Asset>('asset', asset.id))?.deleted).toBe(false);
  expect((await peer.readFile(attachmentId))?.bytes).toEqual(photo);
  await reopened.close();
  await peer.close();
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

it('authenticates an existing workspace before sending local records and corrects a first wrong key after reopen', async () => {
  const workspaceId = crypto.randomUUID();
  const { config, service } = server(workspaceId);
  const seed = await openLocalRepository(name());
  const remotePhoto = await seed.putFile(new File([Uint8Array.from([1, 2, 3])], 'remote.png', { type: 'image/png' }));
  const remote = { ...newAsset('project'), name: 'Already remote', attachments: [remotePhoto] };
  await seed.save('asset', remote);
  expect((await new SelfHostSyncClient(seed, config).run()).status).toBe('synced');
  await seed.close();

  const dbName = name();
  const db = await openLocalRepository(dbName);
  const localPhoto = await db.putFile(new File([Uint8Array.from([4, 5, 6])], 'local.png', { type: 'image/png' }));
  const local = { ...newAsset('project'), name: 'Must stay local until authentication', attachments: [localPhoto] };
  await db.save('asset', local);
  vi.mocked(fetch).mockClear();
  const badKey = new Uint8Array(32).fill(8);
  const failed = await new SelfHostSyncClient(db, { ...config, key: badKey }).run();
  expect(failed.error).toBe('envelope-auth');
  expect(failed.cursor).toBe(0);
  expect(failed.pending).toBe(1);
  expect((await db.get<Asset>('asset', remote.id))).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/sync/push') ||
    String(url).includes('/attachments/'))).toBe(false);
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  await db.close();

  const reopened = await openLocalRepository(dbName);
  expect((await new SelfHostSyncClient(reopened, config).run()).status).toBe('synced');
  expect((await reopened.get<Asset>('asset', remote.id))?.name).toBe(remote.name);
  expect((await reopened.get<Asset>('asset', local.id))?.name).toBe(local.name);
  expect((await reopened.readFile(remotePhoto))?.bytes).toEqual(Uint8Array.from([1, 2, 3]));
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(2);
  const afterTrust = await new SelfHostSyncClient(reopened, { ...config, key: badKey }).run();
  expect(afterTrust.error).toBe('sync-key-mismatch');
  await reopened.close();
});

it('recovers an unverified key after an interrupted first pull without losing the dataset binding', async () => {
  const workspaceId = crypto.randomUUID();
  const { config } = server(workspaceId);
  const seed = await openLocalRepository(name());
  await seed.save('asset', { ...newAsset('project'), name: 'Remote record' });
  expect((await new SelfHostSyncClient(seed, config).run()).status).toBe('synced');
  await seed.close();
  const dbName = name();
  const db = await openLocalRepository(dbName);
  const originalFetch = fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => String(url).endsWith('/sync/pull')
    ? Promise.reject(Error('offline')) : originalFetch(url, init)));
  const wrong = new SelfHostSyncClient(db, { ...config, key: new Uint8Array(32).fill(8) });
  expect((await wrong.run()).error).toBe('offline');
  expect(await db.getDatasetBinding()).toMatchObject({ workspaceId });
  expect(await db.scopedCursor(`${await scope(config)}:${workspaceId}`)).toBe(0);
  await db.close();
  vi.stubGlobal('fetch', originalFetch);
  const reopened = await openLocalRepository(dbName);
  expect((await new SelfHostSyncClient(reopened, config).run()).status).toBe('synced');
  await reopened.close();
});

it('serializes simultaneous first attempts with different keys and keeps a trusted epoch fixed', async () => {
  const workspaceId = crypto.randomUUID();
  const { config, service } = server(workspaceId);
  const seed = await openLocalRepository(name());
  await seed.save('asset', { ...newAsset('project'), name: 'Remote record' });
  expect((await new SelfHostSyncClient(seed, config).run()).status).toBe('synced');
  await seed.close();
  const db = await openLocalRepository(name());
  const wrong = new SelfHostSyncClient(db, { ...config, key: new Uint8Array(32).fill(8) });
  const correct = new SelfHostSyncClient(db, config);
  const [bad, good] = await Promise.all([wrong.run(), correct.run()]);
  expect(bad.error).toBe('envelope-auth');
  expect(good.status).toBe('synced');
  expect((await service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  expect(() => new SelfHostSyncClient(db, { ...config, keyEpoch: 0 })).toThrow('sync-key-epoch');
  expect((await new SelfHostSyncClient(db, { ...config, keyEpoch: 2 }).run()).error).toBe('sync-key-mismatch');
  await db.close();
});

it('sends independent local records in one bounded push request', async () => {
  const { config } = server(crypto.randomUUID());
  const db = await openLocalRepository(name());
  for (let index = 0; index < 3; index++) await db.save('asset', { ...newAsset('project'), name: `Batch ${index}` });
  expect((await new SelfHostSyncClient(db, config).run()).status).toBe('synced');
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/sync/push'))).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/sync/pull'))).toHaveLength(4);
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

function sessionServer(workspaceId: string) {
  const service = new SyncService(new MemorySyncStateStore());
  const objects = new Map<string, Uint8Array>();
  const requests: { url: string; init: RequestInit }[] = [];
  let subject: string | null = 'selfhost:alice';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), init });
    const headers = init.headers as Record<string, string> | undefined;
    if (init.credentials !== 'include' || headers?.Authorization) throw Error('session-transport');
    if (!subject) return new Response('{}', { status: 401 });
    if (String(url).endsWith('/sync/identity')) return Response.json({ accountId: subject });
    if (headers?.['X-KeepAny-Account-Id'] !== subject) return new Response('{}', { status: 401 });
    if (String(url).endsWith('/workspaces')) return Response.json({ workspaceId }, { status: 201 });
    if (String(url).includes('/attachments/')) {
      const id = String(url).split('/').at(-1) ?? '';
      if (init.method === 'GET') {
        const bytes = objects.get(id);
        return bytes ? new Response(Uint8Array.from(bytes).buffer, { headers: {
          'content-type': 'application/vnd.keepany.ciphertext', 'content-length': String(bytes.length),
          'x-ciphertext-sha256': await sha256(bytes),
        } }) : new Response(null, { status: 404 });
      }
      const bytes = new Uint8Array(init.body as ArrayBuffer);
      objects.set(id, bytes);
      return Response.json({ sha256: await sha256(bytes), size: bytes.length, status: 'stored' }, { status: 201 });
    }
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith('/sync/preflight')) return Response.json({ accountId: subject, workspaceId: body.workspaceId });
    if (String(url).endsWith('/sync/push')) return Response.json(await service.push(body));
    if (String(url).endsWith('/sync/pull')) return Response.json(await service.pull(body));
    throw Error('route');
  }));
  return { service, objects, requests, setSubject: (next: string | null) => { subject = next; } };
}

it('uses the browser session for identity, workspace, records and encrypted image objects', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = sessionServer(workspaceId);
  expect(await getSessionIdentity(endpoint)).toBe('selfhost:alice');
  expect(await createSessionWorkspace(endpoint)).toBe(workspaceId);
  const config = { endpoint, sessionAccountId: 'selfhost:alice', workspaceId, key: new Uint8Array(32).fill(7) };
  const sender = await openLocalRepository(name());
  const receiver = await openLocalRepository(name());
  try {
    const photo = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
    const id = await sender.putFile(new File([photo as BlobPart], 'session.png', { type: 'image/png' }));
    const asset = { ...newAsset('project'), name: 'Session photo', attachments: [id] };
    await sender.save('asset', asset);
    expect((await new SelfHostSyncClient(sender, config).run()).status).toBe('synced');
    expect((await new SelfHostSyncClient(receiver, config).run()).status).toBe('synced');
    expect((await receiver.get<Asset>('asset', asset.id))?.name).toBe('Session photo');
    expect((await receiver.readFile(id))?.bytes).toEqual(photo);
    expect(remote.requests.some(request => request.init.method === 'PUT' &&
      request.url.includes('/attachments/'))).toBe(true);
    expect(remote.requests.some(request => request.init.method === 'GET' &&
      request.url.includes('/attachments/'))).toBe(true);
    expect(remote.requests.every(request => request.init.credentials === 'include' &&
      !(request.init.headers as Record<string, string> | undefined)?.Authorization)).toBe(true);
    expect(remote.requests.every(request => request.url.endsWith('/sync/identity') ||
      (request.init.headers as Record<string, string>)['X-KeepAny-Account-Id'] === 'selfhost:alice')).toBe(true);
    expect(remote.objects.size).toBeGreaterThan(0);
    expect((await sender.getDatasetBinding())?.accountId).toBe('selfhost:alice');
  } finally { await sender.close(); await receiver.close(); }
});

it('keeps static Bearer requests separate from session cookies and rejects a non-session identity', async () => {
  const { config } = server(crypto.randomUUID());
  const db = await openLocalRepository(name());
  try {
    await db.save('asset', { ...newAsset('project'), name: 'Static' });
    expect((await new SelfHostSyncClient(db, config).run()).status).toBe('synced');
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.credentials === 'omit' &&
      (init?.headers as Record<string, string>)?.Authorization === `Bearer ${token}` &&
      !(init?.headers as Record<string, string>)?.['X-KeepAny-Account-Id'])).toBe(true);
  } finally { await db.close(); }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ accountId: 'self-host-owner' })));
  await expect(getSessionIdentity(endpoint)).rejects.toThrow('sync-account-mismatch');
});

it('rejects a caller supplied account before claiming or pushing, and blocks changed or expired sessions', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = sessionServer(workspaceId);
  const db = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Keep local' };
  await db.save('asset', asset);
  const config = { endpoint, sessionAccountId: 'selfhost:wrong', workspaceId, key: new Uint8Array(32).fill(7) };
  try {
    expect((await new SelfHostSyncClient(db, config).run()).error).toBe('sync-auth');
    expect(await db.getDatasetBinding()).toBeNull();
    expect(remote.requests.some(request => request.url.endsWith('/sync/push') ||
      request.url.includes('/attachments/'))).toBe(false);
    const serverFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) =>
      String(url).endsWith('/sync/preflight')
        ? Response.json({ accountId: 'selfhost:bob', workspaceId }) : serverFetch(url, init)));
    const correct = new SelfHostSyncClient(db, { ...config, sessionAccountId: 'selfhost:alice' });
    expect((await correct.run()).error).toBe('sync-account-mismatch');
    expect(await db.getDatasetBinding()).toBeNull();
    vi.stubGlobal('fetch', serverFetch);
    expect((await correct.run()).status).toBe('synced');
    expect((await db.getDatasetBinding())?.accountId).toBe('selfhost:alice');
    await db.save('asset', { ...asset, name: 'Do not leak' });
    remote.requests.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const response = await serverFetch(url, init);
      if (String(url).endsWith('/sync/preflight') && response.ok) remote.setSubject('selfhost:bob');
      return response;
    }));
    expect((await correct.run()).error).toBe('sync-auth');
    expect(remote.requests.some(request => request.url.endsWith('/sync/push') ||
      request.url.endsWith('/sync/pull'))).toBe(true);
    expect((await remote.service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(1);
    vi.stubGlobal('fetch', serverFetch);
    remote.setSubject(null);
    expect((await correct.run()).error).toBe('sync-auth');
    expect((await db.getDatasetBinding())?.accountId).toBe('selfhost:alice');
    expect((await remote.service.pull({ workspaceId, cursor: 0, limit: 10 })).changes).toHaveLength(1);
  } finally { await db.close(); }
});

async function scope(config: { endpoint: string; token: string }): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.endpoint, 'self-host-owner']))));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function boundServer(workspaceId: string) {
  const service = new SyncService(new MemorySyncStateStore());
  const objects = new Map<string, Uint8Array>();
  const requests: { url: string; init: RequestInit }[] = [];
  let active = true;
  let proof = 0;
  const accountId = 'keepanyadm:alice';
  const authorizer: BoundSyncAuthorizer = {
    accountId,
    assertCurrent: async () => { if (!active) throw Error('binding-stale'); },
    headers: async (method, url) => ({ Authorization: 'DPoP short-token',
      DPoP: `${++proof}:${method}:${url}` }),
  };
  const fetchBound = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), init });
    const headers = init.headers as Record<string, string>;
    if (init.credentials !== 'omit' || headers.Authorization !== 'DPoP short-token' ||
      headers.DPoP !== `${requests.length}:${init.method}:${url}` || headers['X-KeepAny-Account-Id'])
      throw Error('bound-transport');
    if (String(url).endsWith('/sync/identity')) return Response.json({ accountId });
    if (String(url).endsWith('/workspaces') && init.method === 'GET')
      return Response.json({ workspaces: [{ workspaceId, canRead: true, canWrite: true }] });
    if (String(url).endsWith('/workspaces') && init.method === 'POST')
      return Response.json({ workspaceId }, { status: 201 });
    if (String(url).includes('/attachments/')) {
      const id = String(url).split('/').at(-1) ?? '';
      if (init.method === 'GET') {
        const bytes = objects.get(id);
        return bytes ? new Response(Uint8Array.from(bytes).buffer, { headers: {
          'content-type': 'application/vnd.keepany.ciphertext', 'content-length': String(bytes.length),
          'x-ciphertext-sha256': await sha256(bytes),
        } }) : new Response(null, { status: 404 });
      }
      const bytes = new Uint8Array(init.body as ArrayBuffer);
      objects.set(id, bytes);
      return Response.json({ sha256: await sha256(bytes), size: bytes.length, status: 'stored' }, { status: 201 });
    }
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith('/sync/preflight')) return Response.json({ accountId, workspaceId: body.workspaceId });
    if (String(url).endsWith('/sync/push')) return Response.json(await service.push(body));
    if (String(url).endsWith('/sync/pull')) return Response.json(await service.pull(body));
    throw Error('route');
  });
  vi.stubGlobal('fetch', fetchBound);
  return { authorizer, fetchBound, requests, objects, service,
    invalidate: () => { active = false; }, get active() { return active; } };
}

it('uses a fresh bound proof on identity, workspace, records and encrypted image requests', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = boundServer(workspaceId);
  expect(await getBoundIdentity(endpoint, remote.authorizer)).toBe('keepanyadm:alice');
  expect(await listBoundWorkspaces(endpoint, remote.authorizer)).toEqual([workspaceId]);
  expect(await createBoundWorkspace(endpoint, remote.authorizer)).toBe(workspaceId);
  const config = { endpoint, bound: remote.authorizer, workspaceId, key: new Uint8Array(32).fill(7) };
  const sender = await openLocalRepository(name());
  const receiver = await openLocalRepository(name());
  try {
    const photo = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
    const id = await sender.putFile(new File([photo as BlobPart], 'bound.png', { type: 'image/png' }));
    const asset = { ...newAsset('project'), name: 'Bound image', attachments: [id] };
    await sender.save('asset', asset);
    expect((await new SelfHostSyncClient(sender, config).run()).status).toBe('synced');
    expect((await new SelfHostSyncClient(receiver, config).run()).status).toBe('synced');
    expect((await receiver.get<Asset>('asset', asset.id))?.name).toBe('Bound image');
    expect((await receiver.readFile(id))?.bytes).toEqual(photo);
    expect(remote.requests.some(request => request.init.method === 'PUT')).toBe(true);
    expect(remote.requests.some(request => request.init.method === 'GET' &&
      request.url.includes('/attachments/'))).toBe(true);
    expect((await sender.getDatasetBinding())?.accountId).toBe('keepanyadm:alice');
  } finally { await sender.close(); await receiver.close(); }
});

it('rejects a mismatched bound identity without claiming a dataset or sending assets', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = boundServer(workspaceId);
  const original = fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) =>
    String(url).endsWith('/sync/identity') || String(url).endsWith('/sync/preflight')
      ? Response.json({ accountId: 'keepanyadm:bob', workspaceId }) : original(url, init)));
  await expect(getBoundIdentity(endpoint, remote.authorizer)).rejects.toThrow('sync-account-mismatch');
  const db = await openLocalRepository(name());
  try {
    await db.save('asset', { ...newAsset('project'), name: 'Local only' });
    const result = await new SelfHostSyncClient(db, { endpoint, bound: remote.authorizer,
      workspaceId, key: new Uint8Array(32).fill(7) }).run();
    expect(result.error).toBe('sync-account-mismatch');
    expect(await db.getDatasetBinding()).toBeNull();
    expect(remote.requests.some(request => request.url.endsWith('/sync/push'))).toBe(false);
  } finally { await db.close(); }
});

it('does not claim or pin a dataset when a bound preflight finishes after local removal', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = boundServer(workspaceId);
  const underlying = fetch;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let notify!: () => void;
  const started = new Promise<void>(resolve => { notify = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const response = await underlying(url, init);
    if (String(url).endsWith('/sync/preflight')) { notify(); await blocked; }
    return response;
  }));
  const db = await openLocalRepository(name());
  try {
    await db.save('asset', { ...newAsset('project'), name: 'Local only' });
    const run = new SelfHostSyncClient(db, { endpoint, bound: remote.authorizer,
      workspaceId, key: new Uint8Array(32).fill(7) }).run();
    await started;
    remote.invalidate();
    release();
    expect((await run).error).toBe('binding-stale');
    expect(await db.getDatasetBinding()).toBeNull();
    expect(remote.requests.some(request => request.url.endsWith('/sync/push') ||
      request.url.endsWith('/sync/pull'))).toBe(false);
  } finally { await db.close(); }
});

it('keeps an outbox operation pending when a bound push response arrives after local removal', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = boundServer(workspaceId);
  const underlying = fetch;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let notify!: () => void;
  const started = new Promise<void>(resolve => { notify = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const response = await underlying(url, init);
    if (String(url).endsWith('/sync/push')) { notify(); await blocked; }
    return response;
  }));
  const db = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Pending after removal' };
  await db.save('asset', asset);
  try {
    const run = new SelfHostSyncClient(db, { endpoint, bound: remote.authorizer,
      workspaceId, key: new Uint8Array(32).fill(7) }).run();
    await started;
    remote.invalidate();
    release();
    const result = await run;
    expect(result.error).toBe('binding-stale');
    const binding = await db.getDatasetBinding();
    expect(binding?.accountId).toBe('keepanyadm:alice');
    if (!binding) throw Error('missing-dataset-binding');
    expect((await db.listScopedOutbox(binding.scope))).toHaveLength(1);
    expect((await db.get<Asset>('asset', asset.id))?.name).toBe(asset.name);
  } finally { await db.close(); }
});

it('discards a bound pull response after local removal without applying rows or cursor', async () => {
  const workspaceId = crypto.randomUUID();
  const remote = boundServer(workspaceId);
  const config = { endpoint, bound: remote.authorizer, workspaceId, key: new Uint8Array(32).fill(7) };
  const sender = await openLocalRepository(name());
  const receiver = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Remote only' };
  await sender.save('asset', asset);
  expect((await new SelfHostSyncClient(sender, config).run()).status).toBe('synced');
  const underlying = fetch;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let notify!: () => void;
  const started = new Promise<void>(resolve => { notify = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const response = await underlying(url, init);
    if (String(url).endsWith('/sync/pull')) { notify(); await blocked; }
    return response;
  }));
  try {
    const run = new SelfHostSyncClient(receiver, config).run();
    await started;
    remote.invalidate();
    release();
    expect((await run).error).toBe('binding-stale');
    expect(await receiver.allRecords()).toEqual([]);
    const binding = await receiver.getDatasetBinding();
    if (!binding) throw Error('missing-dataset-binding');
    expect(await receiver.scopedCursor(binding.scope)).toBe(0);
  } finally { await sender.close(); await receiver.close(); }
});
