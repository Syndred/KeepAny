import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { newAsset } from '../../domain/src';
import { openLocalRepository, type DatasetBinding, type LocalRepository } from '../../local-db/src';
import { SelfHostAttachmentSync } from './attachment-sync';

afterEach(() => vi.unstubAllGlobals());

const endpoint = 'http://127.0.0.1:3199';
const ciphertextType = 'application/vnd.keepany.ciphertext';
const key = new Uint8Array(32).fill(7);
const photo = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function binding(workspaceId: string): Promise<DatasetBinding> {
  const accountId = 'self-host-owner';
  const hash = await sha256(new TextEncoder().encode(JSON.stringify([endpoint, accountId])));
  return { endpoint, accountId, workspaceId, scope: `${hash}:${workspaceId}` };
}

async function device(owner: DatasetBinding, id: string, name = 'same.png',
  type = 'image/png', bytes = photo): Promise<LocalRepository> {
  const db = await openLocalRepository(`attachment-race-${crypto.randomUUID()}`);
  await db.claimDatasetBinding(owner);
  await db.putSyncedFile({ id, name, type, bytes, sha256: await sha256(bytes) });
  await db.save('asset', { ...newAsset('project'), name: 'Referenced image', attachments: [id] });
  return db;
}

function client(db: LocalRepository, owner: DatasetBinding, token: string): SelfHostAttachmentSync {
  return new SelfHostAttachmentSync(db, owner.scope, endpoint, token, owner.workspaceId, key, 1);
}

function objectServer(options: { simultaneousMissingManifest?: string; pendingManifestConflictOnce?: {
  id: string; token: string;
}; failManifestOnce?: {
  id: string; token: string; afterStore: boolean;
} } = {}) {
  const objects = new Map<string, Uint8Array>();
  let conflicts = 0;
  let initialReads = 0;
  let releaseInitialReads: (() => void) | undefined;
  const initialReadsDone = new Promise<void>(resolve => { releaseInitialReads = resolve; });
  let failed = false;
  let pendingConflictSent = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const id = new URL(url).pathname.split('/').at(-1) ?? '';
    const bearer = (init.headers as Record<string, string>).Authorization;
    if (init.method === 'GET') {
      const stored = objects.get(id);
      if (id === options.simultaneousMissingManifest && initialReads < 2) {
        initialReads += 1;
        if (initialReads === 2) releaseInitialReads?.();
        await initialReadsDone;
      }
      return stored ? new Response(Uint8Array.from(stored).buffer, { status: 200, headers: {
        'content-type': ciphertextType, 'content-length': String(stored.length),
        'x-ciphertext-sha256': await sha256(stored),
      } }) : new Response(null, { status: 404 });
    }
    if (init.method !== 'PUT') throw Error('unexpected-method');
    const bytes = new Uint8Array(init.body as ArrayBuffer);
    if (!pendingConflictSent && options.pendingManifestConflictOnce?.id === id &&
      options.pendingManifestConflictOnce.token === bearer) {
      pendingConflictSent = true;
      conflicts += 1;
      return new Response(null, { status: 409 });
    }
    const previous = objects.get(id);
    if (previous && await sha256(previous) !== await sha256(bytes)) {
      conflicts += 1;
      return new Response(null, { status: 409 });
    }
    const shouldFail = !failed && options.failManifestOnce?.id === id && options.failManifestOnce.token === bearer;
    if (shouldFail && !options.failManifestOnce?.afterStore) {
      failed = true;
      throw Error('offline');
    }
    objects.set(id, Uint8Array.from(bytes));
    if (shouldFail) {
      failed = true;
      throw Error('offline');
    }
    return new Response(JSON.stringify({ sha256: await sha256(bytes), size: bytes.length,
      status: previous ? 'duplicate' : 'stored' }), { status: previous ? 200 : 201 });
  }));
  return { objects, get conflicts() { return conflicts; } };
}

it('accepts only a complete equivalent winner when two devices first upload the same attachment concurrently', async () => {
  const owner = await binding(crypto.randomUUID());
  const id = crypto.randomUUID();
  const server = objectServer({ simultaneousMissingManifest: id });
  const a = await device(owner, id);
  const b = await device(owner, id);
  try {
    await expect(Promise.all([client(a, owner, 'a').ensureUploaded(id),
      client(b, owner, 'b').ensureUploaded(id)])).resolves.toEqual([undefined, undefined]);
    expect(server.conflicts).toBe(1);
    expect(server.objects.has(id)).toBe(true);
    expect([await a.getScopedAttachmentUpload(owner.scope, id),
      await b.getScopedAttachmentUpload(owner.scope, id)].filter(Boolean)).toHaveLength(1);
  } finally {
    await a.close();
    await b.close();
  }
});

it('does not accept a pending 409 without a readable manifest, then converges after another device completes it', async () => {
  const owner = await binding(crypto.randomUUID());
  const id = crypto.randomUUID();
  const server = objectServer({ pendingManifestConflictOnce: { id, token: 'Bearer b' } });
  const a = await device(owner, id);
  const b = await device(owner, id);
  const bName = b.fileStore.name.replace(/-files-v1$/, '');
  try {
    await expect(client(b, owner, 'b').ensureUploaded(id)).rejects.toThrow('sync-attachment-conflict');
    expect(server.objects.has(id)).toBe(false);
    expect(await b.getScopedAttachmentUpload(owner.scope, id)).not.toBeNull();
    await b.close();
    await client(a, owner, 'a').ensureUploaded(id);
    const reopened = await openLocalRepository(bName);
    try {
      await expect(client(reopened, owner, 'b').ensureUploaded(id)).resolves.toBeUndefined();
      expect(await reopened.getScopedAttachmentUpload(owner.scope, id)).toBeNull();
    } finally { await reopened.close(); }
  } finally { await a.close(); }
});

