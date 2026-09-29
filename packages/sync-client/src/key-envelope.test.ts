import { afterEach, expect, it, vi } from 'vitest';
import { createRecoveryCredential, wrapForRecovery } from '../../crypto/src';
import { KeyEnvelopeClient, type BoundSyncAuthorizer } from './index';

afterEach(() => vi.unstubAllGlobals());
const endpoint = 'http://127.0.0.1:3199';
const workspaceId = crypto.randomUUID();
const accountId = 'selfhost:alice';
const key = new Uint8Array(32).fill(7);
const fingerprint = 'ab'.repeat(32);
const createdAt = '2026-09-29T00:00:00.000Z';

it('uses session preflight before publishing, reading, and revoking an opaque recovery wrap', async () => {
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  const envelopeId = crypto.randomUUID();
  let revoked = false;
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/sync/preflight')) return Response.json({ accountId, workspaceId });
    const metadata = { envelopeId, kind: 'recovery', keyEpoch: 1, keyFingerprint: fingerprint,
      expiresAt: null, createdAt };
    if (String(url).endsWith('/key-envelopes') && init.method === 'POST') return Response.json(metadata, { status: 201 });
    if (String(url).endsWith('/key-envelopes') && init.method === 'GET')
      return Response.json({ envelopes: revoked ? [] : [metadata] });
    if (String(url).endsWith(`/${envelopeId}`))
      return revoked ? new Response(null, { status: 404 }) : Response.json({ ...metadata, wrap });
    if (String(url).endsWith(`/${envelopeId}/revoke`)) { revoked = true; return Response.json({ status: 'revoked' }); }
    throw Error('unexpected-route');
  }));

  const client = new KeyEnvelopeClient({ endpoint, workspaceId, sessionAccountId: accountId });
  expect(await client.create({ kind: 'recovery', wrap, keyFingerprint: fingerprint })).toMatchObject({ envelopeId });
  expect(await client.list()).toMatchObject([{ envelopeId, kind: 'recovery' }]);
  expect((await client.get(envelopeId)).wrap).toEqual(wrap);
  await client.revoke(envelopeId);
  await expect(client.get(envelopeId)).rejects.toThrow('sync-http-404');
  expect(calls.map(call => call.url.endsWith('/sync/preflight'))).toEqual([
    true, false, true, false, true, false, true, false, true, false,
  ]);
  expect(calls.every(call => call.init.credentials === 'include' &&
    (call.init.headers as Record<string, string>)['X-KeepAny-Account-Id'] === accountId &&
    !(call.init.headers as Record<string, string>).Authorization)).toBe(true);
  const wire = calls.map(call => String(call.init.body ?? '')).join(' ');
  expect(wire).not.toContain(credential);
  expect(wire).not.toContain(btoa(String.fromCharCode(...key)));
});

it('refuses a changed subject or cross-workspace wrap before any key-envelope request', async () => {
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return Response.json({ accountId: 'selfhost:bob', workspaceId });
  }));
  const client = new KeyEnvelopeClient({ endpoint, workspaceId, sessionAccountId: accountId });
  const input = { kind: 'recovery' as const, wrap, keyFingerprint: fingerprint };
  await expect(client.create(input)).rejects.toThrow('sync-account-mismatch');
  await expect(client.list()).rejects.toThrow('sync-account-mismatch');
  await expect(client.get(crypto.randomUUID())).rejects.toThrow('sync-account-mismatch');
  await expect(client.revoke(crypto.randomUUID())).rejects.toThrow('sync-account-mismatch');
  expect(calls).toHaveLength(4);
  expect(calls.every(url => url.endsWith('/sync/preflight'))).toBe(true);
  await expect(client.create({ ...input, wrap: { ...wrap, workspaceId: crypto.randomUUID() } }))
    .rejects.toThrow('sync-key-envelope-context');
  expect(calls).toHaveLength(4);
});

it('uses a fresh bound proof and fails closed on stale binding or a forged response', async () => {
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  const envelopeId = crypto.randomUUID();
  let active = true;
  let proof = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  const bound: BoundSyncAuthorizer = { accountId: 'keepanyadm:alice',
    assertCurrent: async () => { if (!active) throw Error('binding-stale'); },
    headers: async (method, url) => ({ Authorization: 'DPoP short-token', DPoP: `${++proof}:${method}:${url}` }),
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/sync/preflight'))
      return Response.json({ accountId: bound.accountId, workspaceId });
    return Response.json({ envelopeId, kind: 'join', keyEpoch: 1, keyFingerprint: fingerprint,
      createdAt, expiresAt: '2099-09-29T00:10:00.000Z', wrap: { ...wrap, workspaceId: crypto.randomUUID() } });
  }));
  const client = new KeyEnvelopeClient({ endpoint, workspaceId, bound });
  await expect(client.get(envelopeId)).rejects.toThrow('sync-key-envelope-response');
  expect(calls).toHaveLength(2);
  expect(calls.every((call, index) => call.init.credentials === 'omit' &&
    (call.init.headers as Record<string, string>).DPoP === `${index + 1}:${call.init.method}:${call.url}`)).toBe(true);
  active = false;
  await expect(client.get(envelopeId)).rejects.toThrow('binding-stale');
  expect(calls).toHaveLength(2);
});

it('requires a bounded expiry for short-lived join envelopes', async () => {
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  const client = new KeyEnvelopeClient({ endpoint, workspaceId, token: 't'.repeat(40) });
  vi.stubGlobal('fetch', vi.fn());
  await expect(client.create({ kind: 'join', wrap, keyFingerprint: fingerprint, expiresInSeconds: 59 }))
    .rejects.toThrow('sync-key-envelope-expiry');
  await expect(client.create({ kind: 'join', wrap, keyFingerprint: fingerprint, expiresInSeconds: 901 }))
    .rejects.toThrow('sync-key-envelope-expiry');
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects an expired join wrap even if the server mistakenly returns it', async () => {
  const credential = await createRecoveryCredential();
  const wrap = await wrapForRecovery(key, credential, workspaceId, 1);
  const envelopeId = crypto.randomUUID();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('/sync/preflight')
    ? Response.json({ accountId, workspaceId })
    : Response.json({ envelopeId, kind: 'join', keyEpoch: 1, keyFingerprint: fingerprint,
      createdAt, expiresAt: '2000-01-01T00:00:00.000Z', wrap })));
  const client = new KeyEnvelopeClient({ endpoint, workspaceId, sessionAccountId: accountId });
  await expect(client.get(envelopeId)).rejects.toThrow('sync-key-envelope-expired');
});
