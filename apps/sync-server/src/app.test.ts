import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { AttachmentService, CIPHERTEXT_ATTACHMENT_TYPE, type CiphertextObjectStore } from '../../../packages/sync-core/src/attachments';
import { PostgresSyncService, type SqlPool } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';

const migrations = await Promise.all(['001_sync', '002_attachments', '003_change_operation_id'].map(id =>
  readFile(new URL(`../migrations/${id}.sql`, import.meta.url), 'utf8')));
async function fixture(webOrigin?: string) {
  const pg = new PGlite();
  for (const migration of migrations) await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({
    query: async (text, values) => pg.query(text, values),
    release: () => {},
  }) };
  const objects = new Map<string, Uint8Array>();
  const store: CiphertextObjectStore = {
    put: async (key, bytes) => { objects.set(key, Uint8Array.from(bytes)); },
    get: async key => objects.get(key) ?? null,
  };
  return { pg, objects, app: createPostgresSyncApp(new PostgresSyncService(pool), async header =>
    header === 'Bearer alice' ? 'alice' : header === 'Bearer bob' ? 'bob' : null,
  new AttachmentService(pool, store), { webOrigin }) };
}

it('permits only the configured self-host Web origin for browser preflight and sync', async () => {
  const webOrigin = 'http://127.0.0.1:4173';
  const { pg, app } = await fixture(webOrigin);
  try {
    const preflight = await app.request('/sync/pull', { method: 'OPTIONS', headers: {
      origin: webOrigin, 'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(webOrigin);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
    const created = await app.request('/workspaces', { method: 'POST',
      headers: { origin: webOrigin, authorization: 'Bearer alice' } });
    expect(created.status).toBe(201);
    expect(created.headers.get('access-control-allow-origin')).toBe(webOrigin);
    const other = await app.request('/workspaces', { method: 'POST',
      headers: { origin: 'https://untrusted.example', authorization: 'Bearer alice' } });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(() => createPostgresSyncApp(new PostgresSyncService({} as SqlPool), async () => null,
      undefined, { webOrigin: 'https://untrusted.example/path' })).toThrow('sync-web-origin');
  } finally { await pg.close(); }
}, 20_000);

it('serves authenticated workspace creation, push and pull', async () => {
  const { pg, app } = await fixture();
  try {
    const headers = { authorization: 'Bearer alice', 'content-type': 'application/json' };
    const workspaceResponse = await app.request('/workspaces', { method: 'POST', headers });
    expect(workspaceResponse.status).toBe(201);
    const { workspaceId } = await workspaceResponse.json() as { workspaceId: string };
    const change = {
      operationId: crypto.randomUUID(), id: `asset:${crypto.randomUUID()}`, kind: 'asset', schemaVersion: 1,
      expectedVersion: 0, ciphertext: 'opaque-ciphertext', tombstone: false,
    };
    const push = await app.request('/sync/push', { method: 'POST', headers,
      body: JSON.stringify({ workspaceId, operations: [change] }) });
    expect(push.status).toBe(200);
    expect(await push.json()).toMatchObject({ results: [{ status: 'accepted', version: 1, sequence: 1 }] });
    const pull = await app.request('/sync/pull', { method: 'POST', headers,
      body: JSON.stringify({ workspaceId, cursor: 0, limit: 1 }) });
    expect(pull.status).toBe(200);
    expect(await pull.json()).toMatchObject({ changes: [{ id: change.id, ciphertext: change.ciphertext }], nextCursor: 1 });
    expect(pull.headers.get('cache-control')).toBe('no-store');
  } finally { await pg.close(); }
}, 20_000);

it('serves only authorized ciphertext attachment upload and verified readback', async () => {
  const { pg, app, objects } = await fixture();
  try {
    const workspaceResponse = await app.request('/workspaces', { method: 'POST',
      headers: { authorization: 'Bearer alice' } });
    const { workspaceId } = await workspaceResponse.json() as { workspaceId: string };
    const attachmentId = crypto.randomUUID();
    const url = `/workspaces/${workspaceId}/attachments/${attachmentId}`;
    const bytes = Buffer.from([5, 25, 99, 201]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const headers = { authorization: 'Bearer alice', 'content-type': CIPHERTEXT_ATTACHMENT_TYPE,
      'x-ciphertext-sha256': sha256 };
    expect((await app.request(url, { method: 'PUT', body: bytes, headers: { ...headers, 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await app.request(url, { method: 'PUT', body: bytes,
      headers: { ...headers, 'x-ciphertext-sha256': '0'.repeat(64) } })).status).toBe(400);
    expect((await app.request(url, { method: 'PUT', body: Buffer.alloc(4 * 1024 * 1024 + 1), headers })).status).toBe(413);
    expect((await app.request(url, { method: 'PUT', body: bytes, headers: { ...headers, authorization: 'Bearer bob' } })).status).toBe(403);
    const uploaded = await app.request(url, { method: 'PUT', body: bytes, headers });
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toMatchObject({ status: 'stored', sha256 });
    expect((await app.request(url, { method: 'PUT', body: bytes, headers })).status).toBe(200);
    expect((await app.request(url, { headers: { authorization: 'Bearer bob' } })).status).toBe(403);
    const downloaded = await app.request(url, { headers: { authorization: 'Bearer alice' } });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe(CIPHERTEXT_ATTACHMENT_TYPE);
    expect(downloaded.headers.get('x-ciphertext-sha256')).toBe(sha256);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    objects.set(`${workspaceId}/${attachmentId}`, Uint8Array.from([0, 0, 0, 0]));
    expect((await app.request(url, { headers: { authorization: 'Bearer alice' } })).status).toBe(502);
  } finally { await pg.close(); }
}, 20_000);

it('returns 401/403 across the HTTP workspace boundary and limits body size', async () => {
  const { pg, app } = await fixture();
  try {
    const workspaceResponse = await app.request('/workspaces', { method: 'POST', headers: { authorization: 'Bearer bob' } });
    const { workspaceId } = await workspaceResponse.json() as { workspaceId: string };
    const body = JSON.stringify({ workspaceId, cursor: 0 });
    const response = await app.request('/sync/pull', { method: 'POST', body,
      headers: { authorization: 'Bearer alice', 'content-type': 'application/json' } });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('forbidden');
    expect((await app.request('/sync/pull', { method: 'POST', body,
      headers: { 'content-type': 'application/json' } })).status).toBe(401);
    const oversized = await app.request('/sync/push', { method: 'POST', body: 'x'.repeat(4 * 1024 * 1024 + 1),
      headers: { authorization: 'Bearer alice', 'content-type': 'application/json' } });
    expect(oversized.status).toBe(413);
  } finally { await pg.close(); }
}, 20_000);
