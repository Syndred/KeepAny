import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { createKeepAnyMcpHttpHandler, MCP_HTTP_REQUEST_LIMIT } from './http-handler';
import type { McpAssetStore, PreviewResult } from './service';

const endpoint = 'https://192.168.50.10:47321/mcp';
async function fixture() {
  const asset = { ...newAsset('project'), name: 'HTTP selected project', notes: 'excluded-private-note' };
  const other = { ...newAsset('account'), name: 'Excluded HTTP account' };
  const authority = new McpAuthority(new MemoryAuthorityStorage());
  const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 60_000 });
  let current = asset, revision = 1, reads = 0;
  const store: McpAssetStore = {
    async get(id) { reads++; return id === current.id ? { asset: current, version: String(revision) } : null; },
    async list(ids) { reads++; return ids.includes(current.id) ? [{ asset: current, version: String(revision) }] : []; },
    async compareAndSet(id, version, next, guard) {
      await guard?.();
      if (id !== current.id || version !== String(revision)) return 'conflict';
      current = next; revision++; return 'applied';
    },
  };
  const published: PreviewResult[] = [];
  const handler = createKeepAnyMcpHttpHandler({ endpoint, store, authority, onPreview: (_, preview) => { published.push(preview); } });
  const authorization = `Bearer ${grant.id}.${grant.secret}`;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), headers = new Headers(request.headers);
    headers.set('host', new URL(request.url).host);
    return handler.fetch(new Request(request, { headers }));
  };
  const client = new Client({ name: 'keepany-http-fixture', version: '1.0.0' });
  const connect = () => client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { fetch: fetcher,
    requestInit: { headers: { authorization } } }));
  return { authority, grant, asset, other, store, published, handler, client, connect, authorization,
    current: () => current, reads: () => reads };
}

