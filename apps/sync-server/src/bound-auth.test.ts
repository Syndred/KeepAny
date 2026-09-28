import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Pool } from 'pg';
import { expect, it } from 'vitest';
import { PostgresSyncService, type SqlPool } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp, type Authenticate } from './app';
import { createBoundTokenAuthenticator } from './bound-auth';
import { createPostgresBoundStateStore } from './bound-state';

const issuer = 'https://billing.keepany.test';
const bindingId = 'f2d56513-d5fb-4616-8980-a4dcb6e83e8b';
const subject = 'keepanyadm:billing-user-1';
const instanceIdHash = 'a'.repeat(64);

it('rejects missing, arbitrary or private-key trust configuration before serving', () => {
  const publicKey = { kty: 'RSA', n: 'a'.repeat(342), e: 'AQAB', kid: 'key-1', alg: 'RS256', use: 'sig' };
  const stateStore = { claimProof: async () => false, pruneExpiredProofs: async () => {} };
  const valid = { issuer, publicOrigin: 'https://sync.keepany.test', jwks: { keys: [publicKey] }, stateStore };
  expect(() => createBoundTokenAuthenticator({ ...valid, issuer: 'https://attacker.test/path' })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, issuer: 'http://attacker.test' })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, jwks: { keys: [] } })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, jwks: { keys: [{ ...publicKey, d: 'private' }] } })).toThrow();
  expect(() => createBoundTokenAuthenticator({ ...valid, stateStore: undefined as never })).toThrow('bound-state-store-configuration');
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
  const migrations = await Promise.all(['001_sync', '002_attachments', '003_change_operation_id', '004_bound_state', '005_bound_state_guard'].map(id =>
    readFile(new URL(`../migrations/${id}.sql`, import.meta.url), 'utf8')));
  for (const migration of migrations) await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({ query: async (sql, values) => pg.query(sql, values), release: () => {} }) };
  const stateStore = createPostgresBoundStateStore(pg as unknown as Pick<Pool, 'query'>);
  const service = new PostgresSyncService(pool);
  let authenticate: Authenticate = async () => null;
  const server = serve({ fetch: createPostgresSyncApp(service, (authorization, request) => authenticate(authorization, request)).fetch,
    hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('test-address');
  const origin = `http://127.0.0.1:${address.port}`;
  const boundConfig = {
    issuer, publicOrigin: origin,
    jwks: { keys: [{ kty: 'RSA', n: rsaJwk.n, e: rsaJwk.e, kid: 'key-1', alg: 'RS256', use: 'sig' }] },
    stateStore,
  };
  authenticate = createBoundTokenAuthenticator(boundConfig);
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
    expect((await post('/workspaces', valid)).status).toBe(401);
    await pg.query(`INSERT INTO sync_bound_bindings
      (binding_id, subject, instance_id_hash, jkt, scopes, status, epoch, token_valid_after, state_observed_at, state_expires_at)
      VALUES ($1, $2, $3, $4, ARRAY['sync:read', 'sync:write'], 'active', 1, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '15 seconds')`,
    [bindingId, subject, instanceIdHash, jkt, now() - 5]);
    expect(await stateStore.claimProof({ bindingId, subject, instanceIdHash, jkt, scope: 'sync:write',
      tokenIssuedAt: now(), proofIssuedAt: now(), proofJti: createHash('sha256').update(crypto.randomUUID()).digest('base64url') })).toBe(true);
    const sharedJti = createHash('sha256').update(crypto.randomUUID()).digest('base64url');
    const sharedClaim = { bindingId, subject, instanceIdHash, jkt, scope: 'sync:read' as const,
      tokenIssuedAt: now(), proofIssuedAt: now(), proofJti: sharedJti };
    const secondStore = createPostgresBoundStateStore(pg as unknown as Pick<Pool, 'query'>);
    expect((await Promise.all([stateStore.claimProof(sharedClaim), secondStore.claimProof(sharedClaim)])).sort()).toEqual([false, true]);
    const workspace = await post('/workspaces', valid);
    expect(workspace.status).toBe(201);
    const { workspaceId } = await workspace.json() as { workspaceId: string };
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 } })).status).toBe(200);
    const readOnly = await access({ scope: 'sync:read' });
    expect((await post('/sync/pull', readOnly, { body: { workspaceId, cursor: 0 } })).status).toBe(200);
    expect((await post('/sync/push', readOnly, { body: { workspaceId, operations: [] } })).status).toBe(401);
    const replayJti = createHash('sha256').update(crypto.randomUUID()).digest('base64url');
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 }, jti: replayJti })).status).toBe(200);
    authenticate = createBoundTokenAuthenticator({ ...boundConfig, stateStore: createPostgresBoundStateStore(pg as unknown as Pick<Pool, 'query'>) });
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 }, jti: replayJti })).status).toBe(401);
    authenticate = createBoundTokenAuthenticator({ ...boundConfig, stateStore: {
      claimProof: async () => { throw Error('database-unavailable'); }, pruneExpiredProofs: async () => {},
    } });
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 } })).status).toBe(401);
    authenticate = createBoundTokenAuthenticator(boundConfig);

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
    const scopeCutoff = now();
    await pg.query("UPDATE sync_bound_bindings SET scopes = ARRAY['sync:read']::text[], epoch = 2, token_valid_after = $1 WHERE binding_id = $2", [scopeCutoff, bindingId]);
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 } })).status).toBe(401);
    const afterScope = await access({}, { issuedAt: scopeCutoff + 1, expiresAt: now() + 60 });
    expect((await post('/workspaces', afterScope)).status).toBe(401);
    expect((await post('/sync/pull', afterScope, { body: { workspaceId, cursor: 0 } })).status).toBe(200);
    await pg.query("UPDATE sync_bound_bindings SET status = 'revoked', epoch = 3, token_valid_after = $1 WHERE binding_id = $2", [scopeCutoff + 1, bindingId]);
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 } })).status).toBe(401);
    await pg.query(`UPDATE sync_bound_bindings SET status = 'active', epoch = 4,
      token_valid_after = $2, state_observed_at = CURRENT_TIMESTAMP,
      state_expires_at = CURRENT_TIMESTAMP + INTERVAL '15 seconds'
      WHERE binding_id = $1`, [bindingId, scopeCutoff + 2]);
    expect((await post('/sync/pull', valid, { body: { workspaceId, cursor: 0 } })).status).toBe(401);
    const afterEpoch = await access({}, { issuedAt: scopeCutoff + 3, expiresAt: now() + 60 });
    expect((await post('/sync/pull', afterEpoch, { body: { workspaceId, cursor: 0 } })).status).toBe(200);
    await pg.query("UPDATE sync_bound_bindings SET state_expires_at = state_observed_at + INTERVAL '16 seconds' WHERE binding_id = $1", [bindingId]);
    expect((await post('/sync/pull', afterEpoch, { body: { workspaceId, cursor: 0 } })).status).toBe(401);
    expect((await fetch(`${origin}/workspaces`, { method: 'POST', headers: { authorization: `Bearer ${valid}` } })).status).toBe(401);
    expect((await fetch(`${origin}/workspaces`, { method: 'POST', headers: { authorization: `DPoP ${valid}` } })).status).toBe(401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pg.close();
  }
}, 30_000);
