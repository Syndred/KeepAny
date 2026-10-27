import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { createMobileTlsFetch, MOBILE_MCP_REQUEST_BYTES, MOBILE_MCP_RESPONSE_BYTES } from './mobile-tls-fetch';

// Test-only short-lived X.509 fixtures use Node's signing primitives. Production
// consumes the certificate explicitly paired from the phone, never this issuer.
const der = (tag: number, ...values: Uint8Array[]) => {
  const value = Buffer.concat(values);
  const size = value.length < 128 ? Buffer.from([value.length]) : (() => {
    let n = value.length; const bytes: number[] = [];
    while (n) { bytes.unshift(n & 255); n >>>= 8; }
    return Buffer.from([128 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), size, value]);
};
const sequence = (...values: Uint8Array[]) => der(0x30, ...values);
function certificate(ip = '127.0.0.1') {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = sequence(der(6, Buffer.from('2a8648ce3d040302', 'hex')));
  const name = sequence(der(0x31, sequence(der(6, Buffer.from('550403', 'hex')), der(12, Buffer.from('KeepAny synthetic TLS')))));
  const utc = (date: Date) => der(23, Buffer.from(`${date.toISOString().replace(/\D/g, '').slice(2, 14)}Z`));
  const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] ||= 1;
  const san = sequence(der(6, Buffer.from('551d11', 'hex')), der(4, sequence(der(0x87, Buffer.from(ip.split('.').map(Number))))));
  const constraints = sequence(der(6, Buffer.from('551d13', 'hex')), der(1, Buffer.from([255])), der(4, sequence()));
  const tbs = sequence(der(0xa0, der(2, Buffer.from([2]))), der(2, serial), algorithm, name,
    sequence(utc(new Date(Date.now() - 60_000)), utc(new Date(Date.now() + 3_600_000))), name,
    keys.publicKey.export({ format: 'der', type: 'spki' }), der(0xa3, sequence(san, constraints)));
  const bytes = sequence(tbs, algorithm, der(3, Buffer.from([0]), sign('sha256', tbs, keys.privateKey)));
  const pem = `-----BEGIN CERTIFICATE-----\n${bytes.toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----\n`;
  const x509 = new X509Certificate(pem);
  if (!Number.isFinite(Date.parse(x509.validFrom)) || !Number.isFinite(Date.parse(x509.validTo)) || x509.checkIP(ip) !== ip)
    throw Error('synthetic-certificate-invalid');
  return { pem, key: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    pin: createHash('sha256').update(x509.publicKey.export({ format: 'der', type: 'spki' })).digest('hex') };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void, identity = certificate()) {
  const server = createServer({ key: identity.key, cert: identity.pem }, handler);
  const sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { server, endpoint, identity, sockets };
}
function transport(f: Pick<Fixture, 'endpoint' | 'identity'>, override = {}) {
  const t = createMobileTlsFetch({ endpoint: f.endpoint, certificatePem: f.identity.pem, spkiSha256: f.identity.pin, ...override });
  cleanup.push(() => t.close()); return t;
}
const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
const until = async (predicate: () => boolean) => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('test-condition'); };

