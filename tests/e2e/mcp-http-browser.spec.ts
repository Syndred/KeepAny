import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('portable official MCP HTTP handler runs in an actual browser without a Node bridge', async ({ page }) => {
  await page.goto('/');
  const root = process.cwd().replaceAll('\\', '/');
  const clientEntry = fileURLToPath(import.meta.resolve('@modelcontextprotocol/client')).replaceAll('\\', '/');
  const result = await page.evaluate(async ({ root, clientEntry }) => {
    const path = `/@fs/${root}`;
    const [{ createKeepAnyMcpHttpHandler }, { McpAuthority, MemoryAuthorityStorage }, { newAsset }, { Client, StreamableHTTPClientTransport }] = await Promise.all([
      import(`${path}/packages/mcp/src/http-handler.ts`), import(`${path}/packages/mcp/src/authority.ts`),
      import(`${path}/packages/domain/src/index.ts`), import(`/@fs/${clientEntry}`),
    ]);
    const asset = { ...newAsset('project'), name: 'Browser protocol selected', notes: 'excluded-browser-private' };
    const authority = new McpAuthority(new MemoryAuthorityStorage());
    const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], ttlMs: 60_000 });
    const endpoint = 'https://192.168.50.10:47321/mcp';
    const handler = createKeepAnyMcpHttpHandler({ endpoint, authority, store: {
      async get(id: string) { return id === asset.id ? { asset, version: '1' } : null; },
      async list(ids: readonly string[]) { return ids.includes(asset.id) ? [{ asset, version: '1' }] : []; },
      async compareAndSet() { throw Error('read-only-fixture'); },
    } });
    const client = new Client({ name: 'browser-protocol-fixture', version: '1.0.0' });
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return handler.fetch(request, { host: '192.168.50.10:47321' });
    };
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { fetch: fetcher,
        requestInit: { headers: { authorization: `Bearer ${grant.id}.${grant.secret}` } } }));
      const tools = await client.listTools();
      const reply = await client.callTool({ name: 'list_assets', arguments: {} });
      const denied = await handler.fetch(new Request(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${grant.id}.${grant.secret}`, 'content-type': 'application/json',
      }, body: '{}' }), { host: 'attacker.example' });
      return { tools: tools.tools.map((tool: { name: string }) => tool.name).sort(),
        names: (reply.structuredContent as { result: Array<{ name: string }> }).result.map(row => row.name),
        leaked: JSON.stringify(reply).includes(asset.notes), spoofedHostStatus: denied.status,
        nativeEvidence: false, listenerCreated: false };
    } finally { await client.close(); await handler.close(); }
  }, { root, clientEntry });
  expect(result).toEqual({ tools: ['confirm_asset_update', 'get_asset', 'list_assets', 'preview_asset_update'],
    names: ['Browser protocol selected'], leaked: false, spoofedHostStatus: 403, nativeEvidence: false, listenerCreated: false });
});
