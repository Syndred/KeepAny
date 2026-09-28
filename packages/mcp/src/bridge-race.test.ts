import { afterEach, describe, expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { McpAuthority, MemoryAuthorityStorage } from './authority';
import { BrowserMcpBridgeClient } from './browser-bridge';
import { startLocalMcpBridge, type LocalMcpBridge } from './bridge';
import { McpAssetService, type AssetSnapshot, type McpAssetStore } from './service';

const appOrigin = 'http://127.0.0.1:5173';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class GatedStore implements McpAssetStore {
  row: AssetSnapshot;
  reads = 0;
  writes = 0;
  pauseAtRead = 0;
  readonly readEntered = deferred();
  readonly readRelease = deferred();
  pauseCas = false;
  commitAlreadySubmitted = false;
  readonly casEntered = deferred();
  readonly casRelease = deferred();
  loseAcknowledgement = false;
  constructor(asset: Asset) { this.row = { asset, version: 'v1' }; }
  async get(id: string) {
    this.reads++;
    if (this.reads === this.pauseAtRead) {
      this.readEntered.resolve();
      await this.readRelease.promise;
    }
    return id === this.row.asset.id ? this.row : null;
  }
  async list(ids: readonly string[]) { return ids.includes(this.row.asset.id) ? [this.row] : []; }
  async compareAndSet(id: string, version: string, next: Asset, assertCanCommit?: () => void | Promise<void>) {
    await assertCanCommit?.();
    if (this.pauseCas) { this.casEntered.resolve(); await this.casRelease.promise; }
    if (!this.commitAlreadySubmitted) await assertCanCommit?.();
    if (id !== this.row.asset.id || version !== this.row.version) return 'conflict' as const;
    this.row = { asset: next, version: 'v2' };
    this.writes++;
    if (this.loseAcknowledgement) throw Error('ack-lost');
    return 'applied' as const;
  }
}

const fixtures: Array<{ store: GatedStore; client: BrowserMcpBridgeClient; running: Promise<unknown>; bridge: LocalMcpBridge }> = [];
afterEach(async () => {
  for (const item of fixtures.splice(0)) {
    item.store.readRelease.resolve();
    item.store.casRelease.resolve();
    await item.client.close();
    await item.running;
    await item.bridge.close();
  }
});

async function fixture(requestTimeoutMs = 10_000, options?: {
  signal?: AbortSignal;
  wrapFetcher?: (base: typeof fetch) => typeof fetch;
}) {
  const asset = { ...newAsset('project'), name: 'Before' };
  const store = new GatedStore(asset);
  const authority = new McpAuthority(new MemoryAuthorityStorage());
  const grant = await authority.issueGrant({ assetIds: [asset.id], readFields: ['name'], writeFields: ['name'], ttlMs: 60_000 });
  const bridge = await startLocalMcpBridge({ appOrigin, authority, grantId: grant.id, grantSecret: grant.secret,
    requestTimeoutMs });
  const baseFetcher: typeof fetch = (input, init) => fetch(input, { ...init,
    headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), Origin: appOrigin } });
  const fetcher = options?.wrapFetcher?.(baseFetcher) ?? baseFetcher;
  const client = new BrowserMcpBridgeClient({ url: bridge.url, pairingSecret: bridge.pairingSecret,
    store, fetcher, approve: async () => true });
  await client.pair();
  const running = client.run(options?.signal).catch(error => error);
  fixtures.push({ store, client, running, bridge });
  const service = new McpAssetService(bridge.store, authority, grant.id, grant.secret);
  const preview = await service.previewUpdate(asset.id, `race-${crypto.randomUUID()}`, { name: 'After' });
  await authority.approvePreview(grant.id, preview.previewId);
  const confirm = () => service.confirmUpdate({ id: asset.id, operationId: preview.operationId,
    previewId: preview.previewId, patch: { name: 'After' } }).then(value => value, error => error as Error);
  return { asset, store, authority, grant, bridge, client, service, preview, confirm, running };
}

function hangingWriteCheck() {
  const entered = deferred();
  let checks = 0;
  let receivedSignal = false;
  let aborted = false;
  const wrapFetcher = (base: typeof fetch): typeof fetch => (input, init) => {
    if (String(input).endsWith('/check-write') && ++checks === 3) {
      receivedSignal = Boolean(init?.signal);
      entered.resolve();
      return new Promise<Response>((_resolve, reject) => {
        const fail = () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); };
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener('abort', fail, { once: true });
      });
    }
    return base(input, init);
  };
  return { entered, wrapFetcher, state: () => ({ receivedSignal, aborted, checks }) };
}

