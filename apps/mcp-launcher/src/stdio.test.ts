import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import { BrowserMcpBridgeClient } from '../../../packages/mcp/src/browser-bridge';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error('condition-timeout');
};

describe('official SDK stdio launcher', () => {
  it('serves only the paired, approved browser projection and removes the one-time file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepany-mcp-stdio-'));
    directories.push(directory);
    await chmod(directory, 0o700);
    const home = join(directory, 'home');
    await mkdir(home, { mode: 0o700 });
    const requestPath = join(directory, 'request.json');
    const pairingPath = join(directory, 'pairing.json');
    const appOrigin = 'http://127.0.0.1:5173';
    const asset = { ...newAsset('project'), name: 'Visible project', description: 'Hidden description' };
    await writeFile(requestPath, JSON.stringify({
      kind: 'keepany-mcp-local-request-v1', appOrigin, assetIds: [asset.id],
      readFields: ['name'], writeFields: [], ttlMs: 60_000,
      createdAt: Date.now(), requestNonce: '4ec6c297-633c-4408-83e8-090d9e39a554',
    }));
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const main = fileURLToPath(new URL('./main.ts', import.meta.url));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({
      command: join(repo, 'node_modules', '.bin', 'tsx'),
      args: [main, '--request', requestPath, '--pairing-file', pairingPath],
      cwd: repo, env: { ...env, HOME: home }, stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += String(chunk); });
    const client = new Client({ name: 'keepany-launcher-test', version: '1.0.0' });
    let browser: BrowserMcpBridgeClient | undefined;
    let running: Promise<void> | undefined;
    try {
      await client.connect(transport);
      await waitFor(async () => access(pairingPath).then(() => true, () => false));
      const pairing = JSON.parse(await readFile(pairingPath, 'utf8')) as {
        url: string; pairingSecret: string; requestNonce: string; appOrigin: string;
      };
      expect(pairing.requestNonce).toBe('4ec6c297-633c-4408-83e8-090d9e39a554');
      expect(pairing.appOrigin).toBe(appOrigin);
      expect(stderr).not.toContain(pairing.pairingSecret);
      const before = await client.callTool({ name: 'list_assets', arguments: {} });
      expect(before.isError).toBe(true);
      expect(JSON.stringify(before)).toContain('bridge-unpaired');

      const store = {
        async get(id: string) { return id === asset.id ? { asset, version: 'v1' } : null; },
        async list(ids: readonly string[]) { return ids.includes(asset.id) ? [{ asset, version: 'v1' }] : []; },
        async compareAndSet() { return 'conflict' as const; },
      };
      const fetcher: typeof fetch = (input, init) => fetch(input, { ...init,
        headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), Origin: appOrigin } });
      browser = new BrowserMcpBridgeClient({ url: pairing.url, pairingSecret: pairing.pairingSecret,
        store, fetcher, approve: async scope => scope.assetIds.length === 1 && scope.assetIds[0] === asset.id });
      await browser.pair();
      running = browser.run();
      await waitFor(async () => access(pairingPath).then(() => false, () => true));
      const list = await client.callTool({ name: 'list_assets', arguments: {} });
      expect(list.isError).not.toBe(true);
      expect((list.structuredContent as { result: unknown }).result).toEqual([{ id: asset.id, name: asset.name }]);
      expect(JSON.stringify(list)).not.toContain(asset.description);
      expect(stderr).not.toContain(pairing.pairingSecret);
    } finally {
      browser?.close();
      await running?.catch(() => undefined);
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }, 20_000);

  it('deletes an unpaired secret file and closes on SIGTERM', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keepany-mcp-signal-'));
    directories.push(directory);
    await chmod(directory, 0o700);
    const home = join(directory, 'home');
    await mkdir(home, { mode: 0o700 });
    const requestPath = join(directory, 'request.json');
    const pairingPath = join(directory, 'pairing.json');
    await writeFile(requestPath, JSON.stringify({
      kind: 'keepany-mcp-local-request-v1', appOrigin: 'http://127.0.0.1:5173', assetIds: ['asset-1'],
      readFields: ['name'], writeFields: [], ttlMs: 60_000, createdAt: Date.now(),
      requestNonce: '338aa9ea-1bb8-4d52-bffa-63cd974e830d',
    }));
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const main = fileURLToPath(new URL('./main.ts', import.meta.url));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({ command: join(repo, 'node_modules', '.bin', 'tsx'),
      args: [main, '--request', requestPath, '--pairing-file', pairingPath],
      cwd: repo, env: { ...env, HOME: home }, stderr: 'pipe' });
    const client = new Client({ name: 'keepany-signal-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      await waitFor(async () => access(pairingPath).then(() => true, () => false));
      if (!transport.pid) throw Error('missing-child-pid');
      process.kill(transport.pid, 'SIGTERM');
      await waitFor(async () => access(pairingPath).then(() => false, () => true));
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }, 20_000);
});
