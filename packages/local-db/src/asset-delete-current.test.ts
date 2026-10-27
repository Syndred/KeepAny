import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { type Asset, newAsset, historySchema, relationSchema } from '../../domain/src';
import { LocalRepository, openLocalRepository } from './index';

async function fixture(kind: Asset['kind']) {
  const repository = await openLocalRepository(`asset-delete-cas-${crypto.randomUUID()}`);
  const peer = new LocalRepository(repository.records, repository.fileStore);
  const file = await repository.putFile(new File([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGdEAAAAASUVORK5CYII=', 'base64'))], 'synthetic.png', { type: 'image/png' }));
  const asset = { ...newAsset(kind), name: `Original ${kind}`, attachments: [file] };
  const other = { ...newAsset('project'), name: 'Unrelated project' };
  const relation = relationSchema.parse({ id: crypto.randomUUID(), from: asset.id, to: other.id,
    label: 'Preserved connection', createdAt: '2026-10-01T00:00:00.000Z' });
  const history = historySchema.parse({ id: crypto.randomUUID(), assetId: asset.id,
    action: 'maintenance', note: 'Preserved history', createdAt: '2026-10-01T00:00:00.000Z' });
  await repository.saveBatch([{ type: 'asset', value: asset }, { type: 'asset', value: other },
    { type: 'relation', value: relation }, { type: 'history', value: history }]);
  return { repository, peer, asset, relation, history, file };
}

for (const kind of ['project', 'account', 'subscription', 'item'] as const) test(`${kind} rejects a second repository's newer version, then deletes and restores the same ID`, async () => {
  const { repository, peer, asset, relation, history, file } = await fixture(kind);
  try {
    const newer = { ...asset, name: 'Other repository saved', notes: 'Keep the newer note' };
    await peer.saveAssetIfCurrent(asset, newer);
    const before = await repository.allRecords();
    await expect(repository.deleteAssetIfCurrent(asset)).rejects.toThrow('asset-stale');
    expect(await repository.allRecords()).toEqual(before);
    expect(await repository.fileStore.blobs.get(file)).toBeDefined();
    await repository.deleteAssetIfCurrent(newer);
    const deleted = await repository.get<Asset>('asset', asset.id);
    if (!deleted) throw Error('synthetic-tombstone-missing');
    expect({ ...deleted, updatedAt: newer.updatedAt }).toEqual({ ...newer, deleted: true });
    expect(Date.parse(deleted.updatedAt)).toBeGreaterThanOrEqual(Date.parse(newer.updatedAt));
    expect(await repository.get('relation', relation.id)).toEqual(relation);
    expect(await repository.get('history', history.id)).toEqual(history);
    const tombstones = await repository.allRecords();
    await expect(peer.deleteAssetIfCurrent(newer)).rejects.toThrow('asset-stale');
    await expect(peer.deleteAssetIfCurrent(deleted)).rejects.toThrow('asset-stale');
    expect(await repository.allRecords()).toEqual(tombstones);
    await repository.restoreEntity('asset', asset.id);
    const restored = await repository.get<Asset>('asset', asset.id);
    expect({ ...restored, updatedAt: newer.updatedAt }).toEqual({ ...newer, deleted: false });
    expect(await repository.fileStore.blobs.get(file)).toBeDefined();
    // Existing ID-only callers retain their prior tombstone/idempotency contract.
    await repository.deleteEntity('asset', asset.id);
    const legacyDeleted = await repository.allRecords();
    await repository.deleteEntity('asset', asset.id);
    expect(await repository.allRecords()).toEqual(legacyDeleted);
  } finally { await repository.close(); }
});

test('a real second repository save between entry and final asset CAS cannot be deleted', async () => {
  const { repository, peer, asset } = await fixture('project');
  try {
    const originalSave = repository.saveAssetIfCurrent.bind(repository);
    const newer = { ...asset, name: 'Committed during delete', notes: 'No TOCTOU overwrite' };
    const gate = vi.spyOn(repository, 'saveAssetIfCurrent').mockImplementationOnce(async (expected, next) => {
      await peer.saveAssetIfCurrent(asset, newer);
      return originalSave(expected, next);
    });
    await expect(repository.deleteAssetIfCurrent(asset)).rejects.toThrow('asset-stale');
    expect(gate).toHaveBeenCalledOnce();
    expect(await repository.get('asset', asset.id)).toEqual(newer);
  } finally { vi.restoreAllMocks(); await repository.close(); }
});

test('missing attachments fail before mutation and a later valid explicit retry is possible', async () => {
  const { repository, asset, file } = await fixture('project');
  try {
    const stored = await repository.fileStore.blobs.get(file);
    if (!stored) throw Error('synthetic-file-missing');
    await repository.fileStore.blobs.delete(file);
    const before = await repository.allRecords();
    await expect(repository.deleteAssetIfCurrent(asset)).rejects.toThrow('attachment-missing');
    expect(await repository.allRecords()).toEqual(before);
    await repository.fileStore.blobs.put(stored);
    await repository.deleteAssetIfCurrent(asset);
    expect((await repository.get<Asset>('asset', asset.id))?.deleted).toBe(true);
  } finally { await repository.close(); }
});

test('missing and permanently cleared assets are not recreated or rewritten', async () => {
  const repository = await openLocalRepository(`asset-delete-missing-${crypto.randomUUID()}`);
  try {
    const missing = { ...newAsset('project'), name: 'Never stored' };
    await expect(repository.deleteAssetIfCurrent(missing)).rejects.toThrow('asset-stale');
    expect(await repository.allRecords()).toEqual([]);
    await repository.save('asset', missing);
    await repository.deleteAssetIfCurrent(missing);
    await repository.purgeTrash(await repository.previewTrashPurge([{ type: 'asset', id: missing.id }]));
    const cleared = await repository.get<Asset>('asset', missing.id);
    if (!cleared) throw Error('synthetic-purge-marker-missing');
    expect(cleared.purged).toBe(true);
    const before = await repository.allRecords();
    await expect(repository.deleteAssetIfCurrent(cleared)).rejects.toThrow('asset-stale');
    await expect(repository.deleteAssetIfCurrent(missing)).rejects.toThrow('asset-stale');
    expect(await repository.allRecords()).toEqual(before);
  } finally { await repository.close(); }
});
