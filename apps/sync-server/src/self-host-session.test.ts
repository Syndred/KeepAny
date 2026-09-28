import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { expect, it } from 'vitest';
import { AttachmentService, CIPHERTEXT_ATTACHMENT_TYPE } from '../../../packages/sync-core/src/attachments';
import { PostgresSyncService } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';
import { migrateSyncDatabase } from './migrate';
import { createSelfHostSession, sessionPublicOrigin } from './self-host-session';

it('pins the session deployment to one public origin and refuses implicit signup', () => {
  expect(sessionPublicOrigin('https://keepany.example', 'production')).toBe('https://keepany.example');
  expect(sessionPublicOrigin('http://127.0.0.1:8787', 'test')).toBe('http://127.0.0.1:8787');
  expect(() => sessionPublicOrigin('http://keepany.example', 'test')).toThrow('invalid');
  expect(() => sessionPublicOrigin('http://127.0.0.1:8787', 'production')).toThrow('invalid');
  expect(() => sessionPublicOrigin('https://keepany.example/path', 'production')).toThrow('invalid');
  const pool = {} as pg.Pool;
  const base = { KEEPANY_SYNC_AUTH_MODE: 'self-host-session', KEEPANY_SYNC_PUBLIC_ORIGIN: 'http://127.0.0.1:8787',
    BETTER_AUTH_SECRET: 'a'.repeat(48), NODE_ENV: 'test' };
  expect(() => createSelfHostSession(pool, { ...base, KEEPANY_SYNC_TOKEN: 'x'.repeat(32) })).toThrow('not-allowed');
  expect(() => createSelfHostSession(pool, { ...base, KEEPANY_SYNC_WEB_ORIGIN: base.KEEPANY_SYNC_PUBLIC_ORIGIN })).toThrow('not-allowed');
  expect(() => createSelfHostSession(pool, { ...base, KEEPANY_SESSION_ALLOW_SIGNUP: 'yes' })).toThrow('invalid');
});

