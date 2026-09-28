import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { PostgresSyncService, type SqlPool } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp, type Authenticate } from './app';
import { createBoundTokenAuthenticator } from './bound-auth';

const issuer = 'https://billing.keepany.test';
const bindingId = 'f2d56513-d5fb-4616-8980-a4dcb6e83e8b';
const subject = 'keepanyadm:billing-user-1';
const instanceIdHash = 'a'.repeat(64);

it('rejects missing, arbitrary or private-key trust configuration before serving', () => {
  const binding = { bindingId, subject, instanceIdHash, jkt: 'a'.repeat(43), scopes: ['sync:read'] };
  const publicKey = { kty: 'RSA', n: 'a'.repeat(342), e: 'AQAB', kid: 'key-1', alg: 'RS256', use: 'sig' };
  const valid = { issuer, publicOrigin: 'https://sync.keepany.test', jwks: { keys: [publicKey] }, bindings: [binding] };
  expect(() => createBoundTokenAuthenticator({ ...valid, issuer: 'https://attacker.test/path' })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, issuer: 'http://attacker.test' })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, jwks: { keys: [] } })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, jwks: { keys: [{ ...publicKey, d: 'private' }] } })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, bindings: [] })).toThrow();
});

it('accepts only pinned bound JWT and device DPoP across real Hono HTTP routes', async () => {
  const rsa = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const otherRsa = await generateKeyPair('RS256', { modulusLength: 2048 });
  const ec = await generateKeyPair('ES256', { extractable: true });
  const otherEc = await generateKeyPair('ES256', { extractable: true });
  const rsaJwk = await exportJWK(rsa.publicKey);
  const ecJwk = await exportJWK(ec.publicKey);
  const otherEcJwk = await exportJWK(otherEc.publicKey);
  if (!ecJwk.x || !ecJwk.y || !otherEcJwk.x || !otherEcJwk.y) throw Error('device-key-fixture');
  const jkt = await calculateJwkThumbprint(ecJwk, 'sha256');
  const publicDeviceJwk = { kty: 'EC' as const, crv: 'P-256' as const, x: ecJwk.x, y: ecJwk.y };
  const otherDeviceJwk = { kty: 'EC' as const, crv: 'P-256' as const, x: otherEcJwk.x, y: otherEcJwk.y };
  const pg = new PGlite();
  const migrations = await Promise.all(['001_sync', '002_attachments'].map(id =>
    readFile(new URL(`../migrations/${id}.sql`, import.meta.url), 'utf8')));
  for (const migration of migrations) await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({ query: async (sql, values) => pg.query(sql, values), release: () => {} }) };
  const service = new PostgresSyncService(pool);
  let authenticate: Authenticate = async () => null;
  const server = serve({ fetch: createPostgresSyncApp(service, (authorization, request) => authenticate(authorization, request)).fetch,
    hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('test-address');
  const origin = `http://127.0.0.1:${address.port}`;
  authenticate = createBoundTokenAuthenticator({
    issuer, publicOrigin: origin,
    jwks: { keys: [{ kty: 'RSA', n: rsaJwk.n, e: rsaJwk.e, kid: 'key-1', alg: 'RS256', use: 'sig' }] },
    bindings: [{ bindingId, subject, instanceIdHash, jkt, scopes: ['sync:read', 'sync:write'] }],
  });
  const now = () => Math.floor(Date.now() / 1000);
  const access = (claims: Record<string, unknown> = {}, options: { issuer?: string; audience?: string; subject?: string; issuedAt?: number; expiresAt?: number } = {}) => {
    const iat = options.issuedAt ?? now();
    return new SignJWT({ scope: 'sync:read sync:write', binding_id: bindingId, instance_id_hash: instanceIdHash,
      cnf: { jkt }, ...claims })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'key-1' })
      .setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? 'keepany-sync-bound')
      .setSubject(options.subject ?? subject).setJti(crypto.randomUUID()).setIssuedAt(iat)
      .setExpirationTime(options.expiresAt ?? iat + 60).sign(rsa.privateKey);
  };
  const proof = (token: string, path: string, options: { method?: string; htu?: string; ath?: string; key?: typeof ec.privateKey; jwk?: typeof publicDeviceJwk; jti?: string; iat?: number } = {}) =>
    new SignJWT({ htm: options.method ?? 'POST', htu: options.htu ?? `${origin}${path}`,
      ath: options.ath ?? createHash('sha256').update(token).digest('base64url') })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: options.jwk ?? publicDeviceJwk })
      .setJti(options.jti ?? createHash('sha256').update(crypto.randomUUID()).digest('base64url'))
      .setIssuedAt(options.iat ?? now()).sign(options.key ?? ec.privateKey);
  const post = async (path: string, token: string, options: Parameters<typeof proof>[2] & { origin?: string; body?: unknown } = {}) =>
    fetch(`${origin}${path}`, { method: 'POST', headers: { authorization: `DPoP ${token}`,
      dpop: await proof(token, path, options), 'content-type': 'application/json',
      ...(options.origin ? { origin: options.origin } : {}) }, body: JSON.stringify(options.body ?? {}) });
  try {
    const valid = await access();
    const workspace = await post('/workspaces', valid);
    expect(workspace.status).toBe(201);
    const { workspaceId } = await workspace.json() as { workspaceId: string };
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 } })).status).toBe(200);
    const readOnly = await access({ scope: 'sync:read' });
    expect((await post('/sync/pull', readOnly, { body: { workspaceId, cursor: 0 } })).status).toBe(200);
    expect((await post('/sync/push', readOnly, { body: { workspaceId, operations: [] } })).status).toBe(401);
    const replayJti = createHash('sha256').update(crypto.randomUUID()).digest('base64url');
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 }, jti: replayJti })).status).toBe(200);
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 }, jti: replayJti })).status).toBe(401);

    const denied = async (token: string, options: Parameters<typeof post>[2] = {}) =>
      expect((await post('/workspaces', token, options)).status).toBe(401);
    await denied(readOnly);
    await denied(await access({ binding_id: crypto.randomUUID() }));
    await denied(await access({ instance_id_hash: 'b'.repeat(64) }));
    await denied(await access({ cnf: { jkt: 'b'.repeat(43) } }));
    await denied(await access({}, { issuer: 'https://attacker.test' }));
    await denied(await new SignJWT({ scope: 'sync:read sync:write', binding_id: bindingId, instance_id_hash: instanceIdHash, cnf: { jkt } })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'key-1' })
      .setIssuer(issuer).setAudience('keepany-sync-bound').setSubject(subject)
      .setJti(crypto.randomUUID()).setIssuedAt(now()).setExpirationTime(now() + 60).sign(otherRsa.privateKey));
    await denied(await access({}, { audience: 'keepany-sync' }));
    await denied(await access({}, { subject: 'keepanyadm:other-user' }));
    await denied(await access({}, { issuedAt: now() - 120, expiresAt: now() - 60 }));
    await denied(await access({}, { expiresAt: now() + 120 }));
    await denied(valid, { origin: 'https://attacker.test' });
    await denied(valid, { method: 'GET' });
    await denied(valid, { htu: `${origin}/sync/pull` });
    await denied(valid, { ath: 'a'.repeat(43) });
    await denied(valid, { key: otherEc.privateKey, jwk: otherDeviceJwk });
    await denied(valid, { iat: now() - 120 });
    expect((await fetch(`${origin}/workspaces`, { method: 'POST', headers: { authorization: `Bearer ${valid}` } })).status).toBe(401);
    expect((await fetch(`${origin}/workspaces`, { method: 'POST', headers: { authorization: `DPoP ${valid}` } })).status).toBe(401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pg.close();
  }
}, 30_000);
