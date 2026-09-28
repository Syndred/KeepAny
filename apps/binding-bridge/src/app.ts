import { Hono } from 'hono';
import { z } from 'zod';
import { validatedIssuer } from '../../../packages/binding/src/ticket';

const base = '/api/keepany/v1/bindings';
const paths = [
  `${base}/device`, `${base}/poll`, `${base}/refresh`, `${base}/state`,
] as const;
const jwksPath = '/.well-known/jwks.json';
const code = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const bindingId = z.uuid();
const publicKey = z.strictObject({
  kty: z.literal('EC'), crv: z.literal('P-256'), x: code, y: code,
});
const bodies: Record<(typeof paths)[number], z.ZodType> = {
  [`${base}/device`]: z.strictObject({
    instanceId: code,
    instanceName: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(['sync:read', 'sync:write'])).min(1).max(2)
      .refine(v => v.includes('sync:read') && new Set(v).size === v.length),
    devicePublicKey: publicKey,
  }),
  [`${base}/poll`]: z.strictObject({ deviceCode: code }),
  [`${base}/refresh`]: z.strictObject({
    bindingId, refreshToken: code,
    requestId: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/),
  }),
  [`${base}/state`]: z.strictObject({ bindingId, refreshToken: code }),
};

export interface BridgeConfig {
  issuer: string;
  webOrigin: string;
  /** The exact Host header of the loopback listener, including its bound port. */
  expectedHost: () => string;
  fetcher?: typeof fetch;
}

function exactWebOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.search || url.hash ||
    !['https:', 'http:'].includes(url.protocol)) throw Error('binding-bridge-web-origin');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw Error('binding-bridge-web-origin');
  return url.origin;
}

async function limitedText(stream: ReadableStream<Uint8Array> | null, maximum: number): Promise<string> {
  if (!stream) throw Error('body-missing');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw Error('body-too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const envelopeSchema = z.union([
  z.strictObject({ code: z.literal(0), message: z.string().min(1).max(512), data: z.unknown() }),
  z.strictObject({ code: z.literal(-1), message: z.string().min(1).max(512) }),
]);

function envelope(value: unknown): boolean {
  return envelopeSchema.safeParse(value).success;
}

const jwksSchema = z.strictObject({
  keys: z.array(z.strictObject({
    kty: z.literal('RSA'),
    n: z.string().regex(/^[A-Za-z0-9_-]{128,2048}$/),
    e: z.string().regex(/^[A-Za-z0-9_-]{2,16}$/),
    kid: z.string().min(1).max(128),
    alg: z.literal('RS256').optional(),
    use: z.literal('sig').optional(),
  })).min(1).max(16).refine(keys => new Set(keys.map(key => key.kid)).size === keys.length),
});

function publicJwks(value: unknown): boolean {
  return jwksSchema.safeParse(value).success;
}

