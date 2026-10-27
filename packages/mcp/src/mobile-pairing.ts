import { z } from 'zod';
import { digest, type McpAuthority } from './authority';
import { readableFields, writableFields } from './fields';
import { createKeepAnyMcpHttpHandler, type McpInboundHttp } from './http-handler';
import type { McpAssetStore, PreviewResult } from './service';

const uuid = z.uuid(), stamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const scope = z.strictObject({ assetIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,96}$/)).min(1).max(500),
  readFields: z.array(z.enum(readableFields)).min(1).max(readableFields.length),
  writeFields: z.array(z.enum(writableFields)).max(writableFields.length), ttlMs: z.union([z.literal(300000), z.literal(600000), z.literal(900000)]) })
  .refine(value => [value.assetIds, value.readFields, value.writeFields].every(items => new Set(items).size === items.length) && value.writeFields.every(field => value.readFields.includes(field)));
export type MobileMcpScope = z.infer<typeof scope>;
const certificate = z.string().min(64).max(16384).regex(/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\r?\n?$/);
const endpoint = z.string().max(512).refine(value => {
  try {
    const url = new URL(value), parts = url.hostname.split('.').map(Number);
    const privateIp = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(url.hostname) && parts.every(part => part <= 255) &&
      (url.hostname === '127.0.0.1' || parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
    return privateIp && url.protocol === 'https:' && Boolean(url.port) && url.pathname === '/mcp' && !url.search && !url.hash && !url.username && !url.password && url.href === value;
  } catch { return false; }
});
const fileSchema = z.strictObject({ kind: z.literal('keepany-mcp-mobile-pairing-v1'), instanceId: uuid, endpoint,
  certificatePem: certificate, spkiSha256: z.string().regex(/^[a-f0-9]{64}$/), requestNonce: uuid, pairingSecret: secret,
  createdAt: stamp, expiresAt: stamp, scope }).refine(value => value.expiresAt > value.createdAt && value.expiresAt <= value.createdAt + 120000);
export type MobileMcpPairingFile = z.infer<typeof fileSchema>;
export function readMobileMcpPairingFile(value: unknown, now = Date.now()): MobileMcpPairingFile {
  const result = fileSchema.safeParse(value);
  if (!result.success || result.data.createdAt > now + 5000 || result.data.expiresAt <= now ||
    new TextEncoder().encode(JSON.stringify(result.data)).byteLength > 65536) throw Error('mcp-mobile-pairing-invalid');
  return structuredClone(result.data);
}
const joinSchema = z.strictObject({ kind: z.literal('keepany-mcp-mobile-join-v1'), requestNonce: uuid,
  pairingSecret: secret, clientNonce: uuid, clientName: z.string().min(1).max(80).refine(value => [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)) });
export type MobileMcpJoin = z.infer<typeof joinSchema>;
export type MobileMcpClientRequest = { clientNonce: string; clientName: string; comparisonCode: string; scope: MobileMcpScope };
const randomSecret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function equalHash(left: string, right: string) {
  let different = left.length ^ right.length;
  for (let index = 0; index < 64; index++) different |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return different === 0;
}
export function mobileMcpComparisonCode(file: Pick<MobileMcpPairingFile, 'instanceId' | 'requestNonce' | 'spkiSha256'>, clientNonce: string): string {
  if (!uuid.safeParse(clientNonce).success) throw Error('mcp-mobile-pairing-invalid');
  return digest(JSON.stringify(['keepany-mobile-compare-v1', file.instanceId, file.requestNonce, clientNonce, file.spkiSha256])).slice(0, 8).toUpperCase();
}
export const mobileMcpPairingReplySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending'), comparisonCode: z.string().regex(/^[A-F0-9]{8}$/) }),
  z.strictObject({ state: z.literal('approved'), comparisonCode: z.string().regex(/^[A-F0-9]{8}$/), grantId: uuid,
    grantSecret: secret, expiresAt: stamp, scope }),
]);

/** Trusted phone controller. /pair proposes a client; it cannot approve its own
 * scope or writes. Grant secrets stay in memory/owner-only desktop files. */
