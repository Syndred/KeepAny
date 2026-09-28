import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository, type DatasetBinding, type RecordRow, type ScopedAttachmentUploadPlan } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
async function binding(): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test';
  const accountId = 'self-host-owner';
  const workspaceId = crypto.randomUUID();
  const hash = await digest(new TextEncoder().encode(JSON.stringify([endpoint, accountId])));
  return { endpoint, accountId, workspaceId, scope: `${hash}:${workspaceId}` };
}
const row = (asset: Asset): RecordRow => ({ id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() });

it('persists one exact ciphertext upload plan through reopen and refuses changed bytes, epoch or scope', async () => {
  const dbName = name();
  const owner = await binding();
  const other = await binding();
  const chunkId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const chunk = Uint8Array.from([1, 2, 3]);
  const manifest = Uint8Array.from([4, 5, 6]);
  const plan: ScopedAttachmentUploadPlan = { scope: owner.scope, attachmentId, sourceSha256: 'b'.repeat(64), keyEpoch: 1,
    objects: [{ id: chunkId, sha256: await digest(chunk), bytes: chunk },
      { id: attachmentId, sha256: await digest(manifest), bytes: manifest }] };
  const db = await openLocalRepository(dbName);
  await expect(db.putScopedAttachmentUpload(plan)).rejects.toThrow('sync-dataset-bound');
  await db.claimDatasetBinding(owner);
  await db.putScopedAttachmentUpload(plan);
  chunk[0] = 99;
  expect((await db.getScopedAttachmentUpload(owner.scope, attachmentId))?.objects[0].bytes).toEqual(Uint8Array.from([1, 2, 3]));
  await db.close();

  const reopened = await openLocalRepository(dbName);
  const persisted = await reopened.getScopedAttachmentUpload(owner.scope, attachmentId);
  if (!persisted) throw Error('test-plan-missing');
  expect(persisted).toEqual({ ...plan, objects: [{ ...plan.objects[0], bytes: Uint8Array.from([1, 2, 3]) }, plan.objects[1]] });
  await reopened.putScopedAttachmentUpload(persisted);
  const changed = Uint8Array.from([9, 2, 3]);
  await expect(reopened.putScopedAttachmentUpload({ ...persisted, objects: [
    { ...persisted.objects[0], bytes: changed, sha256: await digest(changed) }, persisted.objects[1],
  ] })).rejects.toThrow('sync-attachment-plan-conflict');
  await expect(reopened.putScopedAttachmentUpload({ ...persisted, keyEpoch: 2 })).rejects.toThrow('sync-attachment-plan-conflict');
  await expect(reopened.putScopedAttachmentUpload({ ...persisted, objects: [
    { ...persisted.objects[0], bytes: changed }, persisted.objects[1],
  ] })).rejects.toThrow('sync-attachment-plan');
  await expect(reopened.getScopedAttachmentUpload(other.scope, attachmentId)).rejects.toThrow('sync-dataset-bound');
  await expect(reopened.putScopedAttachmentUpload({ ...persisted, scope: other.scope })).rejects.toThrow('sync-dataset-bound');
  expect(await reopened.getScopedAttachmentUpload(owner.scope, attachmentId)).toEqual(persisted);
  await reopened.close();
});

it('stores verified synced images idempotently and refuses same-id content or metadata changes', async () => {
  const db = await openLocalRepository(name());
  const id = crypto.randomUUID();
  const bytes = Uint8Array.from([9, 8, 7]);
  const input = { id, name: 'image.png', type: 'image/png', bytes, sha256: await digest(bytes) };
  await db.putSyncedFile(input);
  await db.putSyncedFile(input);
  expect(await db.readFile(id)).toEqual({ id, name: 'image.png', type: 'image/png', bytes });
  await expect(db.putSyncedFile({ ...input, name: 'renamed.png' })).rejects.toThrow('sync-attachment-conflict');
  const changed = Uint8Array.from([1, 2, 3]);
  await expect(db.putSyncedFile({ ...input, bytes: changed, sha256: await digest(changed) }))
    .rejects.toThrow('sync-attachment-conflict');
  await expect(db.putSyncedFile({ ...input, sha256: '0'.repeat(64) })).rejects.toThrow('sync-attachment-integrity');
  await expect(db.putSyncedFile({ ...input, type: 'text/plain' })).rejects.toThrow('file-type');
  expect((await db.readFile(id))?.bytes).toEqual(bytes);
  await db.close();
});

