import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, it, vi } from 'vitest';
import { newAsset } from '../../domain/src';
import { digest, McpAuthority, MemoryAuthorityStorage } from './authority';
import { createMobileMcpPairing, mobileMcpComparisonCode, mobileMcpPairingReplySchema, readMobileMcpPairingFile, type MobileMcpClientRequest } from './mobile-pairing';
import type { McpAssetStore, PreviewResult } from './service';

const endpoint = { instanceId: crypto.randomUUID(), endpoint: 'https://192.168.1.10:9449/mcp',
  certificatePem: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`, spkiSha256: 'a'.repeat(64) };
function fixture() {
  const storage = new MemoryAuthorityStorage(); let now = Date.now(), available = true;
  const authority = new McpAuthority(storage, () => now);
  let asset = { ...newAsset('project'), name: 'Selected mobile project', notes: 'private-note-excluded' };
  const other = { ...newAsset('account'), name: 'Unselected account' };
  let blockList: Promise<void> | undefined;
  const version = () => digest(JSON.stringify(asset));
  const store: McpAssetStore = {
    get: async id => id === asset.id ? { asset, version: version() } : null,
    list: async ids => { await blockList; return ids.includes(asset.id) ? [{ asset, version: version() }] : []; },
    compareAndSet: async (id, expectedVersion, next, guard) => {
      await guard?.(); if (id !== asset.id || expectedVersion !== version()) return 'conflict'; asset = next; return 'applied';
    },
  };
  const clients: MobileMcpClientRequest[] = [], previews: PreviewResult[] = [];
  const controller = createMobileMcpPairing({ endpoint, authority, store, scope: { assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 300000 },
    now: () => now, assertAvailable: () => { if (!available) throw Error('private unavailable diagnostic'); },
    onClient: client => { clients.push(client); }, onPreview: (_, preview) => { previews.push(preview); } });
  const join = { kind: 'keepany-mcp-mobile-join-v1', requestNonce: controller.pairingFile.requestNonce,
    pairingSecret: controller.pairingFile.pairingSecret, clientNonce: crypto.randomUUID(), clientName: 'Synthetic desktop client' };
  const pair = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => controller.fetch(new Request(new URL('/pair', endpoint.endpoint), {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...join, ...extra }),
  }), { host: '192.168.1.10:9449' });
  return { controller, authority, storage, store, clients, previews, join, pair, asset, other,
    current: () => asset, set now(value: number) { now = value; }, get now() { return now; },
    set available(value: boolean) { available = value; }, set blockList(value: Promise<void>) { blockList = value; } };
}

it('requires trusted phone scope approval, then serves only four existing tools through the real SDK with separate write approval', async () => {
  const f = fixture(); const client = new Client({ name: 'synthetic-mobile-client', version: '1' });
  try {
    expect((await f.pair()).status).toBe(202); expect((await f.pair()).status).toBe(202);
    expect(f.clients).toHaveLength(1); expect((await f.storage.read()).grants).toHaveLength(0);
    expect(f.clients[0].comparisonCode).toBe(mobileMcpComparisonCode(f.controller.pairingFile, f.join.clientNonce));
    await f.controller.decideClient(f.join.clientNonce, true);
    const response = await f.pair(), approved = mobileMcpPairingReplySchema.parse(await response.json());
    if (approved.state !== 'approved') throw Error('Missing trusted grant');
    expect(response.status).toBe(200); expect(approved.scope).toEqual(f.controller.pairingFile.scope);
    const fetcher: typeof fetch = (input, init) => f.controller.fetch(new Request(input, init), { host: '192.168.1.10:9449' });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.endpoint), { fetch: fetcher,
      requestInit: { headers: { authorization: `Bearer ${approved.grantId}.${approved.grantSecret}` } } }));
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['confirm_asset_update', 'get_asset', 'list_assets', 'preview_asset_update']);
    const listed = await client.callTool({ name: 'list_assets', arguments: {} });
    expect((listed.structuredContent as { result: unknown })?.result).toEqual([{ id: f.asset.id, name: f.asset.name }]);
    expect(JSON.stringify(listed)).not.toContain('private-note');
    expect((await client.callTool({ name: 'get_asset', arguments: { id: f.other.id } })).isError).toBe(true);
    expect((await f.pair()).status).toBe(403); // Consumed only after an authenticated MCP exchange.
    const operationId = 'mobile-operation-001', patch = { name: 'Explicitly approved name' };
    const previewResponse = await client.callTool({ name: 'preview_asset_update', arguments: { id: f.asset.id, operationId, patch } });
    const preview = (previewResponse.structuredContent as { result: PreviewResult })?.result;
    expect(f.previews[0]).toEqual(preview);
    const confirmation = { name: 'confirm_asset_update', arguments: { id: f.asset.id, operationId, previewId: preview.previewId, patch } };
    expect((await client.callTool(confirmation)).isError).toBe(true);
    expect(f.current().name).toBe(f.asset.name);
    await f.authority.approvePreview(approved.grantId, preview.previewId);
    expect((await client.callTool(confirmation)).isError).not.toBe(true);
    expect(f.current().name).toBe(patch.name);
    expect((await client.callTool(confirmation)).isError).not.toBe(true);
    expect((await f.storage.read()).operations).toHaveLength(1);
    const persisted = JSON.stringify(await f.storage.read());
    expect(persisted).not.toContain(approved.grantSecret); expect(persisted).not.toContain(patch.name); expect(persisted).not.toContain('private-note');
    await f.controller.close();
    await expect(f.authority.requireGrant(approved.grantId, approved.grantSecret)).rejects.toThrow('grant-denied');
  } finally { await client.close(); await f.controller.close(); }
});

it('bad ticket, origin, cookie, unknown scope override, changed client and explicit denial never issue a grant', async () => {
  const f = fixture();
  try {
    expect((await f.pair({ pairingSecret: 'b'.repeat(43) })).status).toBe(403);
    expect((await f.pair({}, { cookie: 'private=secret' })).status).toBe(403);
    expect((await f.pair({}, { origin: 'https://untrusted.test' })).status).toBe(403);
    expect((await f.pair({ scope: { assetIds: [f.other.id] } })).status).toBe(403);
    expect((await f.pair()).status).toBe(202);
    expect((await f.pair({ clientNonce: crypto.randomUUID() })).status).toBe(409);
    await expect(f.controller.decideClient(crypto.randomUUID(), true)).rejects.toThrow('mcp-mobile-decision-invalid');
    await f.controller.decideClient(f.join.clientNonce, false);
    expect((await f.pair()).status).toBe(403); expect((await f.storage.read()).grants).toHaveLength(0);
  } finally { await f.controller.close(); }
});

it('expiry during a paused scope validation cannot create a grant or release credentials', async () => {
  const f = fixture(); let release!: () => void;
  f.blockList = new Promise<void>(resolve => { release = resolve; });
  await f.pair();
  const decision = f.controller.decideClient(f.join.clientNonce, true);
  f.now += 120001; release();
  await expect(decision).rejects.toThrow('mcp-mobile-denied');
  expect((await f.storage.read()).grants).toHaveLength(0); expect((await f.pair()).status).toBe(403);
  await f.controller.close();
});

it('stop after a real grant commit but before its acknowledgement revokes it and never returns the secret', async () => {
  const f = fixture(); await f.pair();
  const original = f.authority.issueGrant.bind(f.authority); let release!: () => void, committed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), written = new Promise<void>(resolve => { committed = resolve; });
  vi.spyOn(f.authority, 'issueGrant').mockImplementation(async input => { const grant = await original(input); committed(); await gate; return grant; });
  const decision = f.controller.decideClient(f.join.clientNonce, true); await written;
  await f.controller.close(); release();
  await expect(decision).rejects.toThrow('mcp-mobile-stopped');
  const state = await f.storage.read(); expect(state.grants).toHaveLength(1); expect(state.grants[0].revokedAt).toBeDefined();
  expect((await f.pair()).status).toBe(503);
});

it('rejects malformed, oversized or expired secret files and never confuses the existing Web request kind', async () => {
  const f = fixture(), file = f.controller.pairingFile;
  try {
    expect(readMobileMcpPairingFile(file).scope.assetIds).toEqual([f.asset.id]);
    for (const bad of [{ ...file, kind: 'keepany-mcp-local-request-v1' }, { ...file, endpoint: 'https://8.8.8.8:9449/mcp' },
      { ...file, endpoint: 'https://192.168.1.10:9449/mcp?token=secret' }, { ...file, expiresAt: file.createdAt + 120001 },
      { ...file, scope: { ...file.scope, writeFields: ['url'] } }, { ...file, extra: 'secret' }]) {
      expect(() => readMobileMcpPairingFile(bad)).toThrow('mcp-mobile-pairing-invalid');
    }
    expect(() => readMobileMcpPairingFile(file, file.expiresAt)).toThrow('mcp-mobile-pairing-invalid');
    expect((await f.pair({ clientName: 'x'.repeat(4097) })).status).toBe(400);
    expect((await f.storage.read()).grants).toHaveLength(0);
  } finally { await f.controller.close(); }
});

it('revokes the exact allocated grant when its durable write succeeds but the acknowledgement is lost', async () => {
  const f = fixture(); await f.pair();
  const other = await f.authority.issueGrant({ assetIds: [f.other.id], readFields: ['name'], ttlMs: 60000 });
  const update = f.storage.update.bind(f.storage); let fail = true;
  vi.spyOn(f.storage, 'update').mockImplementation(async change => {
    const result = await update(change);
    if (fail) { fail = false; throw Error('synthetic lost acknowledgement'); }
    return result;
  });
  await expect(f.controller.decideClient(f.join.clientNonce, true)).rejects.toThrow();
  await f.controller.close();
  const state = await f.storage.read();
  expect(state.grants).toHaveLength(2);
  expect(state.grants.find(grant => grant.id !== other.id)?.revokedAt).toBeDefined();
  expect((await f.authority.requireGrant(other.id, other.secret)).revokedAt).toBeUndefined();
  expect((await f.pair()).status).toBe(503);
});