it.skipIf(!process.env.KEEPANY_TEST_DATABASE_URL)(
  'isolates two Better Auth users, workspaces, records, attachments and memberships over real Hono HTTP and PG', async () => {
    const connectionString = process.env.KEEPANY_TEST_DATABASE_URL;
    if (!connectionString) throw Error('test-database-url');
    const schema = `keepany_session_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString, max: 1 });
    const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
    const reservation = createServer();
    let server: ReturnType<typeof serve> | undefined;
    let created = false;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await migrateSyncDatabase(pool);
      reservation.listen(0, '127.0.0.1');
      await once(reservation, 'listening');
      const reserved = reservation.address();
      if (!reserved || typeof reserved === 'string') throw Error('port-reservation');
      const origin = `http://127.0.0.1:${reserved.port}`;
      await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
      const session = createSelfHostSession(pool, { KEEPANY_SYNC_AUTH_MODE: 'self-host-session',
        KEEPANY_SYNC_PUBLIC_ORIGIN: origin, BETTER_AUTH_SECRET: 'local-test-secret-'.repeat(3),
        KEEPANY_SESSION_ALLOW_SIGNUP: 'true', NODE_ENV: 'test' });
      const disabled = createSelfHostSession(pool, { KEEPANY_SYNC_AUTH_MODE: 'self-host-session',
        KEEPANY_SYNC_PUBLIC_ORIGIN: origin, BETTER_AUTH_SECRET: 'local-test-secret-'.repeat(3), NODE_ENV: 'test' });
      const disabledSignup = await disabled.auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Blocked', email: 'blocked@example.test', password: 'local-test-password-123' }),
      }));
      expect(disabledSignup.status).toBeGreaterThanOrEqual(400);
      const httpsOrigin = 'https://keepany.example';
      const httpsSession = createSelfHostSession(pool, { KEEPANY_SYNC_AUTH_MODE: 'self-host-session',
        KEEPANY_SYNC_PUBLIC_ORIGIN: httpsOrigin, BETTER_AUTH_SECRET: 'local-test-secret-'.repeat(3),
        KEEPANY_SESSION_ALLOW_SIGNUP: 'true', NODE_ENV: 'production' });
      const httpsSignup = await httpsSession.auth.handler(new Request(`${httpsOrigin}/api/auth/sign-up/email`, {
        method: 'POST', headers: { origin: httpsOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'HTTPS Test', email: `https-${crypto.randomUUID()}@example.test`,
          password: 'local-test-password-123' }),
      }));
      expect(httpsSignup.status).toBe(200);
      const httpsCookie = httpsSignup.headers.get('set-cookie');
      expect(httpsCookie).toMatch(/(?:^|;) Secure(?:;|$)/);
      expect(httpsCookie).toMatch(/HttpOnly/);
      expect(httpsCookie).toMatch(/SameSite=Lax/i);
      expect(httpsCookie).not.toMatch(/Domain=/i);
      const blobs = new Map<string, Uint8Array>();
      const attachments = new AttachmentService(pool, {
        put: async (key, bytes) => { blobs.set(key, bytes); },
        get: async key => blobs.get(key) ?? null,
      });
      const app = createPostgresSyncApp(new PostgresSyncService(pool), session.authenticate, attachments,
        { session: { origin, handler: session.auth.handler } });
      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: reserved.port });
      if (!server.listening) await once(server, 'listening');
      const postAuth = (path: string, body: unknown, cookie?: string) => fetch(`${origin}/api/auth/${path}`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      const signup = async (email: string) => {
        const response = await postAuth('sign-up/email', { name: 'Synthetic Test', email, password: 'local-test-password-123' });
        expect(response.status).toBe(200);
        const cookie = response.headers.get('set-cookie');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(cookie).not.toMatch(/Domain=/i);
        expect(cookie).not.toMatch(/Secure/i);
        return cookie?.split(';', 1)[0] ?? '';
      };
      const aliceEmail = `alice-${crypto.randomUUID()}@example.test`;
      const aliceCookie = await signup(aliceEmail);
      const bobCookie = await signup(`bob-${crypto.randomUUID()}@example.test`);
      const foreignAuth = await fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST',
        headers: { origin: 'https://foreign.example', 'content-type': 'application/json' },
        body: JSON.stringify({ email: aliceEmail, password: 'local-test-password-123' }) });
      expect(foreignAuth.status).toBeGreaterThanOrEqual(400);
      expect(foreignAuth.headers.get('access-control-allow-origin')).toBeNull();
      const sync = (path: string, method: 'GET' | 'POST' | 'PUT', cookie: string, accountId?: string,
        body?: unknown, extras: Record<string, string> = {}) => fetch(`${origin}${path}`, {
        method, headers: { cookie, ...(method !== 'GET' ? { origin } : {}),
          ...(accountId ? { 'x-keepany-account-id': accountId } : {}),
          ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...extras },
        body: body instanceof Uint8Array ? Uint8Array.from(body).buffer
          : body === undefined ? undefined : JSON.stringify(body),
      });
      const identity = async (cookie: string) => {
        const response = await sync('/sync/identity', 'POST', cookie);
        expect(response.status).toBe(200);
        const value = await response.json() as { accountId: string };
        expect(value.accountId).toMatch(/^selfhost:/);
        return value.accountId;
      };
      const alice = await identity(aliceCookie);
      const bob = await identity(bobCookie);
      expect(alice).not.toBe(bob);
      expect((await sync('/sync/identity', 'POST', 'better-auth.session_token=wrong')).status).toBe(401);
      expect((await fetch(`${origin}/sync/identity`, { method: 'POST', headers: { cookie: aliceCookie } })).status).toBe(403);
      expect((await fetch(`${origin}/sync/identity`, { method: 'POST', headers: { cookie: aliceCookie,
        origin: 'https://foreign.example' } })).status).toBe(403);
      expect((await fetch(`${origin}/sync/identity`, { method: 'POST', headers: { cookie: aliceCookie,
        origin, authorization: 'Bearer ignored' } })).status).toBe(401);
      expect((await sync('/workspaces', 'GET', aliceCookie)).status).toBe(401);
      expect((await sync('/workspaces', 'POST', aliceCookie, bob)).status).toBe(401);
      const aliceWorkspace = (await (await sync('/workspaces', 'POST', aliceCookie, alice)).json() as { workspaceId: string }).workspaceId;
      const bobWorkspace = (await (await sync('/workspaces', 'POST', bobCookie, bob)).json() as { workspaceId: string }).workspaceId;
      const list = async (cookie: string, accountId: string) => (await (await sync('/workspaces', 'GET', cookie, accountId))
        .json() as { workspaces: Array<{ workspaceId: string; canRead: boolean; canWrite: boolean }> }).workspaces;
      expect(await list(aliceCookie, alice)).toEqual([{ workspaceId: aliceWorkspace, canRead: true, canWrite: true }]);
      expect(await list(bobCookie, bob)).toEqual([{ workspaceId: bobWorkspace, canRead: true, canWrite: true }]);
      const operation = { operationId: crypto.randomUUID(), id: `asset:${crypto.randomUUID()}`, kind: 'asset',
        schemaVersion: 1, expectedVersion: 0, ciphertext: 'opaque-test-ciphertext', tombstone: false, intent: 'write' };
      expect((await sync('/sync/push', 'POST', aliceCookie, alice,
        { workspaceId: aliceWorkspace, operations: [operation] })).status).toBe(200);
      expect((await sync('/sync/pull', 'POST', bobCookie, bob, { workspaceId: aliceWorkspace, cursor: 0 })).status).toBe(403);
      expect((await sync('/sync/preflight', 'POST', bobCookie, bob, { workspaceId: aliceWorkspace })).status).toBe(403);
      const attachmentId = crypto.randomUUID();
      const data = new TextEncoder().encode('opaque-test-image');
      const sha256 = createHash('sha256').update(data).digest('hex');
      const path = `/workspaces/${aliceWorkspace}/attachments/${attachmentId}`;
      expect((await sync(path, 'PUT', aliceCookie, alice, data,
        { 'content-type': CIPHERTEXT_ATTACHMENT_TYPE, 'x-ciphertext-sha256': sha256 })).status).toBe(201);
      expect((await sync(path, 'GET', bobCookie, bob)).status).toBe(403);
      expect((await sync(path, 'GET', aliceCookie, alice)).status).toBe(200);
      await pool.query(`INSERT INTO sync_memberships (workspace_id,subject_id,can_read,can_write)
        VALUES ($1,$2,true,false)`, [aliceWorkspace, bob]);
      expect(await list(bobCookie, bob)).toEqual([
        { workspaceId: bobWorkspace, canRead: true, canWrite: true },
        { workspaceId: aliceWorkspace, canRead: true, canWrite: false },
      ]);
      expect((await sync('/sync/pull', 'POST', bobCookie, bob,
        { workspaceId: aliceWorkspace, cursor: 0 })).status).toBe(200);
      expect((await sync('/sync/push', 'POST', bobCookie, bob,
        { workspaceId: aliceWorkspace, operations: [{ ...operation, operationId: crypto.randomUUID() }] })).status).toBe(403);
      expect((await sync(path, 'PUT', bobCookie, bob, data,
        { 'content-type': CIPHERTEXT_ATTACHMENT_TYPE, 'x-ciphertext-sha256': sha256 })).status).toBe(403);
      await pool.query('UPDATE sync_memberships SET revoked_at=now() WHERE workspace_id=$1 AND subject_id=$2',
        [aliceWorkspace, bob]);
      expect(await list(bobCookie, bob)).toEqual([{ workspaceId: bobWorkspace, canRead: true, canWrite: true }]);
      expect((await sync('/sync/pull', 'POST', bobCookie, bob, { workspaceId: aliceWorkspace, cursor: 0 })).status).toBe(403);
      const logout = await postAuth('sign-out', {}, aliceCookie);
      expect(logout.status).toBe(200);
      expect((await sync('/sync/identity', 'POST', aliceCookie)).status).toBe(401);
      await pool.query('UPDATE "session" SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1', [bob.slice(9)]);
      expect((await sync('/sync/identity', 'POST', bobCookie)).status).toBe(401);
    } finally {
      if (server) await new Promise<void>(resolve => server?.close(() => resolve()));
      if (reservation.listening) await new Promise<void>(resolve => reservation.close(() => resolve()));
      await pool.end();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  }, 45_000);
