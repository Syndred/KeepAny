import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeProtectedHeader, exportJWK, jwtVerify, SignJWT } from 'jose';
import { createBoundStateFeed, type BoundStateFeedConfig, type BoundStateFeedStore } from './bound-state-feed';
import type { VerifiedBoundState } from './bound-state-record';

const bindingId = randomUUID();
const reader = generateKeyPairSync('rsa', { modulusLength: 2048 });
const commercial = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const readerPrivatePem = reader.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicJwk = { ...commercial.publicKey.export({ format: 'jwk' }), kid: 'commerce-1', alg: 'RS256', use: 'sig' };
const otherJwk = { ...other.publicKey.export({ format: 'jwk' }), kid: 'commerce-2', alg: 'RS256', use: 'sig' };

type Fixture = {
  server: Server;
  origin: string;
  config: BoundStateFeedConfig;
  applied: VerifiedBoundState[];
  received: string[];
  setHandler(handler: (id: string) => Promise<Response>): void;
  close(): Promise<void>;
};

async function signState(origin: string, overrides: Record<string, unknown> = {},
  options: { key?: typeof commercial.privateKey; kid?: string; typ?: string } = {}): Promise<string> {
  const observed = new Date();
  const payload = {
    binding_id: bindingId, instance_id_hash: 'a'.repeat(64), jkt: Buffer.alloc(32, 0xbb).toString('base64url'),
    scopes: ['sync:read', 'sync:write'], status: 'active', epoch: 1,
    token_valid_after: 0, state_observed_at: observed.toISOString(),
    state_expires_at: new Date(observed.getTime() + 10_000).toISOString(),
    ...overrides,
  };
  const issuedAt = Math.floor(new Date(String(payload.state_observed_at)).getTime() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: options.typ ?? 'keepany-bound-state+jwt', kid: options.kid ?? 'commerce-1' })
    .setIssuer(origin).setAudience('keepany-bound-state-writer')
    .setSubject(`keepanyadm:${randomUUID()}`).setJti(randomUUID())
    .setIssuedAt(issuedAt).setExpirationTime(issuedAt + 10)
    .sign(options.key ?? commercial.privateKey);
}

function response(assertion: string) {
  return Response.json({ code: 0, message: 'ok', data: { assertion } }, { headers: { 'Cache-Control': 'no-store' } });
}

