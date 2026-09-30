import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { newAsset, type Asset } from '../../domain/src';
import { inspectArchive, openLocalRepository, type DatasetBinding } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
async function binding(accountId: string): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test';
  const workspaceId = crypto.randomUUID();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([endpoint, accountId]))));
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { endpoint, accountId, workspaceId, scope: `${digest}:${workspaceId}` };
}

async function sourceArchive(owner?: DatasetBinding) {
  const source = await openLocalRepository(name());
  try {
    if (owner) await source.claimDatasetBinding(owner);
    const imageId = await source.putFile(new File([new Uint8Array([1, 2, 3])], 'synthetic.png', { type: 'image/png' }));
    const asset = { ...newAsset('project'), name: 'Source-only project', attachments: [imageId] };
    await source.save('asset', asset);
    return { archive: await source.exportArchive(), asset, imageId };
  } finally { await source.close(); }
}

it.each(['different owner', 'unknown legacy owner'])('refuses ordinary restore from %s before any files or records are written', async (kind) => {
  const source = await sourceArchive(kind === 'different owner' ? await binding('source-account') : undefined);
  const target = await openLocalRepository(name());
  try {
    const owner = await binding('target-account');
    await target.claimDatasetBinding(owner);
    const existing = { ...newAsset('item'), name: 'Keep target record' };
    await target.save('asset', existing);
    const before = await target.allRecords();
    await expect(target.restoreArchive(source.archive)).rejects.toThrow('restore-source-identity');
    expect(await target.allRecords()).toEqual(before);
    expect(await target.readFile(source.imageId)).toBeNull();
    expect(await target.fileStore.journal.count()).toBe(0);
    expect(await target.pendingArchiveMerge()).toBeNull();
    expect(await target.getDatasetBinding()).toEqual(owner);
    expect((await target.dirtyScopedRows(owner.scope)).map(row => row.id)).toEqual([`asset:${existing.id}`]);
  } finally { await target.close(); }
});

it('preserves declared source identity on a clean restore and keeps same-source retries idempotent after reopening', async () => {
  const owner = await binding('source-account');
  const { archive, asset, imageId } = await sourceArchive(owner);
  const dbName = name();
  let target = await openLocalRepository(dbName);
  try {
    expect(await target.restoreArchive(archive)).toBe(1);
    expect(await target.getDatasetBinding()).toEqual(owner);
    expect((await inspectArchive(await target.exportArchive())).manifest.sourceBinding).toEqual(owner);
    await target.close();
    target = await openLocalRepository(dbName);
    expect(await target.restoreArchive(archive)).toBe(1);
    expect(await target.allRecords()).toHaveLength(1);
    expect((await target.get<Asset>('asset', asset.id))?.name).toBe(asset.name);
    expect(await target.readFile(imageId)).not.toBeNull();
    await expect(target.claimDatasetBinding(await binding('other-account'))).rejects.toThrow('sync-dataset-bound');
    expect(await target.getDatasetBinding()).toEqual(owner);
    expect(await target.fileStore.scopedOutbox.count()).toBe(0);
    expect(await target.fileStore.scopedMeta.count()).toBe(0);
  } finally { await target.close(); }
});

it('rolls back the new source identity and images when creating the restore journal fails', async () => {
  const { archive, imageId } = await sourceArchive(await binding('source-account'));
  const target = await openLocalRepository(name());
  try {
    const fault = vi.spyOn(target.fileStore.journal, 'put').mockRejectedValueOnce(Error('synthetic-storage-failure'));
    await expect(target.restoreArchive(archive)).rejects.toThrow('synthetic-storage-failure');
    fault.mockRestore();
    expect(await target.getDatasetBinding()).toBeNull();
    expect(await target.allRecords()).toHaveLength(0);
    expect(await target.readFile(imageId)).toBeNull();
    expect(await target.fileStore.journal.count()).toBe(0);
    expect(await target.restoreArchive(archive)).toBe(1);
  } finally { await target.close(); }
});

it('serializes an identity claim racing with restore instead of sending the restored records to another owner', async () => {
  const owner = await binding('source-account');
  const { archive } = await sourceArchive(owner);
  const target = await openLocalRepository(name());
  try {
    let entered!: () => void;
    const checking = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    const get = target.fileStore.blobs.get.bind(target.fileStore.blobs);
    const pause = vi.spyOn(target.fileStore.blobs, 'get').mockImplementationOnce((...args) => {
      entered(); return Dexie.Promise.resolve(held).then(() => get(...args));
    });
    const restoring = target.restoreArchive(archive);
    await checking;
    const claiming = target.claimDatasetBinding(await binding('racing-account'));
    const result = Promise.allSettled([restoring, claiming]);
    resume();
    expect(await result).toMatchObject([
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new Error('sync-dataset-bound') },
    ]);
    pause.mockRestore();
    expect(await target.getDatasetBinding()).toEqual(owner);
  } finally { await target.close(); }
});

it('replays an interrupted identified restore after reopening with the same pinned owner', async () => {
  const owner = await binding('source-account');
  const { archive, asset } = await sourceArchive(owner);
  const dbName = name();
  const target = await openLocalRepository(dbName);
  const failure = vi.spyOn(target.db.records, 'insert').mockRejectedValueOnce(Error('synthetic-interruption'));
  try {
    await expect(target.restoreArchive(archive)).rejects.toThrow('synthetic-interruption');
    expect(await target.getDatasetBinding()).toEqual(owner);
    expect((await target.fileStore.journal.toArray())[0].sourceBinding).toEqual(owner);
    await expect(target.claimDatasetBinding(owner)).rejects.toThrow('restore-recovery-pending');
  } finally { failure.mockRestore(); await target.close(); }
  const reopened = await openLocalRepository(dbName);
  try {
    expect(reopened.restoreRecoveryError).toBeNull();
    expect(await reopened.getDatasetBinding()).toEqual(owner);
    expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe(asset.name);
    expect(await reopened.fileStore.journal.count()).toBe(0);
  } finally { await reopened.close(); }
});

it('retains an old unproven restore journal for recovery instead of replaying it into a bound target', async () => {
  const dbName = name();
  const target = await openLocalRepository(dbName);
  const owner = await binding('target-account');
  const asset = { ...newAsset('project'), name: 'Unproven legacy source' };
  await target.claimDatasetBinding(owner);
  await target.fileStore.journal.put({ id: 'legacy-interruption', rows: [{
    id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now(),
  }] });
  await target.close();
  const reopened = await openLocalRepository(dbName);
  try {
    expect(reopened.restoreRecoveryError).toBe('restore-source-identity');
    expect(await reopened.getDatasetBinding()).toEqual(owner);
    expect(await reopened.get('asset', asset.id)).toBeNull();
    expect(await reopened.fileStore.journal.count()).toBe(1);
  } finally { await reopened.close(); }
});
