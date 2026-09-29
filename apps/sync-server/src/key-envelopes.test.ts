import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { createRecoveryCredential, generateWorkspaceKey, wrapForRecovery } from '../../../packages/crypto/src';
import { PostgresSyncService, type SqlPool } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';

const migrations = await Promise.all(['001_sync', '008_key_envelopes'].map(id =>
  readFile(new URL(`../migrations/${id}.sql`, import.meta.url), 'utf8')));

async function fixture() {
  const pg = new PGlite();
  for (const migration of migrations) await pg.exec(migration);
  const pool: SqlPool = { connect: async () => ({
    query: async (text, values) => pg.query(text, values), release: () => {},
  }) };
  const app = createPostgresSyncApp(new PostgresSyncService(pool), async authorization =>
    authorization === 'Bearer alice' ? 'alice' : authorization === 'Bearer bob' ? 'bob' : null,
  undefined, { webOrigin: 'http://127.0.0.1:4173' });
  const alice = { authorization: 'Bearer alice', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' };
  const bob = { authorization: 'Bearer bob', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' };
  const created = await app.request('/workspaces', { method: 'POST', headers: alice });
  const { workspaceId } = await created.json() as { workspaceId: string };
  const key = await generateWorkspaceKey();
  const keyFingerprint = createHash('sha256').update(key).digest('hex');
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  return { pg, app, alice, bob, workspaceId, key, keyFingerprint, credential, wrap };
}

it('stores only an opaque immutable recovery wrap, lists metadata, and closes cross-account access', async () => {
  const { pg, app, alice, bob, workspaceId, key, keyFingerprint, credential, wrap } = await fixture();
  try {
    const url = `/workspaces/${workspaceId}/key-envelopes`;
    const body = JSON.stringify({ kind: 'recovery', wrap, keyFingerprint });
    expect((await app.request(url, { method: 'POST', headers: bob, body })).status).toBe(403);
    expect((await app.request(url, { method: 'POST', headers: { origin: alice.origin, 'content-type': 'application/json' }, body })).status).toBe(401);
    expect((await app.request(url, { method: 'POST', headers: { ...alice, origin: 'https://wrong.example' }, body })).status).toBe(403);
    const created = await app.request(url, { method: 'POST', headers: alice, body });
    expect(created.status).toBe(201);
    const metadata = await created.json() as { envelopeId: string; kind: string; keyFingerprint: string; expiresAt: string | null };
    expect(metadata).toMatchObject({ kind: 'recovery', keyEpoch: 1, keyFingerprint, expiresAt: null });
    expect(metadata.envelopeId).toMatch(/^[a-f0-9-]{36}$/);
    expect(await (await app.request(url, { headers: alice })).json()).toEqual({ envelopes: [metadata] });
    expect((await app.request(url, { headers: bob })).status).toBe(403);
    const got = await app.request(`${url}/${metadata.envelopeId}`, { headers: alice });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ ...metadata, wrap });
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect((await app.request(`${url}/${metadata.envelopeId}`, { headers: bob })).status).toBe(403);
    expect((await app.request(url, { method: 'POST', headers: alice, body })).status).toBe(409);
    const stored = await pg.query<{ wrap: unknown; key_fingerprint: string }>(
      'SELECT wrap,key_fingerprint FROM sync_key_envelopes WHERE envelope_id=$1', [metadata.envelopeId]);
    expect(stored.rows[0].wrap).toEqual(wrap);
    expect(stored.rows[0].key_fingerprint).toBe(keyFingerprint);
    expect(JSON.stringify(stored.rows[0])).not.toContain(credential);
    expect(JSON.stringify(stored.rows[0])).not.toContain(Buffer.from(key).toString('base64'));
  } finally { await pg.close(); }
}, 20_000);

