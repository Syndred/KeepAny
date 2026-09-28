import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { createBindingBridgeApp } from './app';

const webOrigin = 'http://127.0.0.1:5173';
const base = '/api/keepany/v1/bindings';
const token = 'a'.repeat(43);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deviceBody = {
  instanceId: token, instanceName: 'Local laptop', scopes: ['sync:read'],
  devicePublicKey: { kty: 'EC', crv: 'P-256', x: token, y: token },
};

async function listen(fetcher: (request: Request) => Response | Promise<Response>) {
  const server = serve({ fetch: fetcher, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('test-listener');
  return { server, origin: `http://127.0.0.1:${address.port}`, host: `127.0.0.1:${address.port}` };
}

async function stop(server: ReturnType<typeof serve>) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function postWithHost(origin: string, host: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${base}/device`, { method: 'POST', headers: {
      Origin: webOrigin, Host: host, 'Content-Type': 'application/json',
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode ?? 0)); });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

async function fixture() {
  const received: { path: string; cookie: string | null; auth: string | null; dpop: string | null; body: unknown }[] = [];
  const commerce = new Hono();
  commerce.post(`${base}/device`, async c => {
    received.push({ path: c.req.path, cookie: c.req.header('cookie') ?? null,
      auth: c.req.header('authorization') ?? null, dpop: c.req.header('dpop') ?? null,
      body: await c.req.json() });
    return c.json({ code: 0, message: 'ok', data: {
      deviceCode: token, userCode: 'ABCDEFGH12', verificationUri: 'http://127.0.0.1/settings/connect',
      expiresIn: 300, interval: 5,
    } });
  });
  commerce.post(`${base}/poll`, async c => {
    received.push({ path: c.req.path, cookie: c.req.header('cookie') ?? null,
      auth: c.req.header('authorization') ?? null, dpop: c.req.header('dpop') ?? null,
      body: await c.req.json() });
    return c.json({ code: -1, message: 'slow_down' }, 429, { 'Retry-After': '9' });
  });
  commerce.post(`${base}/refresh`, async c => {
    received.push({ path: c.req.path, cookie: c.req.header('cookie') ?? null,
      auth: c.req.header('authorization') ?? null, dpop: c.req.header('dpop') ?? null,
      body: await c.req.json() });
    return c.json({ code: 0, message: 'ok', data: { status: 'active' } });
  });
  commerce.post(`${base}/state`, async c => {
    received.push({ path: c.req.path, cookie: c.req.header('cookie') ?? null,
      auth: c.req.header('authorization') ?? null, dpop: c.req.header('dpop') ?? null,
      body: await c.req.json() });
    return c.json({ code: 0, message: 'ok', data: { state: 'active' } });
  });
  commerce.get('/.well-known/jwks.json', c => c.json({ keys: [{ kty: 'RSA', n: 'a'.repeat(342), e: 'AQAB', kid: 'test' }] }));
  const upstream = await listen(commerce.fetch);
  let bridgeHost = '';
  const app = createBindingBridgeApp({ issuer: upstream.origin, webOrigin, expectedHost: () => bridgeHost });
  const bridge = await listen(app.fetch);
  bridgeHost = bridge.host;
  return { received, upstream, bridge };
}

it('relays only fixed binding routes with exact browser origin and no credentials', async () => {
  const { received, upstream, bridge } = await fixture();
  try {
    const request = (path: string, method: string, body?: unknown, headers?: Record<string, string>) =>
      fetch(`${bridge.origin}${path}`, { method, headers: {
        Origin: webOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers,
      }, body: body ? JSON.stringify(body) : undefined });
    const preflight = await request(`${base}/refresh`, 'OPTIONS', undefined, {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,dpop',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(webOrigin);
    expect(preflight.headers.get('access-control-allow-headers')).toBe('content-type, dpop');
    const device = await request(`${base}/device`, 'POST', deviceBody);
    expect(device.status).toBe(200);
    expect(await device.json()).toMatchObject({ code: 0, data: { deviceCode: token } });
    expect(device.headers.get('access-control-allow-origin')).toBe(webOrigin);
    expect(device.headers.get('cache-control')).toBe('no-store');
    const poll = await request(`${base}/poll`, 'POST', { deviceCode: token });
    expect(poll.status).toBe(429);
    expect(poll.headers.get('retry-after')).toBe('9');
    expect(await poll.json()).toMatchObject({ code: -1, message: 'slow_down' });
    const refresh = await request(`${base}/refresh`, 'POST', {
      bindingId: id, refreshToken: token, requestId: 'b'.repeat(22),
    }, { DPoP: 'signed-proof' });
    expect(refresh.status).toBe(200);
    const state = await request(`${base}/state`, 'POST', { bindingId: id, refreshToken: token }, { DPoP: 'other-proof' });
    expect(state.status).toBe(200);
    const keys = await request('/.well-known/jwks.json', 'GET');
    expect(keys.status).toBe(200);
    expect(await keys.json()).toMatchObject({ keys: [{ kid: 'test' }] });
    expect(received.map(v => v.path)).toEqual([
      `${base}/device`, `${base}/poll`, `${base}/refresh`, `${base}/state`,
    ]);
    expect(received.every(v => v.cookie === null && v.auth === null)).toBe(true);
    expect(received[0].dpop).toBeNull();
    expect(received[2].dpop).toBe('signed-proof');
  } finally { await stop(bridge.server); await stop(upstream.server); }
}, 15_000);

it('blocks other origins, hosts, paths, cookies, malformed requests and oversized bodies before upstream', async () => {
  const { received, upstream, bridge } = await fixture();
  try {
    const post = (path: string, body: unknown, headers?: Record<string, string>) =>
      fetch(`${bridge.origin}${path}`, { method: 'POST', headers: {
        Origin: webOrigin, 'Content-Type': 'application/json', ...headers,
      }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    expect((await post(`${base}/device`, deviceBody, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(`${base}/device`, deviceBody, { Origin: '' })).status).toBe(403);
    expect(await postWithHost(bridge.origin, 'evil.example', deviceBody)).toBe(403);
    expect((await post(`${base}/device`, deviceBody, { Cookie: 'session=secret' })).status).toBe(403);
    expect((await post(`${base}/device`, deviceBody, { Authorization: 'Bearer secret' })).status).toBe(403);
    expect((await post(`${base}/device?url=https://evil.example`, deviceBody)).status).toBe(403);
    expect((await post(`${base}/revoke`, deviceBody)).status).toBe(404);
    expect((await post(`${base}/device`, { ...deviceBody, callbackUrl: 'https://evil.example' })).status).toBe(400);
    expect((await post(`${base}/device`, '{invalid')).status).toBe(400);
    expect((await post(`${base}/device`, 'x'.repeat(2049))).status).toBe(413);
    expect((await post(`${base}/refresh`, { bindingId: id, refreshToken: token, requestId: 'b'.repeat(22) })).status).toBe(400);
    expect(received).toHaveLength(0);
  } finally { await stop(bridge.server); await stop(upstream.server); }
}, 15_000);

