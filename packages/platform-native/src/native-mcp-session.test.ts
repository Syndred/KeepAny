import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, it, vi } from 'vitest';
import { newAsset } from '../../domain/src';
import { digest, MemoryAuthorityStorage } from '../../mcp/src/authority';
import { mobileMcpPairingReplySchema } from '../../mcp/src/mobile-pairing';
import type { PreviewResult } from '../../mcp/src/service';
import { prepareNativeMcpSession, type NativeMcpSessionOptions } from './native-mcp-session';
import type { NativeMcpRequestHandler, prepareNativeMcpTransport } from './native-mcp-transport';

const endpoint = { instanceId: crypto.randomUUID(), endpoint: 'https://127.0.0.1:9452/mcp',
  certificatePem: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`, spkiSha256: 'a'.repeat(64) };
function fixture() {
  const storage = new MemoryAuthorityStorage();
  let current = true, active = false, invalidation = () => {}, nativeStopped = () => {};
  let asset = { ...newAsset('project'), name: 'Native scoped fixture' };
  let handler: NativeMcpRequestHandler | undefined, preparationGate: Promise<void> | undefined;
  const onStopped = vi.fn(), onAuthorized = vi.fn(), onClient = vi.fn(), onPreviews = vi.fn();
  const context = { datasetName: 'keepany-native-fixture', assertCurrent: () => { if (!current) throw Error('dataset-invalidated'); },
    onInvalidated: (listener: () => void) => { invalidation = listener; return () => { invalidation = () => {}; }; },
    store: { get: async (id: string) => id === asset.id ? { asset, version: digest(JSON.stringify(asset)) } : null,
      list: async () => [{ asset, version: digest(JSON.stringify(asset)) }],
      compareAndSet: async () => 'conflict' as const } };
  const ticket: Awaited<ReturnType<typeof prepareNativeMcpTransport>> = {
    endpoint,
    activate: async options => {
      active = true;
      const assertAvailable = () => { if (!active) throw Error('native-stopped'); };
      handler = options.createHandler(endpoint, assertAvailable);
      nativeStopped = () => { active = false; options.onStopped?.(); };
      return { endpoint, assertAvailable, close: async () => { active = false; await handler?.close(); options.onStopped?.(); } };
    },
    close: vi.fn(async () => { active = false; await handler?.close(); }),
  };
  const dependencies = { authorityStorage: vi.fn(() => storage), prepareTransport: vi.fn(async () => { await preparationGate; return ticket; }) };
  const options: NativeMcpSessionOptions = { address: '127.0.0.1', scope: { assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 300000 },
    loadContext: async () => context, onStopped, onAuthorized, onClient, onPreviews };
  const fetcher: typeof fetch = async (input, init) => {
    if (!handler) throw Error('No active native handler');
    return handler.fetch(new Request(input, init), { host: '127.0.0.1:9452' });
  };
  return { storage, ticket, options, dependencies, onStopped, onAuthorized, onClient, onPreviews, fetcher,
    get active() { return active; }, invalidate() { current = false; invalidation(); }, nativeStopped: () => nativeStopped(),
    changeAsset() { asset = { ...asset, name: 'Another actual revision' }; },
    set preparationGate(value: Promise<void>) { preparationGate = value; } };
}

async function join(f: ReturnType<typeof fixture>, session: Awaited<ReturnType<typeof prepareNativeMcpSession>>) {
  const file = session.pairingFile, clientNonce = crypto.randomUUID();
  const request = () => f.fetcher(new URL('/pair', file.endpoint), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'keepany-mcp-mobile-join-v1', requestNonce: file.requestNonce, pairingSecret: file.pairingSecret, clientNonce, clientName: 'Native session SDK fixture' }) });
  expect((await request()).status).toBe(202); await session.decideClient(clientNonce, true);
  const approved = mobileMcpPairingReplySchema.parse(await (await request()).json());
  if (approved.state !== 'approved') throw Error('Missing trusted approval');
  return approved;
}

it('exports a stable ticket before activation, then binds the current private authority and canonical store to official SDK requests', async () => {
  const f = fixture(), session = await prepareNativeMcpSession(f.options, f.dependencies);
  const client = new Client({ name: 'native-session-synthetic-client', version: '1' });
  try {
    expect(f.active).toBe(false); expect((await f.storage.read()).grants).toHaveLength(0);
    expect(f.dependencies.authorityStorage).toHaveBeenCalledWith('keepany-native-fixture');
    await expect(session.decideClient(crypto.randomUUID(), true)).rejects.toThrow('mcp-native-stopped');
    await session.activate(); const approved = await join(f, session);
    expect(f.onAuthorized).toHaveBeenCalledOnce();
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.endpoint), { fetch: f.fetcher,
      requestInit: { headers: { authorization: `Bearer ${approved.grantId}.${approved.grantSecret}` } } }));
    const listed = await client.callTool({ name: 'list_assets', arguments: {} });
    expect(JSON.stringify(listed)).toContain('Native scoped fixture');
    const response = await client.callTool({ name: 'preview_asset_update', arguments: { id: approved.scope.assetIds[0], operationId: 'native-stale-preview', patch: { name: 'Model proposal' } } });
    const preview = (response.structuredContent as { result: PreviewResult }).result;
    expect(f.onPreviews).toHaveBeenLastCalledWith([preview]);
    expect(await session.checkPreview(preview.previewId)).toBe(true);
    f.changeAsset();
    expect(await session.checkPreview(preview.previewId)).toBe(false);
    await expect(session.decidePreview(preview.previewId, true)).rejects.toThrow('mcp-native-preview-stale');
    expect(f.onPreviews).toHaveBeenLastCalledWith([]);
    expect((await f.storage.read()).previews[0].rejectedAt).toBeDefined();
    expect((await session.auditEntries()).some(entry => entry.action === 'reject')).toBe(true);
    const expiringResponse = await client.callTool({ name: 'preview_asset_update', arguments: {
      id: approved.scope.assetIds[0], operationId: 'native-expired-preview', patch: { name: 'Another model proposal' },
    } });
    const expiring = (expiringResponse.structuredContent as { result: PreviewResult }).result;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiring.expiresAt + 1);
    try {
      expect(session.pendingPreviews()).toEqual([]);
      expect(await session.checkPreview(expiring.previewId)).toBe(false);
      await expect(session.decidePreview(expiring.previewId, true)).rejects.toThrow('mcp-native-preview-stale');
    } finally { clock.mockRestore(); }
    await session.close(); expect(f.active).toBe(false); expect(f.onStopped).toHaveBeenLastCalledWith(true);
    expect((await f.storage.read()).grants[0].revokedAt).toBeDefined();
  } finally { await client.close(); await session.close(); }
});

it('fails before any native allocation if the private authority is unavailable, without a memory fallback', async () => {
  const f = fixture(); vi.spyOn(f.storage, 'read').mockRejectedValue(Error('private keystore failure'));
  await expect(prepareNativeMcpSession(f.options, f.dependencies)).rejects.toThrow('mcp-native-session-unavailable');
  expect(f.dependencies.prepareTransport).not.toHaveBeenCalled();
});

it('disposes a late prepared native resource when the dataset invalidates during allocation', async () => {
  const f = fixture(); let release!: () => void;
  f.preparationGate = new Promise<void>(resolve => { release = resolve; });
  const preparing = prepareNativeMcpSession(f.options, f.dependencies);
  await vi.waitFor(() => expect(f.dependencies.prepareTransport).toHaveBeenCalledOnce());
  f.invalidate(); release();
  await expect(preparing).rejects.toThrow('mcp-native-session-unavailable');
  expect(f.ticket.close).toHaveBeenCalled(); expect(f.active).toBe(false);
});

it('native background shutdown invalidates trusted decisions and durably revokes only this session', async () => {
  const f = fixture(), session = await prepareNativeMcpSession(f.options, f.dependencies);
  await session.activate(); await join(f, session); f.nativeStopped();
  await expect(session.decideClient(crypto.randomUUID(), true)).rejects.toThrow('mcp-native-stopped');
  await session.close(); expect(f.active).toBe(false); expect((await f.storage.read()).grants[0].revokedAt).toBeDefined();
});

it('distinguishes stopped IO from unconfirmed durable revocation and supports an explicit safe retry', async () => {
  const f = fixture(), session = await prepareNativeMcpSession(f.options, f.dependencies);
  await session.activate(); await join(f, session);
  const update = f.storage.update.bind(f.storage); let failing = true;
  vi.spyOn(f.storage, 'update').mockImplementation(change => failing ? Promise.reject(Error('private storage failure')) : update(change));
  await expect(session.close()).rejects.toThrow('mcp-native-revoke-unconfirmed');
  expect(f.active).toBe(false); expect(f.onStopped).toHaveBeenLastCalledWith(false);
  expect((await f.storage.read()).grants[0].revokedAt).toBeUndefined();
  failing = false; await session.close(); expect((await f.storage.read()).grants[0].revokedAt).toBeDefined();
  expect(f.onStopped).toHaveBeenLastCalledWith(true);
});

it('keeps private canonical-store diagnostics behind a fixed trusted decision error', async () => {
  const f = fixture(), session = await prepareNativeMcpSession(f.options, f.dependencies);
  try {
    await session.activate();
    const context = await f.options.loadContext();
    vi.spyOn(context.store, 'list').mockRejectedValue(Error('SYNTHETIC_PRIVATE_STORAGE_DIAGNOSTIC'));
    await expect(join(f, session)).rejects.toThrow('mcp-native-decision-failed');
    expect((await f.storage.read()).grants).toHaveLength(0);
  } finally { await session.close(); }
});
