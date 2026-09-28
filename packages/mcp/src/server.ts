import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import type { McpAuthority } from './authority';
import { McpAccessError } from './authority';
import { McpAssetService, type McpAssetStore } from './service';

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string().max(60)).max(100).optional(),
  description: z.string().max(20_000).optional(),
  url: z.string().max(2_000).optional(),
}).strict();

export interface LocalMcpOptions {
  store: McpAssetStore;
  authority: McpAuthority;
  grantId: string;
  grantSecret: string;
}

const response = (work: Promise<unknown>) => work.then(value => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  structuredContent: { result: value },
})).catch(error => ({
  content: [{ type: 'text' as const, text: error instanceof McpAccessError ? error.code : 'operation-failed' }],
  isError: true,
}));

export function createKeepAnyMcpServer(options: LocalMcpOptions) {
  const service = new McpAssetService(options.store, options.authority, options.grantId, options.grantSecret);
  const server = new McpServer({ name: 'keepany-local', version: '0.1.0' });
  server.registerTool('list_assets', {
    description: 'List only the assets and fields included in the active local grant.',
    inputSchema: z.object({ query: z.string().max(160).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, ({ query, limit }) => response(service.listAssets(query, limit)));
  server.registerTool('get_asset', {
    description: 'Read one selected asset, projected to the locally approved fields.',
    inputSchema: z.object({ id: z.string().min(1).max(96) }).strict(),
    annotations: { readOnlyHint: true },
  }, ({ id }) => response(service.getAsset(id)));
  server.registerTool('preview_asset_update', {
    description: 'Preview one permitted asset update. A trusted local caller must separately approve the exact preview before confirmation.',
    inputSchema: z.object({ id: z.string().min(1).max(96), operationId: z.string().regex(/^[A-Za-z0-9_-]{8,96}$/), patch: patchSchema }).strict(),
    annotations: { readOnlyHint: true },
  }, ({ id, operationId, patch }) => response(service.previewUpdate(id, operationId, patch)));
  server.registerTool('confirm_asset_update', {
    description: 'Apply a previously previewed update only after out-of-band local approval. Reusing an operation ID is idempotent.',
    inputSchema: z.object({ id: z.string().min(1).max(96), operationId: z.string().regex(/^[A-Za-z0-9_-]{8,96}$/),
      previewId: z.string().uuid(), patch: patchSchema }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, ({ id, operationId, previewId, patch }) => response(service.confirmUpdate({ id, operationId, previewId, patch })));
  return server;
}

// The caller supplies the canonical asset adapter and an already issued grant.
// No unauthenticated HTTP listener is created.
export async function serveKeepAnyMcpStdio(options: LocalMcpOptions) {
  await options.authority.requireGrant(options.grantId, options.grantSecret);
  return serveStdio(() => createKeepAnyMcpServer(options));
}