it('rejects invalid upstream JSON, oversized JWKS and redirects without leaking details', async () => {
  const commerce = new Hono();
  commerce.post(`${base}/device`, c => c.text('private upstream detail', 500));
  commerce.post(`${base}/poll`, c => c.redirect('/.well-known/jwks.json'));
  commerce.get('/.well-known/jwks.json', c => c.json({ keys: [{ kty: 'RSA', n: 'a'.repeat(33000), e: 'AQAB', kid: 'test' }] }));
  const upstream = await listen(commerce.fetch);
  let bridgeHost = '';
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const bridge = await listen(createBindingBridgeApp({ issuer: upstream.origin, webOrigin, expectedHost: () => bridgeHost }).fetch);
  bridgeHost = bridge.host;
  try {
    const result = await fetch(`${bridge.origin}${base}/device`, {
      method: 'POST', headers: { Origin: webOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceBody),
    });
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain('private upstream detail');
    expect((await fetch(`${bridge.origin}/.well-known/jwks.json`, { headers: { Origin: webOrigin } })).status).toBe(502);
    const redirected = await fetch(`${bridge.origin}${base}/poll`, {
      method: 'POST', headers: { Origin: webOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: token }),
    });
    expect(redirected.status).toBe(502);
    expect(logs).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    logs.mockRestore(); errors.mockRestore();
    await stop(bridge.server); await stop(upstream.server);
  }
}, 15_000);
