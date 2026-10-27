import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newAsset } from '../../domain/src';
import { openLocalRepository } from '../../local-db/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { BrowserMcpBridgeClient } from './browser-bridge';
import { startLocalMcpBridge } from './bridge';
import { RxdbMcpAssetStore } from './rxdb-store';
import { McpAssetService, type McpAssetStore } from './service';

describe('MCP writes use the canonical RxDB collection', () => {
  it.each([
    ['revoked', 3], ['revoked', 4], ['preview-expired', 3], ['preview-expired', 4],
  ] as const)('rechecks direct service authority %s inside queued storage callback %i', async (boundary, pauseAt) => {
    const repository = await openLocalRepository(`mcp-direct-${crypto.randomUUID().slice(0, 12)}`);
    let release: (() => void) | undefined;
    try {
      const asset = { ...newAsset('project'), name: 'Before direct request' };
      await repository.save('asset', asset);
      const real = new RxdbMcpAssetStore(repository);
      let entered!: () => void;
      const atCallback = new Promise<void>(resolve => { entered = resolve; });
      const continueCallback = new Promise<void>(resolve => { release = resolve; });
      let checks = 0;
      const store: McpAssetStore = {
        get: id => real.get(id), list: ids => real.list(ids),
        compareAndSet: (id, version, next, assertCanCommit) => real.compareAndSet(id, version, next, async () => {
          checks++;
          if (checks === pauseAt) { entered(); await continueCallback; }
          await assertCanCommit?.();
        }),
      };
      let now = Date.parse('2026-10-27T14:00:00Z');
      const authority = new McpAuthority(new MemoryAuthorityStorage(), () => now);
      const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 600_000 });
      const service = new McpAssetService(store, authority, grant.id, grant.secret);
      const preview = await service.previewUpdate(asset.id, `direct-${crypto.randomUUID()}`, { name: 'After direct request' });
      await authority.approvePreview(grant.id, preview.previewId);
      const confirm = service.confirmUpdate({ id: asset.id, operationId: preview.operationId, previewId: preview.previewId,
        patch: { name: 'After direct request' } }).then(value => value, error => error as Error);
      await atCallback;
      if (boundary === 'revoked') await authority.revokeGrant(grant.id);
      else now = preview.expiresAt + 1;
      release?.();
      const result = await confirm;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe(boundary === 'revoked' ? 'grant-denied' : 'preview-not-approved');
      expect(await repository.get<typeof asset>('asset', asset.id)).toMatchObject({ name: 'Before direct request' });
      expect((await authority.operation(grant.id, preview.operationId))?.state).toBe('pending');
      expect((await authority.auditEntries(grant.id)).some(item => item.outcome === 'applied')).toBe(false);
    } finally { release?.(); await repository.close(); }
  });

  it('keeps the direct-service approval guard through the browser bridge at storage commit', async () => {
    const repository = await openLocalRepository(`mcp-approval-${crypto.randomUUID().slice(0, 12)}`);
    let bridge: Awaited<ReturnType<typeof startLocalMcpBridge>> | undefined;
    let client: BrowserMcpBridgeClient | undefined;
    let running: Promise<unknown> | undefined;
    let release: (() => void) | undefined;
    try {
      const asset = { ...newAsset('project'), name: 'Before approval expires' };
      await repository.save('asset', asset);
      const real = new RxdbMcpAssetStore(repository);
      let entered!: () => void;
      const atCallback = new Promise<void>(resolve => { entered = resolve; });
      const continueCallback = new Promise<void>(resolve => { release = resolve; });
      let checks = 0;
      const store: McpAssetStore = {
        get: id => real.get(id), list: ids => real.list(ids),
        compareAndSet: (id, version, next, assertCanCommit) => real.compareAndSet(id, version, next, async () => {
          if (++checks === 4) { entered(); await continueCallback; }
          await assertCanCommit?.();
        }),
      };
      let now = Date.now();
      const authority = new McpAuthority(new MemoryAuthorityStorage(), () => now);
      const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 600_000 });
      bridge = await startLocalMcpBridge({ appOrigin: 'http://127.0.0.1:5173', authority, grantId: grant.id, grantSecret: grant.secret });
      const fetcher: typeof fetch = (input, init) => fetch(input, { ...init,
        headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), Origin: 'http://127.0.0.1:5173' } });
      client = new BrowserMcpBridgeClient({ url: bridge.url, pairingSecret: bridge.pairingSecret, store, fetcher, approve: async () => true });
      await client.pair();
      running = client.run().catch(error => error);
      const service = new McpAssetService(bridge.store, authority, grant.id, grant.secret);
      const preview = await service.previewUpdate(asset.id, `approval-${crypto.randomUUID()}`, { name: 'Must remain unchanged' });
      await authority.approvePreview(grant.id, preview.previewId);
      const confirm = service.confirmUpdate({ id: asset.id, operationId: preview.operationId, previewId: preview.previewId,
        patch: { name: 'Must remain unchanged' } }).then(value => value, error => error as Error);
      await atCallback;
      now = preview.expiresAt + 1;
      release?.();
      expect(await confirm).toBeInstanceOf(Error);
      expect(await repository.get<typeof asset>('asset', asset.id)).toMatchObject({ name: 'Before approval expires' });
      expect((await authority.operation(grant.id, preview.operationId))?.state).toBe('pending');
    } finally {
      release?.(); await client?.close(); await running; await bridge?.close(); await repository.close();
    }
  });

  it('performs a compare-and-set update and refuses stale or deleted assets', async () => {
    const repository = await openLocalRepository(`mcp-${crypto.randomUUID().slice(0, 12)}`);
    try {
      const asset = { ...newAsset('project'), name: 'Original' };
      await repository.save('asset', asset);
      const adapter = new RxdbMcpAssetStore(repository);
      const initial = await adapter.get(asset.id);
      expect(initial?.asset.name).toBe('Original');
      if (!initial) throw Error('missing initial asset');
      expect(await adapter.compareAndSet(asset.id, initial.version, { ...asset, name: 'First' })).toBe('applied');
      expect(await repository.get<typeof asset>('asset', asset.id)).toMatchObject({ name: 'First' });
      expect(await adapter.compareAndSet(asset.id, initial.version, { ...asset, name: 'Stale' })).toBe('conflict');
      await repository.deleteEntity('asset', asset.id);
      const deleted = await adapter.get(asset.id);
      if (!deleted) throw Error('missing deleted asset');
      expect(await adapter.compareAndSet(asset.id, deleted.version, { ...asset, name: 'Resurrect' })).toBe('conflict');
    } finally { await repository.close(); }
  });

  it.each([3, 4])('checks cancellation inside the actual incrementalModify callback at check %i', async pauseAt => {
    const repository = await openLocalRepository(`mcp-cancel-${crypto.randomUUID().slice(0, 12)}`);
    try {
      const asset = { ...newAsset('project'), name: 'Before' };
      await repository.save('asset', asset);
      const adapter = new RxdbMcpAssetStore(repository);
      const initial = await adapter.get(asset.id);
      if (!initial) throw Error('missing initial asset');
      let entered!: () => void;
      let release!: () => void;
      const atCallback = new Promise<void>(resolve => { entered = resolve; });
      const continueCallback = new Promise<void>(resolve => { release = resolve; });
      let valid = true;
      let checks = 0;
      const commit = adapter.compareAndSet(asset.id, initial.version, { ...asset, name: 'After' }, async () => {
        checks++;
        if (checks === pauseAt) { entered(); await continueCallback; }
        if (!valid) throw Error('write-cancelled');
      });
      await atCallback;
      valid = false;
      release();
      await expect(commit).rejects.toThrow('write-cancelled');
      expect(checks).toBe(pauseAt);
      expect(await repository.get<typeof asset>('asset', asset.id)).toMatchObject({ name: 'Before' });
    } finally { await repository.close(); }
  });

  it('keeps a real RxDB modification behind the revoke fence until its callback rejects', async () => {
    const repository = await openLocalRepository(`mcp-revoke-${crypto.randomUUID().slice(0, 12)}`);
    let bridge: Awaited<ReturnType<typeof startLocalMcpBridge>> | undefined;
    let client: BrowserMcpBridgeClient | undefined;
    let running: Promise<unknown> | undefined;
    let release!: () => void;
    try {
      const asset = { ...newAsset('project'), name: 'Before' };
      await repository.save('asset', asset);
      const real = new RxdbMcpAssetStore(repository);
      let entered!: () => void;
      const atCallback = new Promise<void>(resolve => { entered = resolve; });
      const continueCallback = new Promise<void>(resolve => { release = resolve; });
      let checks = 0;
      const store: McpAssetStore = {
        get: id => real.get(id), list: ids => real.list(ids),
        compareAndSet: (id, version, next, assertCanCommit) => real.compareAndSet(id, version, next, async () => {
          checks++;
          if (checks === 4) { entered(); await continueCallback; }
          await assertCanCommit?.();
        }),
      };
      const authority = new McpAuthority(new MemoryAuthorityStorage());
      const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 60_000 });
      bridge = await startLocalMcpBridge({ appOrigin: 'http://127.0.0.1:5173', authority,
        grantId: grant.id, grantSecret: grant.secret });
      const fetcher: typeof fetch = (input, init) => fetch(input, { ...init,
        headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), Origin: 'http://127.0.0.1:5173' } });
      client = new BrowserMcpBridgeClient({ url: bridge.url, pairingSecret: bridge.pairingSecret,
        store, fetcher, approve: async () => true });
      await client.pair();
      running = client.run().catch(error => error);
      const service = new McpAssetService(bridge.store, authority, grant.id, grant.secret);
      const preview = await service.previewUpdate(asset.id, `rxdb-${crypto.randomUUID()}`, { name: 'After' });
      await authority.approvePreview(grant.id, preview.previewId);
      const confirm = service.confirmUpdate({ id: asset.id, operationId: preview.operationId,
        previewId: preview.previewId, patch: { name: 'After' } }).then(value => value, error => error as Error);
      await atCallback;
      const revocation = client.revokeGrant();
      release();
      expect((await revocation).writeMayHaveApplied).toBe(true);
      expect(await confirm).toBeInstanceOf(Error);
      expect(checks).toBe(4);
      expect(await repository.get<typeof asset>('asset', asset.id)).toMatchObject({ name: 'Before' });
    } finally {
      release?.();
      await client?.close();
      await running;
      await bridge?.close();
      await repository.close();
    }
  });
});