it('rejects malformed context, unexpected secrets, wrong fingerprints and duplicate active recovery', async () => {
  const { pg, app, alice, workspaceId, keyFingerprint, wrap } = await fixture();
  try {
    const url = `/workspaces/${workspaceId}/key-envelopes`;
    const post = (input: unknown) => app.request(url, { method: 'POST', headers: alice, body: JSON.stringify(input) });
    expect((await post({ kind: 'recovery', wrap: { ...wrap, workspaceId: crypto.randomUUID() }, keyFingerprint })).status).toBe(400);
    expect((await post({ kind: 'recovery', wrap: { ...wrap, keyEpoch: 2 }, keyFingerprint })).status).toBe(400);
    expect((await post({ kind: 'recovery', wrap, keyFingerprint, credential: 'must-not-be-sent' })).status).toBe(400);
    expect((await post({ kind: 'recovery', wrap, keyFingerprint, expiresInSeconds: 60 })).status).toBe(400);
    expect((await post({ kind: 'join', wrap, keyFingerprint })).status).toBe(400);
    expect((await post({ kind: 'join', wrap, keyFingerprint, expiresInSeconds: 59 })).status).toBe(400);
    expect((await post({ kind: 'join', wrap, keyFingerprint, expiresInSeconds: 901 })).status).toBe(400);
    expect((await post({ kind: 'recovery', wrap, keyFingerprint })).status).toBe(201);
    expect((await post({ kind: 'join', wrap, keyFingerprint: 'a'.repeat(64), expiresInSeconds: 90 })).status).toBe(409);
    await pg.query('UPDATE sync_memberships SET revoked_at=now() WHERE workspace_id=$1 AND subject_id=$2', [workspaceId, 'alice']);
    expect((await app.request(url, { headers: alice })).status).toBe(403);
    expect((await post({ kind: 'join', wrap, keyFingerprint, expiresInSeconds: 90 })).status).toBe(403);
  } finally { await pg.close(); }
}, 20_000);

it('filters expired joins, revokes future reads, and permits recovery recreation only after explicit revoke', async () => {
  const { pg, app, alice, workspaceId, keyFingerprint, wrap } = await fixture();
  try {
    const url = `/workspaces/${workspaceId}/key-envelopes`;
    const post = async (kind: 'recovery' | 'join') => {
      const response = await app.request(url, { method: 'POST', headers: alice, body: JSON.stringify({
        kind, wrap, keyFingerprint, ...(kind === 'join' ? { expiresInSeconds: 60 } : {}),
      }) });
      expect(response.status).toBe(201);
      return response.json() as Promise<{ envelopeId: string; expiresAt: string | null }>;
    };
    const recovery = await post('recovery');
    const join = await post('join');
    expect(join.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await (await app.request(url, { headers: alice })).json() as { envelopes: unknown[] }).envelopes).toHaveLength(2);
    await pg.query('UPDATE sync_key_envelopes SET expires_at=now()-interval \'1 second\' WHERE envelope_id=$1', [join.envelopeId]);
    expect((await app.request(`${url}/${join.envelopeId}`, { headers: alice })).status).toBe(404);
    expect((await (await app.request(url, { headers: alice })).json() as { envelopes: unknown[] }).envelopes).toHaveLength(1);
    expect((await app.request(`${url}/${join.envelopeId}/revoke`, { method: 'POST', headers: alice, body: '{}' })).status).toBe(404);
    expect((await app.request(`${url}/${recovery.envelopeId}/revoke`, { method: 'POST', headers: alice,
      body: JSON.stringify({ credential: 'must-not-be-sent' }) })).status).toBe(400);
    expect((await app.request(`${url}/${recovery.envelopeId}/revoke`, { method: 'POST', headers: alice, body: '{}' })).status).toBe(200);
    expect((await app.request(`${url}/${recovery.envelopeId}`, { headers: alice })).status).toBe(404);
    expect((await app.request(`${url}/${recovery.envelopeId}/revoke`, { method: 'POST', headers: alice, body: '{}' })).status).toBe(404);
    const recreated = await post('recovery');
    expect(recreated.envelopeId).not.toBe(recovery.envelopeId);
    expect((await app.request(`${url}/${crypto.randomUUID()}`, { headers: alice })).status).toBe(404);
  } finally { await pg.close(); }
}, 20_000);