describe('browser MCP write cancellation boundary', () => {
  it('does not write after a successful revoke while the browser read is paused', async () => {
    const { store, client, confirm } = await fixture();
    store.pauseAtRead = store.reads + 2; // service read, then browser compareAndSet read
    const result = confirm();
    await store.readEntered.promise;
    expect((await client.revokeGrant()).writeMayHaveApplied).toBe(false);
    expect(store.writes).toBe(0);
    store.readRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(store.row.asset.name).toBe('Before');
    expect(store.writes).toBe(0);
  });

  it('cancels a queued commit and waits for the storage branch before confirming revoke', async () => {
    const { store, client, confirm } = await fixture();
    store.pauseCas = true;
    const result = confirm();
    await store.casEntered.promise;
    let revoked = false;
    const revocation = client.revokeGrant().then(value => { revoked = true; return value; });
    await Promise.resolve();
    expect(revoked).toBe(false);
    store.casRelease.resolve();
    expect((await revocation).writeMayHaveApplied).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
    expect(store.row.asset.name).toBe('Before');
  });

  it('reports a write already submitted to storage and never resolves revoke before it settles', async () => {
    const { store, client, confirm } = await fixture();
    store.pauseCas = true;
    store.commitAlreadySubmitted = true;
    const result = confirm();
    await store.casEntered.promise;
    let revoked = false;
    const revocation = client.revokeGrant().then(value => { revoked = true; return value; });
    await Promise.resolve();
    expect(revoked).toBe(false);
    store.casRelease.resolve();
    expect((await revocation).writeMayHaveApplied).toBe(true);
    expect(store.writes).toBe(1);
    expect(store.row.asset.name).toBe('After');
    const outcome = await result;
    expect(outcome instanceof Error || outcome.status === 'applied').toBe(true);
    expect(store.writes).toBe(1);
  });

  it('checks the current grant after a read paused across external revocation', async () => {
    const { store, authority, grant, confirm } = await fixture(300);
    store.pauseAtRead = store.reads + 2;
    const result = confirm();
    await store.readEntered.promise;
    await authority.revokeGrant(grant.id);
    store.readRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
  });

  it('refuses a request whose deadline passes while the browser read is paused', async () => {
    const { store, confirm } = await fixture(100);
    store.pauseAtRead = store.reads + 2;
    const result = confirm();
    await store.readEntered.promise;
    await new Promise(resolve => setTimeout(resolve, 130));
    store.readRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
  });

  it('refuses a session that expires before a paused read resumes', async () => {
    const { store, client, confirm } = await fixture();
    store.pauseAtRead = store.reads + 2;
    const result = confirm();
    await store.readEntered.promise;
    Object.assign(client, { expiresAt: Date.now() - 1 });
    store.readRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
  });

  it('cancels a paused read on close without allowing a later write', async () => {
    const { store, client, confirm } = await fixture();
    store.pauseAtRead = store.reads + 2;
    const result = confirm();
    await store.readEntered.promise;
    await client.close();
    store.readRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
  });

  it('propagates only the external run signal through a paused browser read', async () => {
    const controller = new AbortController();
    const { store, confirm, running } = await fixture(300, { signal: controller.signal });
    store.pauseAtRead = store.reads + 2;
    const result = confirm();
    await store.readEntered.promise;
    controller.abort();
    store.readRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    await running;
    expect(store.writes).toBe(0);
  });

  it('propagates only the external run signal into a queued CAS branch', async () => {
    const controller = new AbortController();
    const { store, confirm, running } = await fixture(300, { signal: controller.signal });
    store.pauseCas = true;
    const result = confirm();
    await store.casEntered.promise;
    controller.abort();
    store.casRelease.resolve();
    expect(await result).toBeInstanceOf(Error);
    await running;
    expect(store.writes).toBe(0);
  });

  it('aborts a hanging precommit check at the request deadline without writing', async () => {
    const hanging = hangingWriteCheck();
    const { store, confirm, running } = await fixture(100, { wrapFetcher: hanging.wrapFetcher });
    const result = confirm();
    await hanging.entered.promise;
    expect((await result)).toBeInstanceOf(Error);
    await running;
    expect(hanging.state()).toMatchObject({ receivedSignal: true, aborted: true });
    expect(store.writes).toBe(0);
  });

  it('aborts a hanging precommit check before confirming explicit revoke', async () => {
    const hanging = hangingWriteCheck();
    const { store, authority, grant, client, confirm } = await fixture(300, { wrapFetcher: hanging.wrapFetcher });
    const result = confirm();
    await hanging.entered.promise;
    expect((await client.revokeGrant()).writeMayHaveApplied).toBe(true);
    expect(hanging.state()).toMatchObject({ receivedSignal: true, aborted: true });
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
    await expect(authority.requireGrant(grant.id, grant.secret)).rejects.toThrow('grant-denied');
  });

  it('aborts a hanging precommit check when the browser client closes', async () => {
    const hanging = hangingWriteCheck();
    const { store, authority, grant, client, confirm } = await fixture(300, { wrapFetcher: hanging.wrapFetcher });
    const result = confirm();
    await hanging.entered.promise;
    await client.close();
    expect(hanging.state()).toMatchObject({ receivedSignal: true, aborted: true });
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
    await expect(authority.requireGrant(grant.id, grant.secret)).rejects.toThrow('grant-denied');
  });

  it('aborts a hanging precommit check when only the external run signal ends', async () => {
    const hanging = hangingWriteCheck();
    const controller = new AbortController();
    const { store, authority, grant, confirm, running } = await fixture(300,
      { signal: controller.signal, wrapFetcher: hanging.wrapFetcher });
    const result = confirm();
    await hanging.entered.promise;
    controller.abort();
    await running;
    expect(hanging.state()).toMatchObject({ receivedSignal: true, aborted: true });
    expect(await result).toBeInstanceOf(Error);
    expect(store.writes).toBe(0);
    await expect(authority.requireGrant(grant.id, grant.secret)).rejects.toThrow('grant-denied');
  });

  it('keeps a committed write uncertain when its acknowledgement is lost', async () => {
    const { store, service, preview, confirm, asset } = await fixture();
    store.loseAcknowledgement = true;
    expect(await confirm()).toBeInstanceOf(Error);
    expect(store.row.asset.name).toBe('After');
    expect(store.writes).toBe(1);
    await expect(service.confirmUpdate({ id: asset.id, operationId: preview.operationId,
      previewId: preview.previewId, patch: { name: 'After' } })).rejects.toThrow('operation-uncertain');
    expect(store.writes).toBe(1);
  });
});