/** This proxy never accepts a caller-supplied target URL, cookies or auth headers. */
export function createBindingBridgeApp(config: BridgeConfig): Hono {
  const issuer = validatedIssuer(config.issuer).origin;
  const webOrigin = exactWebOrigin(config.webOrigin);
  const fetcher = config.fetcher ?? fetch;
  const app = new Hono();

  app.use('*', async (c, next) => {
    const request = c.req.raw;
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    const expectedHost = config.expectedHost();
    const allowed = origin === webOrigin && host === expectedHost &&
      url.host === expectedHost && url.protocol === 'http:' && !url.search && !url.hash &&
      !request.headers.has('cookie') && !request.headers.has('authorization');
    c.header('Cache-Control', 'no-store');
    if (!allowed) return c.json({ error: 'forbidden' }, 403);
    c.header('Access-Control-Allow-Origin', webOrigin);
    c.header('Vary', 'Origin');
    await next();
  });

  for (const path of paths) {
    app.on('OPTIONS', path, c => {
      const requestedMethod = c.req.header('access-control-request-method');
      const requestedHeaders = (c.req.header('access-control-request-headers') ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const validHeaders = requestedHeaders.length > 0 && requestedHeaders.every(h =>
        h === 'content-type' || (h === 'dpop' && (path.endsWith('/refresh') || path.endsWith('/state'))));
      if (requestedMethod !== 'POST' || !validHeaders) return c.json({ error: 'forbidden' }, 403);
      c.header('Access-Control-Allow-Methods', 'POST');
      c.header('Access-Control-Allow-Headers', requestedHeaders.join(', '));
      c.header('Access-Control-Max-Age', '300');
      return c.body(null, 204);
    });
    app.post(path, async c => {
      const request = c.req.raw;
      const type = request.headers.get('content-type');
      if (!type || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type))
        return c.json({ error: 'unsupported-media-type' }, 415);
      const size = Number(request.headers.get('content-length'));
      if (Number.isFinite(size) && size > 2048) return c.json({ error: 'request-too-large' }, 413);
      const dpop = request.headers.get('dpop');
      const requiresProof = path.endsWith('/refresh') || path.endsWith('/state');
      if (requiresProof ? !dpop || dpop.length > 2048 : !!dpop)
        return c.json({ error: 'invalid-proof' }, 400);
      let body: unknown;
      try { body = JSON.parse(await limitedText(request.body, 2048)); }
      catch (error) { return c.json({ error: error instanceof Error && error.message === 'body-too-large' ? 'request-too-large' : 'invalid-json' }, error instanceof Error && error.message === 'body-too-large' ? 413 : 400); }
      const parsed = bodies[path].safeParse(body);
      if (!parsed.success) return c.json({ error: 'invalid-request' }, 400);
      return relay(path, 'POST', JSON.stringify(parsed.data), dpop);
    });
  }

  app.on('OPTIONS', jwksPath, c => {
    if (c.req.header('access-control-request-method') !== 'GET' || c.req.header('access-control-request-headers'))
      return c.json({ error: 'forbidden' }, 403);
    c.header('Access-Control-Allow-Methods', 'GET');
    c.header('Access-Control-Max-Age', '300');
    return c.body(null, 204);
  });
  app.get(jwksPath, async c => {
    if (c.req.header('dpop')) return c.json({ error: 'invalid-proof' }, 400);
    return relay(jwksPath, 'GET');
  });

  async function relay(path: string, method: 'POST' | 'GET', body?: string, dpop?: string | null): Promise<Response> {
    const responseHeaders = { 'Access-Control-Allow-Origin': webOrigin,
      'Vary': 'Origin', 'Cache-Control': 'no-store' };
    const badUpstream = () => Response.json({ error: 'upstream-response' }, {
      status: 502, headers: responseHeaders,
    });
    let response: Response;
    try {
      response = await fetcher(new URL(path, issuer), {
        method, body, headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(dpop ? { DPoP: dpop } : {}),
        },
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return Response.json({ error: 'upstream-unavailable' }, { status: 502, headers: responseHeaders });
    }
    const retry = response.headers.get('retry-after');
    const safeRetry = retry && /^[1-9][0-9]{0,2}$/.test(retry) && Number(retry) <= 300 ? retry : null;
    const contentType = response.headers.get('content-type') ?? '';
    const limit = path === jwksPath ? 32768 : 65536;
    const declared = Number(response.headers.get('content-length'));
    if (!/^application\/json(?:;|$)/i.test(contentType) ||
      (Number.isFinite(declared) && declared > limit))
      return badUpstream();
    let raw: string;
    let value: unknown;
    try {
      raw = await limitedText(response.body, limit);
      value = JSON.parse(raw);
    } catch {
      return badUpstream();
    }
    if (path === jwksPath ? !publicJwks(value) : !envelope(value))
      return badUpstream();
    const headers = new Headers({ ...responseHeaders, 'Content-Type': 'application/json' });
    if (response.status === 429 && safeRetry) headers.set('Retry-After', safeRetry);
    return new Response(raw, { status: response.status, headers });
  }
  return app;
}
