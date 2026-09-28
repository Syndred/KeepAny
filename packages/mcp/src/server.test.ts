import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { newAsset } from '../../domain/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { createKeepAnyMcpServer } from './server';

describe('official MCP protocol wiring', () => {
  it('lists only scoped tools and denies a write without out-of-band approval', async () => {
    const asset = { ...newAsset('project'), name: 'MCP visible' };
    const authority = new McpAuthority(new MemoryAuthorityStorage());
    const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 60_000 });
    const store = {
      async get(id: string) { return id === asset.id ? { asset, version: 'v1' } : null; },
      async list(ids: readonly string[]) { return ids.includes(asset.id) ? [{ asset, version: 'v1' }] : []; },
      async compareAndSet() { return 'applied' as const; },
    };
    const server = createKeepAnyMcpServer({ store, authority, grantId: grant.id, grantSecret: grant.secret });
    const client = new Client({ name: 'keepany-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name).sort()).toEqual([
        'confirm_asset_update', 'get_asset', 'list_assets', 'preview_asset_update',
      ]);
      const list = await client.callTool({ name: 'list_assets', arguments: {} });
      expect(list.isError).not.toBe(true);
      expect(JSON.stringify(list)).toContain('MCP visible');
      const preview = await client.callTool({ name: 'preview_asset_update',
        arguments: { id: asset.id, operationId: 'operation-003', patch: { name: 'Updated' } } });
      const result = (preview.structuredContent as { result: { previewId: string } }).result;
      const denied = await client.callTool({ name: 'confirm_asset_update',
        arguments: { id: asset.id, operationId: 'operation-003', previewId: result.previewId, patch: { name: 'Updated' } } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain('preview-not-approved');
    } finally { await client.close(); await server.close(); }
  });
});