async function fixture(overrides: Partial<BoundStateFeedConfig> = {}): Promise<Fixture> {
  let handler: (id: string) => Promise<Response> = async () => Response.json({ code: -1, message: 'unavailable' }, { status: 503 });
  const received: string[] = [];
  const applied: VerifiedBoundState[] = [];
  const server = createServer(async (request, result) => {
    const id = request.url?.split('/').at(-1) ?? '';
    received.push(id);
    const served = await handler(id);
    result.writeHead(served.status, Object.fromEntries(served.headers));
    result.end(Buffer.from(await served.arrayBuffer()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('test-server-address');
  const origin = `http://127.0.0.1:${address.port}`;
  const store: BoundStateFeedStore = {
    hasState: async id => applied.some(state => state.bindingId === id),
    listKnownNonRevokedIds: async () => [bindingId],
    upsertVerifiedState: async state => { applied.push(state); return 'applied'; },
  };
  const config: BoundStateFeedConfig = {
    readerIssuer: origin, readerPrivatePem, readerKid: 'reader-1',
    commercialOrigin: origin, commercialIssuer: origin,
    commercialJwks: { keys: [publicJwk, otherJwk] }, store, ...overrides,
  };
  return {
    server, origin, config, applied, received,
    setHandler(next) { handler = next; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const openFixtures: Fixture[] = [];
afterEach(async () => { await Promise.all(openFixtures.splice(0).map(item => item.close())); });
async function open(overrides?: Partial<BoundStateFeedConfig>) {
  const item = await fixture(overrides);
  openFixtures.push(item);
  return item;
}

describe('bound state feed', () => {
  it('signs an independent, exact reader JWT and persists only the signed lease', async () => {
    const item = await open();
    item.setHandler(async id => {
      expect(id).toBe(bindingId);
      return response(await signState(item.origin));
    });
    const original = item.config.fetchFn;
    item.config.fetchFn = async (url, init) => {
      expect(url).toBe(`${item.origin}/api/keepany/v1/bound-state/${bindingId}`);
      expect(init?.method).toBe('GET');
      expect(init?.cache).toBe('no-store');
      expect(init?.redirect).toBe('error');
      const header = new Headers(init?.headers).get('authorization') ?? '';
      expect(header.startsWith('Bearer ')).toBe(true);
      const token = header.slice(7);
      expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', kid: 'reader-1', typ: 'bound-state-reader+jwt' });
      const jwk = await exportJWK(reader.publicKey);
      const { payload } = await jwtVerify(token, reader.publicKey, {
        issuer: item.origin, audience: 'keepany-bound-state-read', algorithms: ['RS256'],
      });
      expect(jwk.kty).toBe('RSA');
      expect(payload.sub).toBe('keepany-sync-state-writer');
      expect(payload.binding_id).toBe(bindingId);
      expect(payload.htm).toBe('GET');
      expect(payload.htu).toBe(url);
      expect(Number(payload.exp) - Number(payload.iat)).toBe(20);
      expect(Object.keys(payload).sort()).toEqual(['aud', 'binding_id', 'exp', 'htm', 'htu', 'iat', 'iss', 'jti', 'sub']);
      return (original ?? fetch)(url, init);
    };
    const feed = createBoundStateFeed(item.config);
    await feed.refresh(bindingId);
    expect(item.applied).toHaveLength(1);
    expect(item.applied[0].stateExpiresAt.getTime()).toBeLessThanOrEqual(
      item.applied[0].stateObservedAt.getTime() + 10_000,
    );
    expect(item.applied[0].stateExpiresAt.getTime()).toBeLessThanOrEqual(
      (Math.floor(item.applied[0].stateObservedAt.getTime() / 1000) + 10) * 1000,
    );
    await feed.close();
  });

  it('accepts the second pinned public key, but rejects unknown signing keys', async () => {
    const item = await open();
    item.setHandler(async () => response(await signState(item.origin, {}, { key: other.privateKey, kid: 'commerce-2' })));
    const feed = createBoundStateFeed(item.config);
    await feed.refresh(bindingId);
    expect(item.applied).toHaveLength(1);
    item.setHandler(async () => response(await signState(item.origin, {}, { key: other.privateKey, kid: 'not-pinned' })));
    await expect(feed.refresh(bindingId)).rejects.toThrow();
    expect(item.applied).toHaveLength(1);
    await feed.close();
  });

  it.each([
    ['cross binding', { binding_id: randomUUID() }, {}],
    ['extra claim', { unexpected: true }, {}],
    ['duplicate scopes', { scopes: ['sync:read', 'sync:read'] }, {}],
    ['missing read scope', { scopes: ['sync:write'] }, {}],
    ['invalid status', { status: 'future' }, {}],
    ['invalid epoch', { epoch: 1.5 }, {}],
    ['invalid cutoff', { token_valid_after: -1 }, {}],
    ['changed timestamp', { state_expires_at: new Date(Date.now() + 11_000).toISOString() }, {}],
    ['wrong type', {}, { typ: 'JWT' }],
  ])('rejects %s without a database write', async (_name, claims, options) => {
    const item = await open();
    item.setHandler(async () => response(await signState(item.origin, claims, options)));
    const feed = createBoundStateFeed(item.config);
    await expect(feed.refresh(bindingId)).rejects.toThrow();
    expect(item.applied).toHaveLength(0);
    await feed.close();
  });

  it('does not renew an old observation from HTTP arrival time', async () => {
    const item = await open();
    item.setHandler(async () => {
      const observed = new Date(Date.now() - 5000);
      const token = await signState(item.origin, {
        state_observed_at: observed.toISOString(),
        state_expires_at: new Date(observed.getTime() + 10_000).toISOString(),
      });
      return response(token);
    });
    const feed = createBoundStateFeed(item.config);
    await feed.refresh(bindingId);
    expect(item.applied).toHaveLength(1);
    expect(item.applied[0].stateExpiresAt.getTime() - Date.now()).toBeLessThan(5000);
    item.setHandler(async () => {
      const observed = new Date(Date.now() - 11_000);
      return response(await signState(item.origin, {
        state_observed_at: observed.toISOString(),
        state_expires_at: new Date(observed.getTime() + 10_000).toISOString(),
      }));
    });
    await expect(feed.refresh(bindingId)).rejects.toThrow();
    expect(item.applied).toHaveLength(1);
    await feed.close();
  });

  it('aborts an outstanding HTTP request on close without applying state', async () => {
    const item = await open();
    let requestStarted = () => {};
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    item.config.fetchFn = async (_url, init) => {
      requestStarted();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      });
    };
    const feed = createBoundStateFeed(item.config);
    const operation = feed.refresh(bindingId);
    await started;
    await feed.close();
    await expect(operation).rejects.toThrow();
    expect(item.applied).toHaveLength(0);
  });

  it('deduplicates verified bootstrap and bounds unknown-id attempts', async () => {
    const item = await open();
    item.setHandler(async () => response(await signState(item.origin)));
    const feed = createBoundStateFeed(item.config);
    await Promise.all(Array.from({ length: 20 }, () => feed.bootstrapIfMissing(bindingId)));
    expect(item.received).toHaveLength(1);
    await feed.bootstrapIfMissing(bindingId);
    expect(item.received).toHaveLength(1);
    await feed.close();
  });

  it('caps distinct first-time bootstrap HTTP requests in one time window', async () => {
    const item = await open();
    item.setHandler(async () => Response.json({ code: -1, message: 'unknown' }, { status: 404 }));
    const feed = createBoundStateFeed(item.config);
    await Promise.all(Array.from({ length: 24 }, () => feed.bootstrapIfMissing(randomUUID())));
    expect(item.received.length).toBeLessThanOrEqual(8);
    expect(item.applied).toHaveLength(0);
    await feed.close();
  });

  it('polls a known inactive binding and accepts a later recovery', async () => {
    const item = await open({ intervalMs: 25 });
    let status: 'inactive' | 'active' = 'inactive';
    item.setHandler(async () => response(await signState(item.origin, { status,
      epoch: status === 'inactive' ? 2 : 3,
      token_valid_after: status === 'inactive' ? 1 : 2,
      ...(status === 'inactive' ? { state_expires_at: new Date(Date.now() + 1000).toISOString() } : {}),
    })));
    const feed = createBoundStateFeed(item.config);
    await feed.start();
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(item.applied.some(state => state.status === 'inactive')).toBe(true);
    status = 'active';
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(item.applied.some(state => state.status === 'active')).toBe(true);
    await feed.close();
  }, 2000);

  it('renews 24 slow healthy leases through multiple real-time rounds without a gap', async () => {
    const ids = Array.from({ length: 24 }, () => randomUUID());
    const item = await open({
      store: {
        hasState: async () => true,
        listKnownNonRevokedIds: async () => ids,
        upsertVerifiedState: async state => { item.applied.push(state); return 'applied'; },
      },
      onError: () => {},
    });
    item.setHandler(async id => {
      const signed = await signState(item.origin, { binding_id: id });
      await new Promise(resolve => setTimeout(resolve, 3200));
      return response(signed);
    });
    const feed = createBoundStateFeed(item.config);
    const started = Date.now();
    await feed.start();
    while (Date.now() - started < 12_000) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (Date.now() - started < 4500) continue;
      const now = Date.now();
      for (const id of ids) {
        expect(item.applied.some(state => state.bindingId === id && state.stateExpiresAt.getTime() > now)).toBe(true);
      }
    }
    expect(item.received.length).toBeGreaterThanOrEqual(48);
    await feed.close();
  }, 15_000);

  it('keeps healthy leases alive while a few peers respond slowly with errors', async () => {
    const healthy: string[] = Array.from({ length: 20 }, () => randomUUID());
    const bad: string[] = Array.from({ length: 4 }, () => randomUUID());
    const item = await open({
      store: {
        hasState: async () => true,
        listKnownNonRevokedIds: async () => [...bad, ...healthy],
        upsertVerifiedState: async state => { item.applied.push(state); return 'applied'; },
      },
      onError: () => {},
    });
    item.setHandler(async id => {
      if (bad.includes(id)) {
        await new Promise(resolve => setTimeout(resolve, 3800));
        return Response.json({ code: -1, message: 'unavailable' }, { status: 503 });
      }
      const signed = await signState(item.origin, { binding_id: id });
      await new Promise(resolve => setTimeout(resolve, 500));
      return response(signed);
    });
    const feed = createBoundStateFeed(item.config);
    await feed.start();
    await new Promise(resolve => setTimeout(resolve, 6000));
    const now = Date.now();
    for (const id of healthy) {
      expect(item.applied.some(state => state.bindingId === id && state.stateExpiresAt.getTime() > now)).toBe(true);
    }
    expect(item.applied.some(state => bad.includes(state.bindingId))).toBe(false);
    await feed.close();
  }, 9000);

  it('rejects an over-capacity starting set before opening HTTP connections', async () => {
    const ids = Array.from({ length: 33 }, () => randomUUID());
    const failures: string[] = [];
    const item = await open({
      store: {
        hasState: async () => true,
        listKnownNonRevokedIds: async () => ids,
        upsertVerifiedState: async state => { item.applied.push(state); return 'applied'; },
      },
      onError: reason => { failures.push(reason); },
    });
    const feed = createBoundStateFeed(item.config);
    await expect(feed.start()).rejects.toThrow('bound-state-feed-capacity-exceeded');
    expect(item.received).toHaveLength(0);
    await feed.close();
  });

  it('reports dynamic capacity exhaustion and does not queue a new binding', async () => {
    const ids = Array.from({ length: 32 }, () => randomUUID());
    const newcomer = randomUUID();
    const failures: string[] = [];
    const item = await open({
      intervalMs: 25,
      store: {
        hasState: async () => true,
        listKnownNonRevokedIds: async () => ids,
        upsertVerifiedState: async state => { item.applied.push(state); return 'applied'; },
      },
      onError: reason => { failures.push(reason); },
    });
    item.setHandler(async () => Response.json({ code: -1, message: 'unavailable' }, { status: 503 }));
    const feed = createBoundStateFeed(item.config);
    await feed.start();
    ids.push(newcomer);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(failures).toContain('capacity');
    expect(item.received).not.toContain(newcomer);
    await feed.close();
  });

  it('bounds direct refresh concurrency and cancels requests even during signing', async () => {
    const item = await open();
    item.config.fetchFn = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
    });
    const feed = createBoundStateFeed(item.config);
    const operations = Array.from({ length: 32 }, () => feed.refresh(randomUUID()));
    await expect(feed.refresh(randomUUID())).rejects.toThrow('bound-state-feed-capacity-exceeded');
    await feed.close();
    const results = await Promise.allSettled(operations);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(item.applied).toHaveLength(0);
  });

  it('does not apply 404, 503 or oversized responses and stops background polling', async () => {
    const item = await open({ intervalMs: 25 });
    let status = 503;
    item.setHandler(async () => new Response(status === 200 ? 'x'.repeat(20_000) : '{}', { status,
      headers: { 'content-type': 'application/json' } }));
    const feed = createBoundStateFeed(item.config);
    await expect(feed.refresh(bindingId)).rejects.toThrow();
    status = 404;
    await expect(feed.refresh(bindingId)).rejects.toThrow();
    status = 200;
    await expect(feed.refresh(bindingId)).rejects.toThrow();
    await feed.start();
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(item.received.length).toBeGreaterThan(3);
    await feed.close();
    const count = item.received.length;
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(item.received).toHaveLength(count);
  });

  it('fails startup with an invalid reader key or unpinned JWKS', async () => {
    const item = await open();
    expect(() => createBoundStateFeed({ ...item.config, readerPrivatePem: 'wrong' })).toThrow();
    expect(() => createBoundStateFeed({ ...item.config,
      readerPrivatePem: commercial.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    })).toThrow();
    expect(() => createBoundStateFeed({ ...item.config, commercialJwks: { keys: [{ ...publicJwk, d: 'secret' }] } })).toThrow();
    expect(() => createBoundStateFeed({ ...item.config, commercialOrigin: 'http://example.com' })).toThrow();
  });
});
