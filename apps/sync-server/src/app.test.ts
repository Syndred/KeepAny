import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { PostgresSyncService, type SqlPool } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';

const migration = await readFile(new URL('../migrations/001_sync.sql', import.meta.url), 'utf8');
async function fixture() {
  const pg = new PGlite();
  await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({
    query: async (text, values) => pg.query(text, values),
    release: () => {},
  }) };
  return { pg, app: createPostgresSyncApp(new PostgresSyncService(pool), async header =>
    header === 'Bearer alice' ? 'alice' : header === 'Bearer bob' ? 'bob' : null) };
}

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