it('keeps images referenced only by pending scoped outbox and pull journals', async () => {
  const db = await openLocalRepository(name());
  const owner = await binding();
  await db.claimDatasetBinding(owner);
  const outboxFile = await db.putFile(new File([Uint8Array.from([1])], 'outbox.png', { type: 'image/png' }));
  const pullFile = await db.putFile(new File([Uint8Array.from([2])], 'pull.png', { type: 'image/png' }));
  const asset = { ...newAsset('project'), name: 'Pending image', attachments: [outboxFile] };
  const sent = await db.save('asset', asset);
  await db.stageScopedOutbox(owner.scope, sent, { operationId: crypto.randomUUID(), id: sent.id, kind: 'asset',
    schemaVersion: 1, expectedVersion: 0, ciphertext: 'opaque', tombstone: false, intent: 'write' });
  await db.save('asset', { ...asset, attachments: [] });
  const incoming = row({ ...newAsset('project'), name: 'Pulled image', attachments: [pullFile] });
  await db.fileStore.scopedPull.put({ id: owner.scope, scope: owner.scope, cursorStart: 0,
    change: { row: incoming, sequence: 1, version: 1 }, localPayload: null });
  expect(await db.pendingScopedPullRow(owner.scope)).toEqual(incoming);
  expect(await db.cleanupUnreferencedFile(outboxFile)).toBe(false);
  expect(await db.cleanupUnreferencedFile(pullFile)).toBe(false);
  expect(await db.collectOrphanFiles()).toBe(0);
  expect(await db.readFile(outboxFile)).not.toBeNull();
  expect(await db.readFile(pullFile)).not.toBeNull();
  await db.close();
});

it('leaves a missing-photo pull journal and cursor untouched through reopen, then resumes after verified download', async () => {
  const dbName = name();
  const owner = await binding();
  const fileId = crypto.randomUUID();
  const asset = { ...newAsset('project'), name: 'Remote photo', attachments: [fileId] };
  const incoming = row(asset);
  const db = await openLocalRepository(dbName);
  await db.claimDatasetBinding(owner);
  await db.pinScopedKey(owner.scope, 'f'.repeat(64), 1);
  await expect(db.applyScopedPull(owner.scope, { row: incoming, sequence: 1, version: 1 }))
    .rejects.toThrow('attachment-missing');
  expect(await db.scopedCursor(owner.scope)).toBe(0);
  expect(await db.get<Asset>('asset', asset.id)).toBeNull();
  expect(await db.pendingScopedPullRow(owner.scope)).toEqual(incoming);
  await db.close();

  const reopened = await openLocalRepository(dbName);
  expect(reopened.syncRecoveryError).toBe('attachment-missing');
  expect(await reopened.scopedCursor(owner.scope)).toBe(0);
  expect(await reopened.pendingScopedPullRow(owner.scope)).toEqual(incoming);
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  await reopened.putSyncedFile({ id: fileId, name: 'remote.png', type: 'image/png', bytes, sha256: await digest(bytes) });
  expect(await reopened.resumeScopedPull(owner.scope)).toBe('applied');
  expect(await reopened.scopedCursor(owner.scope)).toBe(1);
  expect(await reopened.pendingScopedPullRow(owner.scope)).toBeNull();
  expect((await reopened.get<Asset>('asset', asset.id))?.attachments).toEqual([fileId]);
  await reopened.close();
});