describe('connection-local phone HTTPS MCP transport over real TLS sockets', () => {
  it('retains UTF-8 bodies, headers and finite SSE framing through real HTTPS', async () => {
    const seen: { url?: string; auth?: string; body: string }[] = [];
    const f = await fixture((req, res) => { const parts: Buffer[] = []; req.on('data', x => parts.push(x)); req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(parts).toString('utf8') });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.write('event: message\ndata: {"jsonrpc":"2.0",'); res.end('"id":1,"result":{}}\n\n');
    }); });
    const t = transport(f);
    const response = await t.fetch(f.endpoint.replace('/mcp', '/pair'), { method: 'POST', headers: { authorization: 'Bearer synthetic-only' }, body: '普通配对' });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toBe('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
    expect(seen).toEqual([{ url: '/pair', auth: 'Bearer synthetic-only', body: '普通配对' }]);
  });

  it('independently rejects an unrelated CA, wrong IP SAN and wrong leaf SPKI', async () => {
    let requests = 0;
    const f = await fixture((_req, res) => { requests++; res.end('{}'); });
    const other = certificate();
    await expect(transport(f, { certificatePem: other.pem }).fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-network');
    await expect(transport(f, { spkiSha256: '0'.repeat(64) }).fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-network');
    const wrongSan = await fixture((_req, res) => { requests++; res.end('{}'); }, certificate('127.0.0.2'));
    await expect(transport(wrongSan).fetch(wrongSan.endpoint, post)).rejects.toThrow('mobile-mcp-network');
    expect(requests).toBe(0);
    expect(await (await transport(f).fetch(f.endpoint, post)).text()).toBe('{}');
  });

  it('denies public/ambiguous configuration, cross-origin paths, cookies, userinfo and redirects without sending credentials elsewhere', async () => {
    let requests = 0, reachedRedirect = 0;
    const target = await fixture((_req, res) => { reachedRedirect++; res.end('{}'); });
    const f = await fixture((_req, res) => { requests++; res.writeHead(307, { location: target.endpoint }); res.end('secret diagnostic must never become an exception'); });
    const t = transport(f);
    for (const endpoint of ['http://127.0.0.1:1/mcp', 'https://8.8.8.8:1/mcp', 'https://localhost:1/mcp', 'https://127.0.0.2:1/mcp', 'https://127.1:1/mcp'])
      expect(() => createMobileTlsFetch({ endpoint, certificatePem: f.identity.pem, spkiSha256: f.identity.pin })).toThrow('mobile-mcp-config');
    for (const [url, init] of [[target.endpoint, post], [`${f.endpoint}?x=secret`, post], [f.endpoint.replace('/mcp', '/other'), post],
      [f.endpoint.replace('https://', 'https://secret:secret@'), post], [f.endpoint, { ...post, headers: { cookie: 'secret' } }],
      [f.endpoint, { ...post, credentials: 'include' }], [f.endpoint, { method: 'GET' }], [f.endpoint, { ...post, headers: { host: 'wrong.example' } }]] as const)
      await expect(t.fetch(url, init)).rejects.toThrow('mobile-mcp-request');
    expect(requests).toBe(0);
    const error = await t.fetch(f.endpoint, { ...post, headers: { authorization: 'Bearer secret' } }).catch(x => x);
    expect(error.message).toBe('mobile-mcp-response'); expect(error.cause).toBeUndefined();
    expect(requests).toBe(1); expect(reachedRedirect).toBe(0);
  });

  it('preserves Request input auth/signal and rejects pre-abort without touching TLS', async () => {
    let requests = 0, auth = '';
    const f = await fixture((req, res) => { requests++; auth = req.headers.authorization ?? ''; res.end('{}'); });
    const t = transport(f), controller = new AbortController(); controller.abort();
    await expect(t.fetch(new Request(f.endpoint, { ...post, signal: controller.signal }))).rejects.toThrow('mobile-mcp-aborted');
    expect(requests).toBe(0);
    await t.fetch(new Request(f.endpoint, { ...post, headers: { authorization: 'Bearer synthetic' } }));
    expect(auth).toBe('Bearer synthetic');
  });

  it('enforces four in-flight requests and abort/close really end sockets without replay', async () => {
    let requests = 0;
    const f = await fixture(req => { requests++; req.resume(); });
    const t = transport(f), controllers = Array.from({ length: 4 }, () => new AbortController());
    const pending = controllers.map(c => t.fetch(f.endpoint, { ...post, signal: c.signal }).catch(e => e.message));
    await until(() => requests === 4);
    await expect(t.fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-busy');
    controllers[0].abort(); expect(await pending[0]).toBe('mobile-mcp-aborted');
    t.close(); expect(await Promise.all(pending.slice(1))).toEqual(Array(3).fill('mobile-mcp-stopped'));
    await until(() => f.sockets.size === 0); expect(requests).toBe(4);
    await expect(t.fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-stopped');
  });

  it('enforces UTF-8 and exact request/declared/streamed response byte limits', async () => {
    let requests = 0, mode = 'echo';
    const f = await fixture((req, res) => { requests++; const parts: Buffer[] = []; req.on('data', x => parts.push(x)); req.on('end', () => {
      if (mode === 'declared') { res.writeHead(200, { 'content-length': MOBILE_MCP_RESPONSE_BYTES + 1 }); res.flushHeaders(); return; }
      if (mode === 'streamed') { res.writeHead(200, { 'content-type': 'application/json' }); res.write(Buffer.alloc(MOBILE_MCP_RESPONSE_BYTES, 32)); res.end('x'); return; }
      if (mode === 'exact') { res.end(Buffer.alloc(MOBILE_MCP_RESPONSE_BYTES, 32)); return; }
      if (mode === 'invalid') { res.end(Buffer.from([0xc3, 0x28])); return; }
      res.end(String(Buffer.concat(parts).length));
    }); });
    const t = transport(f);
    expect(await (await t.fetch(f.endpoint, { ...post, body: 'x'.repeat(MOBILE_MCP_REQUEST_BYTES) })).text()).toBe(String(MOBILE_MCP_REQUEST_BYTES));
    await expect(t.fetch(f.endpoint, { ...post, body: 'x'.repeat(MOBILE_MCP_REQUEST_BYTES + 1) })).rejects.toThrow('mobile-mcp-request-limit');
    await expect(t.fetch(f.endpoint, { ...post, body: Buffer.from([0xc3, 0x28]) })).rejects.toThrow('mobile-mcp-request');
    expect(requests).toBe(1);
    mode = 'exact'; expect((await (await t.fetch(f.endpoint, post)).arrayBuffer()).byteLength).toBe(MOBILE_MCP_RESPONSE_BYTES);
    mode = 'declared'; await expect(t.fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-response-limit');
    mode = 'streamed'; await expect(t.fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-response-limit');
    mode = 'invalid'; await expect(t.fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-response');
  });

  it('retains the actual production thirty-second deadline and closes the TLS socket', async () => {
    let requests = 0; const f = await fixture(req => { requests++; req.resume(); }); const t = transport(f);
    const start = Date.now(); await expect(t.fetch(f.endpoint, post)).rejects.toThrow('mobile-mcp-timeout');
    const elapsed = Date.now() - start; expect(elapsed).toBeGreaterThanOrEqual(29_500); expect(elapsed).toBeLessThan(33_000);
    await until(() => f.sockets.size === 0); expect(requests).toBe(1);
  }, 35_000);

  it.each(['json', 'sse'] as const)('works with official SDK over actual HTTPS with finite %s responses', async responseMode => {
    const handler = createMcpHandler(() => { const server = new McpServer({ name: 'synthetic-phone', version: '1' });
      server.registerTool('scope_test', { inputSchema: z.object({ operationId: z.string() }) }, ({ operationId }) => ({ content: [{ type: 'text', text: operationId }] })); return server; }, { responseMode });
    cleanup.push(() => handler.close());
    const f = await fixture((req, res) => { const chunks: Buffer[] = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      void handler.fetch(new Request(`https://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined })).then(async response => {
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      }).catch(() => { res.statusCode = 500; res.end(); });
    }); });
    const t = transport(f), client = new Client({ name: 'synthetic-cli', version: '1' });
    cleanup.push(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(f.endpoint), { fetch: t.fetch, requestInit: { headers: { authorization: 'Bearer synthetic-approved-scope' } } }));
    const result = await client.callTool({ name: 'scope_test', arguments: { operationId: 'preserved-operation-123' } });
    expect(result.content).toEqual([{ type: 'text', text: 'preserved-operation-123' }]);
  });
});
