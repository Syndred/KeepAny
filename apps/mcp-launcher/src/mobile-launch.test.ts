import { createServer } from 'node:https';
import { spawnSync } from 'node:child_process';
import type { AddressInfo, Socket } from 'node:net';
import { join, resolve } from 'node:path';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import { digest, McpAuthority, MemoryAuthorityStorage } from '../../../packages/mcp/src/authority';
import { createMobileMcpPairing } from '../../../packages/mcp/src/mobile-pairing';
import type { McpAssetStore, PreviewResult } from '../../../packages/mcp/src/service';
import { nativePrivateFiles, stopPrivateFilesHelper } from '../../../packages/mcp/src/node-private-files';
import { privateTestDirectory } from '../../../packages/mcp/src/node-private-files.test-support';
import { certificate } from './mobile-launch.test-support';
import { pairMobileMcp } from './mobile-launch';
import { readMobileMcpConnectionFile } from './mobile-connection';

const cleanup: (() => Promise<void>)[] = [];
const executable = process.env.KEEPANY_MOBILE_CLI_TEST_EXECUTABLE ?? resolve('dist/mcp-launcher/bin/keepany-mcp.mjs');
beforeAll(() => { if (process.env.KEEPANY_MOBILE_CLI_TEST_EXECUTABLE) return;
  const result = spawnSync(process.execPath, ['scripts/build-mcp-launcher.mjs'], { encoding: 'utf8', windowsHide: true }); expect(result.status, result.stderr).toBe(0); });
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); stopPrivateFilesHelper(); });
const until = async (check: () => boolean) => { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('test-condition'); };

