import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { newAsset, type Asset } from '../../domain/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { BrowserMcpBridgeClient } from './browser-bridge';
import { startLocalMcpBridge, type LocalMcpBridge } from './bridge';
import { McpAssetService, type AssetSnapshot, type McpAssetStore } from './service';

const appOrigin = 'http://127.0.0.1:5173';
const bridges: LocalMcpBridge[] = [];
afterEach(async () => { await Promise.all(bridges.splice(0).map(bridge => bridge.close())); });

function fixtureStore(asset: Asset): McpAssetStore & { current(): AssetSnapshot } {
  let row = { asset, version: 'v1' };
  return {
    current: () => row,
    async get(id) { return id === row.asset.id ? row : null; },
    async list(ids) { return ids.includes(row.asset.id) ? [row] : []; },
    async compareAndSet(id, version, next) {
      if (id !== row.asset.id || version !== row.version) return 'conflict';
      row = { asset: next, version: 'v2' };
      return 'applied';
    },
  };
}

async function fixture(timeout?: number) {
  const asset = { ...newAsset('account'), name: 'Allowed name', username: 'private-login', notes: 'private notes' };
  const store = fixtureStore(asset);
  const authority = new McpAuthority(new MemoryAuthorityStorage());
  const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 60_000 });
  const bridge = await startLocalMcpBridge({ appOrigin, authority, grantId: grant.id, grantSecret: grant.secret,
    requestTimeoutMs: timeout });
  bridges.push(bridge);
  const request = (path: string, body: unknown, origin = appOrigin, extra: Record<string, string> = {}) =>
    fetch(`${bridge.url}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body) });
  return { asset, store, authority, grant, bridge, request };
}

describe('loopback MCP browser relay', () => {
  it('requires an exact origin, host and one-time pairing secret', async () => {
    const { bridge, request } = await fixture();
    expect((await request('/pair', { secret: bridge.pairingSecret }, 'null')).status).toBe(403);
    expect((await request('/pair', { secret: bridge.pairingSecret }, 'https://evil.example')).status).toBe(403);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${bridge.url}/pair`, { method: 'POST', headers: { Host: 'evil.example', Origin: appOrigin,
        'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end(JSON.stringify({ secret: bridge.pairingSecret }));
    });
    expect(wrongHost).toBe(403);
    const missing = await fetch(`${bridge.url}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: bridge.pairingSecret }) });
    expect(missing.status).toBe(403);
    expect((await request('/pair', { secret: 'wrong' })).status).toBe(403);
    const paired = await request('/pair', { secret: bridge.pairingSecret });
    expect(paired.status).toBe(200);
    const result = await paired.json() as { sessionSecret: string; scope: { assetIds: string[]; readFields: string[] } };
    expect(result.scope.assetIds).toHaveLength(1);
    expect(result.scope.readFields).toEqual(['name']);
    expect(result.sessionSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await request('/pair', { secret: bridge.pairingSecret })).status).toBe(403);
    expect((await request('/poll', {}, appOrigin, { Authorization: 'Bearer invalid' })).status).toBe(403);
  });

  it('projects browser data, preserves hidden fields on write, and fails after revocation', async () => {
    const { asset, store, authority, grant, bridge } = await fixture();
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), Origin: appOrigin } });
    let approvals = 0;
    const client = new BrowserMcpBridgeClient({ url: bridge.url, pairingSecret: bridge.pairingSecret,
      store, fetcher, approve: async scope => { approvals++; expect(scope.assetIds).toEqual([asset.id]); return true; } });
    await client.pair();
    const running = client.run();
    try {
      const remote = await bridge.store.get(asset.id);
      expect(remote?.asset.name).toBe('Allowed name');
      expect(remote?.asset.username).toBe('');
      expect(remote?.asset.notes).toBe('');
      expect((await bridge.store.list([asset.id]))[0]?.asset.username).toBe('');
      const service = new McpAssetService(bridge.store, authority, grant.id, grant.secret);
      expect(await service.getAsset(asset.id)).toEqual({ id: asset.id, name: asset.name });
      const preview = await service.previewUpdate(asset.id, 'bridge-op-01', { name: 'Changed name' });
      await authority.approvePreview(grant.id, preview.previewId);
      expect(await service.confirmUpdate({ id: asset.id, operationId: 'bridge-op-01', previewId: preview.previewId,
        patch: { name: 'Changed name' } })).toEqual({ status: 'applied' });
      expect(store.current().asset).toMatchObject({ name: 'Changed name', username: 'private-login', notes: 'private notes' });
      expect(approvals).toBe(1);
      await authority.revokeGrant(grant.id);
      await expect(bridge.store.get(asset.id)).rejects.toThrow('grant-denied');
    } finally { client.close(); await running.catch(() => undefined); }
  });

  it('keeps the browser executor inactive when the user denies the scope', async () => {
    const { bridge, store } = await fixture();
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), Origin: appOrigin } });
    const client = new BrowserMcpBridgeClient({ url: bridge.url, pairingSecret: bridge.pairingSecret,
      store, fetcher, approve: async () => false });
    await expect(client.pair()).rejects.toThrow('bridge-approval-denied');
    await expect(client.run()).rejects.toThrow('bridge-not-paired');
  });

  it('consumes each response nonce once and times out an unanswered request', async () => {
    const { asset, bridge, request } = await fixture(1_000);
    const pair = await (await request('/pair', { secret: bridge.pairingSecret })).json() as { sessionSecret: string };
    const auth = { Authorization: `Bearer ${pair.sessionSecret}` };
    const work = bridge.store.get(asset.id);
    let message: { id: string } | undefined;
    for (let i = 0; i < 20; i++) {
      const poll = await request('/poll', {}, appOrigin, auth);
      if (poll.status === 200) { message = await poll.json() as { id: string }; break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(message?.id).toMatch(/^[0-9a-f-]{36}$/);
    if (!message) throw Error('no request');
    const projected = { id: asset.id, kind: asset.kind, createdAt: asset.createdAt,
      updatedAt: asset.updatedAt, deleted: asset.deleted, name: asset.name };
    expect((await request('/respond', { id: message.id, result: { asset: projected, version: 'v1' } }, appOrigin, auth)).status).toBe(204);
    expect((await request('/respond', { id: message.id, result: { asset: projected, version: 'v1' } }, appOrigin, auth)).status).toBe(400);
    expect((await work)?.asset.id).toBe(asset.id);
    const oversizedProjection = bridge.store.get(asset.id);
    const rejectedProjection = expect(oversizedProjection).rejects.toThrow('invalid-browser-result');
    let second: { id: string } | undefined;
    for (let i = 0; i < 20; i++) {
      const poll = await request('/poll', {}, appOrigin, auth);
      if (poll.status === 200) { second = await poll.json() as { id: string }; break; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (!second) throw Error('no second request');
    expect((await request('/respond', { id: second.id, result: { asset, version: 'v1' } }, appOrigin, auth)).status).toBe(204);
    await rejectedProjection;
    await expect(bridge.store.get(asset.id)).rejects.toThrow('bridge-timeout');
  });
});
