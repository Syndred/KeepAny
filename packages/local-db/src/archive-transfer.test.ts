import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { inspectArchive, openLocalRepository, type DatasetBinding, type RecordRow } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
async function binding(): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test';
  const accountId = 'archive-transfer-owner';
  const workspaceId = crypto.randomUUID();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([endpoint, accountId]))));
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { endpoint, accountId, workspaceId, scope: `${digest}:${workspaceId}` };
}

it('merges selected conflicts, tombstones, relationships, history and images, then rolls back before sync', async () => {
  const source = await openLocalRepository(name());
  const sourceAsset: Asset = { ...newAsset('project'), name: 'Source project' };
  const linked = { ...newAsset('item'), name: 'Deleted item' };
  const imageId = await source.putFile(new File([new Uint8Array([1, 2, 3])], 'front.png', { type: 'image/png' }));
  await source.save('asset', { ...sourceAsset, attachments: [imageId] });
  await source.save('asset', linked);
  const relationId = crypto.randomUUID();
  await source.save('relation', { id: relationId, from: sourceAsset.id, to: linked.id,
    label: 'contains', createdAt: new Date().toISOString() });
  await source.save('history', { id: crypto.randomUUID(), assetId: linked.id,
    action: 'maintenance', note: 'Repaired', createdAt: new Date().toISOString() });
  await source.deleteEntity('asset', linked.id);
  const archive = await source.exportArchive();
  await source.close();

  const targetName = name();
  const target = await openLocalRepository(targetName);
  const owner = await binding();
  await target.claimDatasetBinding(owner);
  const local = { ...sourceAsset, name: 'Target edit' };
  await target.save('asset', local);
  const targetOnly = { ...newAsset('account'), name: 'Target only' };
  await target.save('asset', targetOnly);
  const preview = await target.previewArchiveMerge(archive);
  expect(preview.rows.find(row => row.id === `asset:${sourceAsset.id}`)).toMatchObject({
    status: 'conflict', sourcePayload: expect.stringContaining('Source project'),
    targetPayload: expect.stringContaining('Target edit'),
  });
  expect(preview.rows.filter(row => row.status === 'new')).toHaveLength(3);
  await expect(target.applyArchiveMerge(archive, {}, preview.targetFingerprint)).rejects.toThrow('archive-merge-choice');
  expect(await target.applyArchiveMerge(archive, { [`asset:${sourceAsset.id}`]: 'source' }, preview.targetFingerprint))
    .toEqual({ imported: 3, replaced: 1, skipped: 0 });
  expect((await target.get<Asset>('asset', sourceAsset.id))?.name).toBe('Source project');
  expect((await target.get<Asset>('asset', linked.id))?.deleted).toBe(true);
  expect(await target.list('relation', true)).toHaveLength(1);
  expect(await target.list('history')).toHaveLength(1);
  expect((await target.readFile(imageId))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(await target.getDatasetBinding()).toEqual(owner);
  expect(await target.pendingArchiveMerge()).toMatchObject({ phase: 'applied', changedRows: 4, addedFiles: 1 });
  await expect(target.dirtyScopedRows(owner.scope)).rejects.toThrow('archive-merge-sync-paused');
  await target.close();
  const reopened = await openLocalRepository(targetName);
  expect(await reopened.pendingArchiveMerge()).toMatchObject({ phase: 'applied' });
  await reopened.rollbackArchiveMerge();
  expect((await reopened.get<Asset>('asset', sourceAsset.id))?.name).toBe('Target edit');
  expect(await reopened.get<Asset>('asset', targetOnly.id)).toMatchObject({ name: 'Target only' });
  expect(await reopened.get<Asset>('asset', linked.id)).toBeNull();
  expect(await reopened.readFile(imageId)).toBeNull();
  expect(await reopened.pendingArchiveMerge()).toBeNull();
  expect(await reopened.getDatasetBinding()).toEqual(owner);
  await reopened.close();
});

it('keeps the target choice, rejects stale previews and same-ID image collisions', async () => {
  const source = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Source' };
  const imageId = await source.putFile(new File([new Uint8Array([4])], 'photo.png', { type: 'image/png' }));
  await source.save('asset', { ...asset, attachments: [imageId] });
  const archive = await source.exportArchive();
  await source.close();

  const target = await openLocalRepository(name());
  await target.claimDatasetBinding(await binding());
  await target.save('asset', { ...asset, name: 'Target' });
  const preview = await target.previewArchiveMerge(archive);
  await target.save('asset', { ...asset, name: 'Newer target' });
  await expect(target.applyArchiveMerge(archive, { [`asset:${asset.id}`]: 'source' }, preview.targetFingerprint))
    .rejects.toThrow('archive-merge-stale');
  const fresh = await target.previewArchiveMerge(archive);
  await target.fileStore.blobs.add({ id: imageId, name: 'photo.png', blob: new Blob([new Uint8Array([9])], { type: 'image/png' }) });
  await expect(target.applyArchiveMerge(archive, { [`asset:${asset.id}`]: 'target' }, fresh.targetFingerprint))
    .rejects.toThrow('archive-merge-stale');
  const withFile = await target.previewArchiveMerge(archive);
  await expect(target.applyArchiveMerge(archive, { [`asset:${asset.id}`]: 'target' }, withFile.targetFingerprint))
    .rejects.toThrow('archive-merge-image-conflict');
  await target.fileStore.blobs.delete(imageId);
  const finalPreview = await target.previewArchiveMerge(archive);
  expect(await target.applyArchiveMerge(archive, { [`asset:${asset.id}`]: 'target' }, finalPreview.targetFingerprint))
    .toEqual({ imported: 0, replaced: 0, skipped: 1 });
  expect((await target.get<Asset>('asset', asset.id))?.name).toBe('Newer target');
  expect(await target.readFile(imageId)).toBeNull();
  await target.finalizeArchiveMerge();
  await expect(target.rollbackArchiveMerge()).rejects.toThrow('archive-merge-sync-started');
  await target.completeArchiveMerge();
  expect(await target.pendingArchiveMerge()).toBeNull();
  await target.close();
});

it('recovers an interrupted row write on reopen and refuses rollback over a later edit', async () => {
  const source = await openLocalRepository(name());
  const first = { ...newAsset('project'), name: 'First' };
  const second = { ...newAsset('project'), name: 'Second' };
  await source.save('asset', first);
  await source.save('asset', second);
  const archive = await source.exportArchive();
  await source.close();
  const dbName = name();
  const target = await openLocalRepository(dbName);
  await target.claimDatasetBinding(await binding());
  const preview = await target.previewArchiveMerge(archive);
  const storage = target.db.records.storageInstance;
  const original = storage.bulkWrite.bind(storage);
  let calls = 0;
  const spy = vi.spyOn(storage, 'bulkWrite').mockImplementation((rows, context) => {
    calls++;
    if (calls === 2) throw Error('storage-interrupted');
    return original(rows, context);
  });
  await expect(target.applyArchiveMerge(archive, {}, preview.targetFingerprint)).rejects.toThrow('storage-interrupted');
  spy.mockRestore();
  expect(await target.pendingArchiveMerge()).toBeNull();
  expect(await target.allRecords()).toHaveLength(0);
  await target.close();

  const reopened = await openLocalRepository(dbName);
  const again = await reopened.previewArchiveMerge(archive);
  await reopened.applyArchiveMerge(archive, {}, again.targetFingerprint);
  await reopened.save('asset', { ...first, name: 'Edited after merge' });
  await expect(reopened.rollbackArchiveMerge()).rejects.toThrow('archive-merge-rollback-conflict');
  expect(await reopened.pendingArchiveMerge()).toMatchObject({ phase: 'applied' });
  expect((await reopened.get<Asset>('asset', first.id))?.name).toBe('Edited after merge');
  await reopened.close();
});

it('reverts an applying journal on a fresh repository open', async () => {
  const dbName = name();
  const target = await openLocalRepository(dbName);
  const asset = { ...newAsset('project'), name: 'Partial import' };
  const imageId = await target.putFile(new File([new Uint8Array([7])], 'partial.png', { type: 'image/png' }));
  const after: RecordRow = await target.save('asset', { ...asset, attachments: [imageId] });
  await target.fileStore.archiveMerge.add({ id: 'active', phase: 'applying', archiveHash: 'a'.repeat(64),
    targetFingerprint: 'b'.repeat(64), changes: [{ before: null, after }],
    addedFileIds: [imageId], insertedFileIds: [imageId] });
  await target.close();
  const reopened = await openLocalRepository(dbName);
  expect(await reopened.pendingArchiveMerge()).toBeNull();
  expect(await reopened.get('asset', asset.id)).toBeNull();
  expect(await reopened.readFile(imageId)).toBeNull();
  await reopened.close();
});

it('exports a validated optional source identity without breaking older archives', async () => {
  const source = await openLocalRepository(name());
  const legacy = await source.exportArchive();
  expect((await inspectArchive(legacy)).manifest.sourceBinding).toBeUndefined();
  const owner = await binding();
  await source.claimDatasetBinding(owner);
  const identified = await source.exportArchive();
  expect((await inspectArchive(identified)).manifest.sourceBinding).toEqual(owner);
  await source.close();
});

it('skips identical rows and refuses an unbound target', async () => {
  const source = await openLocalRepository(name());
  const asset = { ...newAsset('project'), name: 'Shared' };
  await source.save('asset', asset);
  const archive = await source.exportArchive();
  await source.close();
  const target = await openLocalRepository(name());
  await target.save('asset', asset);
  const preview = await target.previewArchiveMerge(archive);
  expect(preview.rows).toMatchObject([{ status: 'same' }]);
  await expect(target.applyArchiveMerge(archive, {}, preview.targetFingerprint)).rejects.toThrow('archive-merge-unbound');
  await target.claimDatasetBinding(await binding());
  expect(await target.applyArchiveMerge(archive, {}, preview.targetFingerprint))
    .toEqual({ imported: 0, replaced: 0, skipped: 1 });
  await target.rollbackArchiveMerge();
  expect((await target.get<Asset>('asset', asset.id))?.name).toBe('Shared');
  await target.close();
});

it('removes the first imported image when the second image import is interrupted', async () => {
  const source = await openLocalRepository(name());
  const ids = [
    await source.putFile(new File([new Uint8Array([1])], 'one.png', { type: 'image/png' })),
    await source.putFile(new File([new Uint8Array([2])], 'two.png', { type: 'image/png' })),
  ];
  await source.save('asset', { ...newAsset('project'), attachments: ids });
  const archive = await source.exportArchive();
  await source.close();
  const target = await openLocalRepository(name());
  await target.claimDatasetBinding(await binding());
  const preview = await target.previewArchiveMerge(archive);
  const original = target.fileStore.blobs.add.bind(target.fileStore.blobs);
  let calls = 0;
  const spy = vi.spyOn(target.fileStore.blobs, 'add').mockImplementation((...args) => {
    calls++;
    if (calls === 2) throw Error('image-interrupted');
    return original(...args);
  });
  await expect(target.applyArchiveMerge(archive, {}, preview.targetFingerprint)).rejects.toThrow('image-interrupted');
  spy.mockRestore();
  expect(await target.pendingArchiveMerge()).toBeNull();
  expect(await target.allRecords()).toHaveLength(0);
  for (const id of ids) expect(await target.readFile(id)).toBeNull();
  await target.close();
});