export function createMobileMcpPairing(options: {
  endpoint: Pick<MobileMcpPairingFile, 'instanceId' | 'endpoint' | 'certificatePem' | 'spkiSha256'>;
  scope: MobileMcpScope;
  authority: McpAuthority;
  store: McpAssetStore;
  assertAvailable(): void;
  onClient(request: MobileMcpClientRequest): void;
  onAuthorized?(request: MobileMcpClientRequest, expiresAt: number): void;
  onPreview?(grantId: string, preview: PreviewResult): void | Promise<void>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now, createdAt = now();
  const file = readMobileMcpPairingFile({ kind: 'keepany-mcp-mobile-pairing-v1', ...options.endpoint,
    scope: options.scope, createdAt, expiresAt: createdAt + 120000, requestNonce: crypto.randomUUID(), pairingSecret: randomSecret() }, createdAt);
  const ticketHash = digest(`keepany-mobile-pair-v1:${file.pairingSecret}`);
  let closed = false, consumed = false, denied = false, deciding = false;
  let closing: Promise<void> | undefined;
  let client: MobileMcpClientRequest | undefined;
  let issued: Awaited<ReturnType<McpAuthority['issueGrant']>> | undefined;
  let allocatedId: string | undefined;
  const assertActive = () => { if (closed) throw Error('mcp-mobile-stopped'); options.assertAvailable(); };
  const http = createKeepAnyMcpHttpHandler({ endpoint: file.endpoint, authority: options.authority, store: options.store,
    assertAvailable: assertActive, onPreview: options.onPreview });
  const reply = (status: number, value: unknown) => Response.json(value, { status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  const failure = (status: number) => reply(status, { error: 'mcp-mobile-denied' });
  const validTicket = () => { assertActive(); if (now() >= file.expiresAt || consumed || denied) throw Error('mcp-mobile-denied'); };
  return {
    pairingFile: structuredClone(file),
    async fetch(request: Request, inbound: McpInboundHttp): Promise<Response> {
      try {
        assertActive();
        const url = new URL(request.url), expected = new URL(file.endpoint);
        if (url.origin !== expected.origin || inbound.host !== expected.host || request.headers.has('cookie') || request.headers.has('origin') ||
          request.headers.has('host') && request.headers.get('host') !== inbound.host) return failure(403);
        if (request.method !== 'POST') return failure(405);
        if (url.href === file.endpoint) {
          if (!issued || !client || request.headers.get('authorization') !== `Bearer ${issued.id}.${issued.secret}`) return failure(401);
          await options.authority.requireGrant(issued.id, issued.secret); assertActive();
          consumed = true;
          return await http.fetch(request, inbound);
        }
        if (url.href !== new URL('/pair', file.endpoint).href) return failure(404);
        validTicket();
        if (request.signal.aborted || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return failure(400);
        const raw = await request.text(); validTicket();
        if (request.signal.aborted || new TextEncoder().encode(raw).byteLength > 4096) return failure(400);
        let value: unknown; try { value = JSON.parse(raw); } catch { return failure(400); }
        const checked = joinSchema.safeParse(value);
        if (!checked.success || checked.data.requestNonce !== file.requestNonce ||
          !equalHash(digest(`keepany-mobile-pair-v1:${checked.data.pairingSecret}`), ticketHash)) return failure(403);
        const join = checked.data;
        if (client && (join.clientNonce !== client.clientNonce || join.clientName !== client.clientName)) return failure(409);
        if (!client) {
          client = { clientNonce: join.clientNonce, clientName: join.clientName,
            comparisonCode: mobileMcpComparisonCode(file, join.clientNonce), scope: structuredClone(file.scope) };
          try { options.onClient(structuredClone(client)); } catch { denied = true; return failure(503); }
        }
        validTicket();
        if (!issued) return reply(202, { state: 'pending', comparisonCode: client.comparisonCode });
        return reply(200, { state: 'approved', comparisonCode: client.comparisonCode,
          grantId: issued.id, grantSecret: issued.secret, expiresAt: issued.expiresAt, scope: structuredClone(file.scope) });
      } catch { return failure(closed ? 503 : 403); }
    },
    async decideClient(clientNonce: string, approved: boolean): Promise<void> {
      validTicket();
      if (!client || client.clientNonce !== clientNonce || deciding || issued) throw Error('mcp-mobile-decision-invalid');
      if (!approved) { denied = true; return; }
      deciding = true;
      try {
        const rows = await options.store.list(file.scope.assetIds); validTicket();
        if (rows.length !== file.scope.assetIds.length || new Set(rows.map(row => row.asset.id)).size !== file.scope.assetIds.length ||
          rows.some(row => row.asset.deleted || !file.scope.assetIds.includes(row.asset.id))) throw Error('mcp-mobile-scope-invalid');
        const grant = await options.authority.issueGrant(file.scope, id => { allocatedId = id; });
        try { validTicket(); }
        catch { await options.authority.revokeGrant(grant.id); throw Error('mcp-mobile-stopped'); }
        issued = grant;
        try { options.onAuthorized?.(structuredClone(client), grant.expiresAt); }
        catch { denied = true; await options.authority.revokeGrant(grant.id); throw Error('mcp-mobile-stopped'); }
      } finally { deciding = false; }
    },
    get grantId() { return issued?.id; },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true; consumed = true;
      closing = Promise.resolve().then(async () => {
        const closingHttp = http.close();
        try {
          const id = issued?.id ?? allocatedId;
          if (id && (await options.authority.storage.read()).grants.some(grant => grant.id === id)) await options.authority.revokeGrant(id);
        }
        finally { await closingHttp; }
      }).catch(error => { closing = undefined; throw error; });
      return closing;
    },
  };
}