describe('portable authenticated official MCP HTTP adapter (no native listener)', () => {
  it('fills only a missing standard JSON response method without changing fetch or native validation', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Response, 'json');
    const fetcher = globalThis.fetch;
    let f: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      Object.defineProperty(Response, 'json', { value: undefined, configurable: true, writable: true });
      f = await fixture();
      const response = Response.json({ text: '中文' }, { status: 201, headers: { 'x-fixture': '1' } });
      expect(response.status).toBe(201);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('x-fixture')).toBe('1');
      expect(await response.json()).toEqual({ text: '中文' });
      expect(Response.json(null, { headers: { 'content-type': 'application/problem+json' } }).headers.get('content-type')).toBe('application/problem+json');
      expect(() => Response.json(undefined)).toThrow(TypeError);
      expect(() => Response.json(1n)).toThrow(TypeError);
      expect(() => Response.json({}, { status: 204 })).toThrow(TypeError);
      expect(globalThis.fetch).toBe(fetcher);
    } finally {
      await f?.handler.close();
      if (descriptor) Object.defineProperty(Response, 'json', descriptor);
    }
    const existing = Response.json;
    const unchanged = await fixture();
    try { expect(Response.json).toBe(existing); }
    finally { await unchanged.handler.close(); }
  });

  it('uses the official SDK for scoped reads, trusted approval, idempotent writes and revocation', async () => {
    const f = await fixture();
    try {
      await f.connect();
      expect((await f.client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
        'confirm_asset_update', 'get_asset', 'list_assets', 'preview_asset_update',
      ]);
      const listed = await f.client.callTool({ name: 'list_assets', arguments: {} });
      expect(listed.structuredContent).toEqual({ result: [{ id: f.asset.id, name: f.asset.name }] });
      expect(JSON.stringify(listed)).not.toContain(f.asset.notes);
      expect((await f.client.callTool({ name: 'get_asset', arguments: { id: f.other.id } })).isError).toBe(true);
      const preview = await f.client.callTool({ name: 'preview_asset_update', arguments: {
        id: f.asset.id, operationId: 'http-write-001', patch: { name: 'Approved HTTP name' },
      } });
      const result = (preview.structuredContent as { result: PreviewResult }).result;
      expect(f.published).toHaveLength(1);
      const args = { id: f.asset.id, operationId: result.operationId, previewId: result.previewId, patch: { name: 'Approved HTTP name' } };
      expect((await f.client.callTool({ name: 'confirm_asset_update', arguments: args })).isError).toBe(true);
      expect(f.current().name).toBe(f.asset.name);
      await f.authority.approvePreview(f.grant.id, result.previewId);
      expect((await f.client.callTool({ name: 'confirm_asset_update', arguments: args })).structuredContent).toEqual({ result: { status: 'applied' } });
      expect((await f.client.callTool({ name: 'confirm_asset_update', arguments: args })).structuredContent).toEqual({ result: { status: 'duplicate' } });
      expect(f.current().name).toBe('Approved HTTP name');
      await f.authority.revokeGrant(f.grant.id);
      await expect(f.client.callTool({ name: 'list_assets', arguments: {} })).rejects.toThrow();
      expect(JSON.stringify(await f.authority.auditEntries(f.grant.id))).not.toContain('Approved HTTP name');
    } finally { await f.client.close(); await f.handler.close(); }
  });

  it.each([
    ['host', 'attacker.example'], ['origin', 'https://attacker.example'], ['cookie', 'unrelated=1'],
    ['authorization', 'Bearer malformed'],
  ])('rejects an untrusted %s before reading assets', async (header, value) => {
    const f = await fixture();
    try {
      const headers = new Headers({ host: new URL(endpoint).host, authorization: f.authorization, 'content-type': 'application/json' });
      headers.set(header, value);
      const reply = await f.handler.fetch(new Request(endpoint, { method: 'POST', headers, body: '{}' }));
      expect(reply.status).toBe(header === 'authorization' ? 401 : 403);
      expect(f.reads()).toBe(0);
      expect(await reply.text()).not.toContain(f.grant.secret);
    } finally { await f.handler.close(); }
  });

  it('bounds bodies before parsing and provides no grant/approval HTTP route', async () => {
    const f = await fixture();
    try {
      const headers = { host: new URL(endpoint).host, authorization: f.authorization, 'content-type': 'application/json' };
      const oversized = await f.handler.fetch(new Request(endpoint, { method: 'POST', headers, body: ' '.repeat(MCP_HTTP_REQUEST_LIMIT + 1) }));
      expect(oversized.status).toBe(413);
      const route = await f.handler.fetch(new Request(`${endpoint}/approve`, { method: 'POST', headers, body: '{}' }));
      expect(route.status).toBe(403);
      expect(f.reads()).toBe(0);
    } finally { await f.handler.close(); }
  });

  it('requires actual inbound Host metadata and refuses an already cancelled request', async () => {
    const f = await fixture();
    try {
      const headers = { authorization: f.authorization, 'content-type': 'application/json' };
      expect((await f.handler.fetch(new Request(endpoint, { method: 'POST', headers, body: '{}' }))).status).toBe(403);
      const spoofed = new Request(endpoint, { method: 'POST', headers: { ...headers, host: 'attacker.example' }, body: '{}' });
      expect((await f.handler.fetch(spoofed, { host: new URL(endpoint).host })).status).toBe(403);
      const controller = new AbortController(); controller.abort();
      const cancelled = new Request(endpoint, { method: 'POST', headers, body: '{}', signal: controller.signal });
      expect((await f.handler.fetch(cancelled, { host: new URL(endpoint).host })).status).toBe(408);
      expect(f.reads()).toBe(0);
    } finally { await f.handler.close(); }
  });

  it('does not write if the owner stops after a request entered canonical storage', async () => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const enteredStore = new Promise<void>(resolve => { entered = resolve; });
    const continueStore = new Promise<void>(resolve => { release = resolve; });
    const original = f.store.compareAndSet.bind(f.store);
    f.store.compareAndSet = async (id, version, next: Asset, guard) => {
      entered(); await continueStore; return original(id, version, next, guard);
    };
    try {
      await f.connect();
      const preview = await f.client.callTool({ name: 'preview_asset_update', arguments: {
        id: f.asset.id, operationId: 'http-stop-001', patch: { name: 'Must not write' },
      } });
      const result = (preview.structuredContent as { result: PreviewResult }).result;
      await f.authority.approvePreview(f.grant.id, result.previewId);
      const work = f.client.callTool({ name: 'confirm_asset_update', arguments: {
        id: f.asset.id, operationId: result.operationId, previewId: result.previewId, patch: { name: 'Must not write' },
      } }).then(value => value, error => error as Error);
      await enteredStore;
      await f.handler.close();
      release();
      const reply = await work;
      expect(reply instanceof Error || reply.isError === true).toBe(true);
      expect(f.current().name).toBe(f.asset.name);
      expect((await f.authority.operation(f.grant.id, result.operationId))?.state).toBe('pending');
    } finally { release?.(); await f.client.close(); await f.handler.close(); }
  });
});