async function fixture(mode: 'normal' | 'denied' | 'code' | 'scope' | 'expiry' | 'extra' = 'normal') {
  const identity = certificate(), directory = await privateTestDirectory('keepany-mobile-cli-');
  cleanup.push(async () => { stopPrivateFilesHelper(); await rm(directory, { recursive: true, force: true }); });
  let asset = { ...newAsset('project'), name: 'selected ordinary project', notes: 'excluded-secret-note' };
  const original = structuredClone(asset), other = newAsset('account'), storage = new MemoryAuthorityStorage(), authority = new McpAuthority(storage);
  let pauseCommit: Promise<void> | undefined, commits = 0;
  const store: McpAssetStore = { get: async id => id === asset.id ? { asset, version: digest(JSON.stringify(asset)) } : null,
    list: async ids => ids.includes(asset.id) ? [{ asset, version: digest(JSON.stringify(asset)) }] : [],
    compareAndSet: async (id, expected, next, guard) => { commits++; await pauseCommit; await guard?.(); if (id !== asset.id || expected !== digest(JSON.stringify(asset))) return 'conflict'; asset = next; return 'applied'; } };
  let controller: ReturnType<typeof createMobileMcpPairing>, clientNonce = '', requests = 0, extraListed = false;
  const sockets = new Set<Socket>();
  const server = createServer({ key: identity.key, cert: identity.pem }, (req, res) => {
    const chunks: Buffer[] = []; req.on('data', part => chunks.push(part)); req.on('end', () => {
      requests++;
      const abort = new AbortController(); res.once('close', () => { if (!res.writableFinished) abort.abort(); });
      void controller.fetch(new Request(`https://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks), signal: abort.signal }), { host: req.headers.host ?? '' }).then(async response => {
        let body = await response.text();
        if (req.url === '/mcp' && mode === 'extra') {
          const inject = (text: string) => {
            let value: { result?: { tools?: unknown[] } };
            try { value = JSON.parse(text); } catch { return text; }
            if (!Array.isArray(value.result?.tools)) return text;
            extraListed = true; value.result.tools.push({ name: 'approve_everything', description: 'forbidden', inputSchema: { type: 'object' } });
            return JSON.stringify(value);
          };
          body = response.headers.get('content-type')?.includes('text/event-stream') ? body.replace(/^data: (.+)$/gm, (_, data: string) => `data: ${inject(data)}`) : inject(body);
        }
        if (req.url === '/pair' && response.status === 200 && mode !== 'normal') {
          const value = JSON.parse(body);
          if (mode === 'code') value.comparisonCode = '00000000';
          if (mode === 'scope') value.scope.assetIds = [other.id];
          if (mode === 'expiry') value.expiresAt = Date.now() - 1;
          body = JSON.stringify(value);
        }
        const headers = new Headers(response.headers); headers.delete('content-length');
        res.writeHead(response.status, Object.fromEntries(headers)); res.end(body);
      }).catch(() => { res.writeHead(500); res.end(); });
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }); server.on('tlsClientError', () => {});
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  controller = createMobileMcpPairing({ endpoint: { endpoint, certificatePem: identity.pem, spkiSha256: identity.pin, instanceId: crypto.randomUUID() },
    authority, store, scope: { assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 300000 },
    assertAvailable: () => {}, onClient: c => { clientNonce = c.clientNonce; } });
  cleanup.push(async () => { await controller.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(r => server.close(() => r())); });
  const path = join(directory, 'pair.json');
  if (process.platform === 'win32') await nativePrivateFiles.createFile(path, JSON.stringify(controller.pairingFile));
  else await writeFile(path, JSON.stringify(controller.pairingFile), { mode: 0o600, flag: 'wx' });
  return { directory, path, authority, storage, controller, original, other, sockets, current: () => asset, requests: () => requests,
    pending: () => Boolean(clientNonce), approve: () => controller.decideClient(clientNonce, mode !== 'denied'),
    commits: () => commits, pauseCommit: (value: Promise<void>) => { pauseCommit = value; }, extraListed: () => extraListed };
}

async function connect(path: string, stateDir?: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [executable,
    stateDir ? '--mobile-pairing' : '--mobile-connection', path, ...(stateDir ? ['--state-dir', stateDir] : [])], stderr: 'pipe' });
  let diagnostic = ''; transport.stderr?.on('data', chunk => { diagnostic += chunk.toString(); });
  const client = new Client({ name: 'real-child-stdio-test', version: '1' });
  cleanup.push(async () => { await client.close(); await transport.close(); });
  return { client, transport, opening: client.connect(transport), diagnostic: () => diagnostic };
}

it('real packaged CLI proposes scope, bridges official SDK stdio, preserves per-write approval and reconnects from a persistent profile', async () => {
  const f = await fixture(), c = await connect(f.path, f.directory);
  await until(f.pending); expect((await f.storage.read()).grants).toHaveLength(0);
  await until(() => /comparison code: [A-F0-9]{8}/.test(c.diagnostic())); await f.approve(); await c.opening;
  expect((await c.client.listTools()).tools.map(t => t.name).sort()).toEqual(['confirm_asset_update', 'get_asset', 'list_assets', 'preview_asset_update']);
  const list = await c.client.callTool({ name: 'list_assets', arguments: {} }); expect(JSON.stringify(list)).toContain(f.original.name); expect(JSON.stringify(list)).not.toContain('excluded-secret-note');
  expect((await c.client.callTool({ name: 'get_asset', arguments: { id: f.other.id } })).isError).toBe(true);
  const args = { id: f.original.id, operationId: 'original-operation-001', patch: { name: 'explicit phone-approved change' } };
  const preview = await c.client.callTool({ name: 'preview_asset_update', arguments: args });
  const previewId = (preview.structuredContent as { result: PreviewResult }).result.previewId;
  const confirmation = { name: 'confirm_asset_update', arguments: { ...args, previewId } };
  expect((await c.client.callTool(confirmation)).isError).toBe(true); expect(f.current()).toEqual(f.original);
  const grantId = f.controller.grantId; if (!grantId) throw Error('missing-grant');
  await f.authority.approvePreview(grantId, previewId);
  expect((await c.client.callTool(confirmation)).isError).not.toBe(true); expect((await c.client.callTool(confirmation)).isError).not.toBe(true);
  expect((await f.storage.read()).operations).toHaveLength(1); expect(f.current().name).toBe(args.patch.name);
  const profiles = (await readdir(f.directory)).filter(name => name.startsWith('connection-')); expect(profiles).toHaveLength(1);
  const profile = join(f.directory, profiles[0]), saved = await readMobileMcpConnectionFile(profile);
  expect(c.diagnostic().match(/comparison code:/g)).toHaveLength(1); expect(c.diagnostic()).not.toContain(saved.grantSecret); expect(c.diagnostic()).not.toContain(saved.endpoint);
  await Promise.all([c.client.close(), c.transport.close(), c.transport.close()]); expect(await f.authority.requireGrant(saved.grantId, saved.grantSecret)).toBeDefined();
  const reconnect = await connect(profile); await reconnect.opening; expect((await reconnect.client.callTool({ name: 'list_assets', arguments: {} })).isError).not.toBe(true);
  await f.authority.revokeGrant(saved.grantId); expect((await reconnect.client.callTool({ name: 'list_assets', arguments: {} })).isError).toBe(true);
  await reconnect.client.close(); await reconnect.transport.close();
  const revoked = await connect(profile); await expect(revoked.opening).rejects.toThrow();
}, 30000);

it.each(['denied', 'code', 'scope', 'expiry'] as const)('rejects real TLS pairing %s without writing a profile', async mode => {
  const f = await fixture(mode), abort = new AbortController(), diagnostic: string[] = [];
  const pairing = pairMobileMcp(f.path, abort.signal, line => diagnostic.push(line));
  const checked = expect(pairing).rejects.toThrow(/^mobile-mcp-pairing-/); await until(f.pending); await f.approve(); await checked;
  expect((await readdir(f.directory)).filter(name => name.startsWith('connection-'))).toHaveLength(0);
  expect(diagnostic).toHaveLength(1); expect(diagnostic[0]).toMatch(/^KeepAny MCP comparison code: [A-F0-9]{8}$/);
});

it('refuses a remote tool surface containing an additional approval capability', async () => {
  const f = await fixture('extra'), c = await connect(f.path, f.directory);
  const failed = expect(c.opening).rejects.toThrow(); await until(f.pending); await f.approve(); await failed;
  expect(f.extraListed(), c.diagnostic()).toBe(true); expect(c.diagnostic()).toContain('mobile-mcp-tools-invalid');
  expect((await readdir(f.directory)).filter(name => name.startsWith('connection-'))).toHaveLength(0);
}, 15000);

it('closing actual stdio during pending approval aborts polling and creates no grant/profile or replay', async () => {
  const f = await fixture(), c = await connect(f.path, f.directory);
  const failed = expect(c.opening).rejects.toThrow(); await until(f.pending);
  await c.transport.close(); await failed; const count = f.requests(); await new Promise(r => setTimeout(r, 1000));
  expect(f.requests()).toBe(count); expect((await f.storage.read()).grants).toHaveLength(0);
  expect((await readdir(f.directory)).filter(name => name.startsWith('connection-'))).toHaveLength(0);
}, 15000);

it('actual child termination aborts an in-flight TLS write before commit without replaying it', async () => {
  const f = await fixture(), c = await connect(f.path, f.directory);
  await until(f.pending); await f.approve(); await c.opening;
  const args = { id: f.original.id, operationId: 'no-replay-after-termination', patch: { name: 'must-not-commit' } };
  const preview = await c.client.callTool({ name: 'preview_asset_update', arguments: args });
  const previewId = (preview.structuredContent as { result: PreviewResult }).result.previewId;
  const grantId = f.controller.grantId; if (!grantId) throw Error('missing-grant');
  await f.authority.approvePreview(grantId, previewId);
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); f.pauseCommit(blocked);
  const writing = c.client.callTool({ name: 'confirm_asset_update', arguments: { ...args, previewId } });
  const failed = expect(writing).rejects.toThrow(); await until(() => f.commits() === 1);
  const start = performance.now(); await c.transport.close(); await failed;
  expect(performance.now() - start).toBeLessThan(4000); await until(() => f.sockets.size === 0);
  release(); await new Promise(r => setTimeout(r, 100));
  expect(f.current()).toEqual(f.original); expect(f.commits()).toBe(1);
  expect((await f.storage.read()).operations.filter(operation => operation.state === 'applied')).toHaveLength(0);
}, 15000);

it('official SDK request cancellation aborts the in-flight HTTP write without an automatic retry', async () => {
  const f = await fixture(), c = await connect(f.path, f.directory);
  await until(f.pending); await f.approve(); await c.opening;
  const args = { id: f.original.id, operationId: 'cancel-request-no-replay', patch: { name: 'must-not-commit' } };
  const preview = await c.client.callTool({ name: 'preview_asset_update', arguments: args });
  const previewId = (preview.structuredContent as { result: PreviewResult }).result.previewId;
  const grantId = f.controller.grantId; if (!grantId) throw Error('missing-grant');
  await f.authority.approvePreview(grantId, previewId);
  let release!: () => void; f.pauseCommit(new Promise<void>(resolve => { release = resolve; }));
  const abort = new AbortController();
  const writing = c.client.callTool({ name: 'confirm_asset_update', arguments: { ...args, previewId } }, { signal: abort.signal });
  const failed = expect(writing).rejects.toThrow(); await until(() => f.commits() === 1);
  expect((await c.client.callTool({ name: 'list_assets', arguments: {} })).isError).not.toBe(true);
  abort.abort(); await failed;
  try { await until(() => f.sockets.size === 0); }
  finally { release(); }
  await new Promise(r => setTimeout(r, 100)); expect(f.current()).toEqual(f.original); expect(f.commits()).toBe(1);
  expect((await c.client.callTool({ name: 'list_assets', arguments: {} })).isError).not.toBe(true);
}, 15000);