it('reopens a persisted partial plan and adopts an equivalent device winner', async () => {
  const owner = await binding(crypto.randomUUID());
  const id = crypto.randomUUID();
  const server = objectServer({ failManifestOnce: { id, token: 'Bearer b', afterStore: false } });
  const a = await device(owner, id);
  const b = await device(owner, id);
  const bName = b.fileStore.name.replace(/-files-v1$/, '');
  try {
    await expect(client(b, owner, 'b').ensureUploaded(id)).rejects.toThrow('offline');
    expect(server.objects.has(id)).toBe(false);
    expect(await b.getScopedAttachmentUpload(owner.scope, id)).not.toBeNull();
    await b.fileStore.blobs.update(id, { name: 'changed.png' });
    await expect(client(b, owner, 'b').ensureUploaded(id)).rejects.toThrow('sync-attachment-local-changed');
    expect(server.objects.has(id)).toBe(false);
    await b.fileStore.blobs.update(id, { name: 'same.png' });
    await b.close();
    await client(a, owner, 'a').ensureUploaded(id);
    const reopened = await openLocalRepository(bName);
    try {
      await expect(client(reopened, owner, 'b').ensureUploaded(id)).resolves.toBeUndefined();
      expect(await reopened.getScopedAttachmentUpload(owner.scope, id)).toBeNull();
      expect(server.objects.has(id)).toBe(true);
    } finally { await reopened.close(); }
  } finally { await a.close(); }
});

it('keeps a different persisted plan blocked after another device commits the same ID', async () => {
  const owner = await binding(crypto.randomUUID());
  const id = crypto.randomUUID();
  objectServer({ failManifestOnce: { id, token: 'Bearer b', afterStore: false } });
  const a = await device(owner, id);
  const b = await device(owner, id, 'same.png', 'image/png', Uint8Array.from([9, 8, 7]));
  const bName = b.fileStore.name.replace(/-files-v1$/, '');
  try {
    await expect(client(b, owner, 'b').ensureUploaded(id)).rejects.toThrow('offline');
    await b.close();
    await client(a, owner, 'a').ensureUploaded(id);
    const reopened = await openLocalRepository(bName);
    try {
      await expect(client(reopened, owner, 'b').ensureUploaded(id)).rejects.toThrow('sync-attachment-conflict');
      expect(await reopened.getScopedAttachmentUpload(owner.scope, id)).not.toBeNull();
    } finally { await reopened.close(); }
  } finally { await a.close(); }
});

it('recovers a lost manifest acknowledgement using its original persisted ciphertext', async () => {
  const owner = await binding(crypto.randomUUID());
  const id = crypto.randomUUID();
  const server = objectServer({ failManifestOnce: { id, token: 'Bearer a', afterStore: true } });
  const a = await device(owner, id);
  const dbName = a.fileStore.name.replace(/-files-v1$/, '');
  await expect(client(a, owner, 'a').ensureUploaded(id)).rejects.toThrow('offline');
  const original = server.objects.get(id);
  expect(original).toBeDefined();
  await a.close();
  const reopened = await openLocalRepository(dbName);
  try {
    await expect(client(reopened, owner, 'a').ensureUploaded(id)).resolves.toBeUndefined();
    expect(server.objects.get(id)).toEqual(original);
    expect(await reopened.getScopedAttachmentUpload(owner.scope, id)).toBeNull();
  } finally { await reopened.close(); }
});

it('rejects a same-ID winner with changed name, type or content and a manifest with missing chunks', async () => {
  const owner = await binding(crypto.randomUUID());
  const id = crypto.randomUUID();
  const server = objectServer();
  const a = await device(owner, id);
  const renamed = await device(owner, id, 'other.png');
  const retyped = await device(owner, id, 'same.png', 'image/jpeg');
  const changed = await device(owner, id, 'same.png', 'image/png', Uint8Array.from([1, 2, 3]));
  const equal = await device(owner, id);
  try {
    await client(a, owner, 'a').ensureUploaded(id);
    await expect(client(renamed, owner, 'b').ensureUploaded(id)).rejects.toThrow('sync-attachment-conflict');
    await expect(client(retyped, owner, 'c').ensureUploaded(id)).rejects.toThrow('sync-attachment-conflict');
    await expect(client(changed, owner, 'd').ensureUploaded(id)).rejects.toThrow('sync-attachment-conflict');
    const chunks = [...server.objects.keys()].filter(objectId => objectId !== id);
    expect(chunks).toHaveLength(1);
    const saved = server.objects.get(chunks[0]);
    server.objects.delete(chunks[0]);
    await expect(client(equal, owner, 'e').ensureUploaded(id)).rejects.toThrow('sync-attachment-remote-missing');
    if (!saved) throw Error('test-chunk-missing');
    server.objects.set(chunks[0], saved);
    await expect(client(equal, owner, 'e').ensureUploaded(id)).resolves.toBeUndefined();
  } finally {
    await Promise.all([a.close(), renamed.close(), retyped.close(), changed.close(), equal.close()]);
  }
});
