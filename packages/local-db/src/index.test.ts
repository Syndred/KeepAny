import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { newAsset, type Asset } from '../../domain/src';
import { inspectArchive, openLocalRepository, type RecordRow } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const project = (label: string): Asset => ({ ...newAsset('project'), name: label });

describe('RxDB + free Dexie local repository', () => {
  it('persists all core entity types and tombstones through an offline reopen', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const asset = project('Offline project');
    const account = { ...newAsset('account'), name: 'Email account' };
    const subscription = { ...newAsset('subscription'), name: 'Hosting', amount: 9900 };
    const item = { ...newAsset('item'), name: 'Laptop' };
    for (const value of [asset, account, subscription, item]) await db.save('asset', value);
    await db.save('relation', { id: crypto.randomUUID(), from: asset.id, to: account.id, label: 'uses', createdAt: new Date().toISOString() });
    await db.save('category', { id: crypto.randomUUID(), kind: 'project', name: 'Work', order: 0 });
    await db.save('task', { id: crypto.randomUUID(), name: 'Renew hosting', assetId: subscription.id, createdAt: new Date().toISOString() });
    await db.deleteEntity('asset', item.id);
    await expect(db.save('asset', item)).rejects.toThrow('tombstone-restore-required');
    await db.close();

    const reopened = await openLocalRepository(dbName);
    expect((await reopened.list<Asset>('asset')).map(value => value.name).sort()).toEqual(['Email account', 'Hosting', 'Offline project']);
    expect(await reopened.list<Asset>('asset', true)).toHaveLength(4);
    expect(await reopened.list('relation')).toHaveLength(1);
    expect(await reopened.list('category')).toHaveLength(1);
    expect(await reopened.list('task')).toHaveLength(1);
    expect((await reopened.get<Asset>('asset', item.id))?.deleted).toBe(true);
    await reopened.restoreEntity('asset', item.id);
    expect(await reopened.list('asset')).toHaveLength(4);
    await reopened.close();
  });

  it('reports same-field conflicts, blocks deletion resurrection and accepts duplicate delivery', async () => {
    const db = await openLocalRepository(name());
    const original = project('First');
    const base = await db.save('asset', original);
    const changed = { ...original, name: 'Second' };
    expect(await db.applyIncoming('asset', changed, base.payload)).toBe('applied');
    expect(await db.applyIncoming('asset', changed, base.payload)).toBe('duplicate');
    expect(await db.applyIncoming('asset', { ...original, name: 'Concurrent' }, base.payload)).toBe('conflict');
    expect((await db.get<Asset>('asset', original.id))?.name).toBe('Second');
    await db.deleteEntity('asset', original.id);
    expect(await db.applyIncoming('asset', original, JSON.stringify(changed))).toBe('conflict');
    expect((await db.get<Asset>('asset', original.id))?.deleted).toBe(true);
    await db.close();
  });

  it('rejects dangling relations and duplicate pending tasks', async () => {
    const db = await openLocalRepository(name());
    const asset = project('Related project');
    await db.save('asset', asset);
    await expect(db.save('asset', { ...asset, attachments: [crypto.randomUUID()] })).rejects.toThrow('attachment-missing');
    await expect(db.save('relation', { id: crypto.randomUUID(), from: asset.id, to: crypto.randomUUID(), label: 'missing', createdAt: new Date().toISOString() })).rejects.toThrow('relation-endpoint');
    const task = { id: crypto.randomUUID(), name: 'Check binding', assetId: asset.id, createdAt: new Date().toISOString(), dedupeKey: `impact:${asset.id}` };
    await db.save('task', task);
    await expect(db.save('task', { ...task, id: crypto.randomUUID() })).rejects.toThrow('task-duplicate');
    await db.save('task', { ...task, done: true, completedAt: new Date().toISOString() });
    await db.save('task', { ...task, id: crypto.randomUUID() });
    await db.close();
  });

  it('validates imports as a batch and rolls back an interrupted partial insert', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const first = project('CSV one');
    const second = project('CSV two');
    await expect(db.saveBatch([
      { type: 'asset', value: first },
      { type: 'asset', value: { ...second, name: '' } },
    ])).rejects.toThrow();
    expect(await db.allRecords()).toHaveLength(0);
    expect(await db.saveBatch([{ type: 'asset', value: first }, { type: 'asset', value: second }])).toBe(2);
    expect(await db.allRecords()).toHaveLength(2);
    await db.close();

    const interruptedName = name();
    const interrupted = await openLocalRepository(interruptedName);
    const row: RecordRow = { id: `asset:${first.id}`, type: 'asset', payload: JSON.stringify(first), updatedAt: Date.now() };
    await interrupted.fileStore.importJournal.put({ id: 'partial-import', rows: [row] });
    await interrupted.db.records.insert(row);
    await interrupted.close();
    const recovered = await openLocalRepository(interruptedName);
    expect(await recovered.allRecords()).toHaveLength(0);
    expect(await recovered.fileStore.importJournal.count()).toBe(0);
    await recovered.close();
  });

  it('exports and restores records, relationships, tombstones and image bytes', async () => {
    const source = await openLocalRepository(name());
    const asset = project('Backup project');
    const account = { ...newAsset('account'), name: 'Backup account' };
    await source.save('asset', asset);
    await source.save('asset', account);
    await source.save('relation', { id: crypto.randomUUID(), from: asset.id, to: account.id, label: 'owns', createdAt: new Date().toISOString() });
    await source.deleteEntity('asset', account.id);
    const fileId = await source.putFile(new File([new Uint8Array([1, 2, 3, 4])], 'test.png', { type: 'image/png' }));
    await source.save('asset', { ...asset, attachments: [fileId] });
    const backup = await source.exportArchive();
    const inspected = await inspectArchive(backup);
    expect(inspected.manifest.recordCount).toBe(3);
    expect(inspected.manifest.attachments).toHaveLength(1);
    await source.close();

    const restored = await openLocalRepository(name());
    expect(await restored.restoreArchive(backup)).toBe(3);
    expect(await restored.allRecords()).toHaveLength(3);
    expect((await restored.get<Asset>('asset', account.id))?.deleted).toBe(true);
    expect(await restored.list('relation')).toHaveLength(1);
    const image = await restored.fileStore.blobs.get(fileId);
    expect(Array.from(new Uint8Array(await image!.blob.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(await restored.fileStore.journal.count()).toBe(0);
    await restored.close();
  });

  it('rejects altered backups and existing conflicting data before writing', async () => {
    const source = await openLocalRepository(name());
    const asset = project('Source');
    await source.save('asset', asset);
    const backup = await source.exportArchive();
    await source.close();
    const entries = unzipSync(backup);
    entries['records.json'] = strToU8('[]');
    await expect(inspectArchive(zipSync(entries))).rejects.toThrow('archive-hash');

    const destination = await openLocalRepository(name());
    await destination.save('asset', { ...asset, name: 'Local edit' });
    await expect(destination.restoreArchive(backup)).rejects.toThrow('restore-conflict');
    expect((await destination.get<Asset>('asset', asset.id))?.name).toBe('Local edit');
    expect(await destination.fileStore.journal.count()).toBe(0);
    await destination.close();
  });

  it('excludes orphan images from backups and collects only files no asset or recovery journal references', async () => {
    const db = await openLocalRepository(name());
    try {
      const shared = await db.putFile(new File([new Uint8Array([1])], 'shared.png', { type: 'image/png' }));
      const orphan = await db.putFile(new File([new Uint8Array([2])], 'orphan.png', { type: 'image/png' }));
      const journalFile = await db.putFile(new File([new Uint8Array([3])], 'journal.png', { type: 'image/png' }));
      const first = { ...project('First'), attachments: [shared] };
      const tombstone = { ...project('In trash'), attachments: [shared] };
      await db.save('asset', first);
      await db.save('asset', tombstone);
      await db.deleteEntity('asset', tombstone.id);
      const pending = { ...project('Restore pending'), attachments: [journalFile] };
      await db.fileStore.journal.put({ id: 'pending-file-reference', rows: [{
        id: `asset:${pending.id}`, type: 'asset', payload: JSON.stringify(pending), updatedAt: Date.now(),
      }] });

      const backup = await inspectArchive(await db.exportArchive());
      expect(backup.manifest.attachments.map(item => item.id)).toEqual([shared]);
      expect(await db.cleanupUnreferencedFile(shared)).toBe(false);
      expect(await db.collectOrphanFiles()).toBe(1);
      expect(await db.fileStore.blobs.get(orphan)).toBeUndefined();
      expect(await db.fileStore.blobs.get(journalFile)).toBeDefined();

      await db.save('asset', { ...first, attachments: [] });
      expect(await db.cleanupUnreferencedFile(shared)).toBe(false); // The tombstone still references it.
      await db.save('asset', { ...tombstone, deleted: true, attachments: [] });
      expect(await db.cleanupUnreferencedFile(shared)).toBe(true);
      await db.fileStore.journal.delete('pending-file-reference');
      expect(await db.collectOrphanFiles()).toBe(1);
      expect((await inspectArchive(await db.exportArchive())).manifest.attachments).toHaveLength(0);
    } finally { await db.close(); }
  });

  it('lets a failed asset write discard its new image without deleting a committed image', async () => {
    const db = await openLocalRepository(name());
    try {
      const abandoned = await db.putFile(new File([new Uint8Array([4])], 'failed.png', { type: 'image/png' }));
      const invalid = { ...project('Valid'), name: '', attachments: [abandoned] };
      await expect(db.save('asset', invalid)).rejects.toThrow();
      expect(await db.cleanupUnreferencedFile(abandoned)).toBe(true);
      expect(await db.fileStore.blobs.get(abandoned)).toBeUndefined();
      const kept = await db.putFile(new File([new Uint8Array([5])], 'kept.png', { type: 'image/png' }));
      await db.save('asset', { ...project('Saved'), attachments: [kept] });
      expect(await db.cleanupUnreferencedFile(kept)).toBe(false);
      expect(await db.fileStore.blobs.get(kept)).toBeDefined();
    } finally { await db.close(); }
  });

  it('replays an interrupted restore journal when the database reopens', async () => {
    const source = await openLocalRepository(name());
    await source.save('asset', project('Journal recovery'));
    await source.save('asset', project('Second journal record'));
    const rows: RecordRow[] = await source.allRecords();
    await source.close();
    const dbName = name();
    const target = await openLocalRepository(dbName);
    await target.db.records.insert(rows[0]); // The first row was written before interruption.
    await target.fileStore.journal.put({ id: 'interrupted', rows });
    await target.close();
    const recovered = await openLocalRepository(dbName);
    expect(await recovered.allRecords()).toHaveLength(2);
    expect(await recovered.fileStore.journal.count()).toBe(0);
    await recovered.close();
  });

  it('advances the pull cursor after all cross-kind rows land and resumes an interrupted page', async () => {
    const dbName = name();
    const asset = project('Pulled project');
    const account = { ...newAsset('account'), name: 'Pulled account' };
    const rows: RecordRow[] = [asset, account].map(value => ({ id: `asset:${value.id}`, type: 'asset', payload: JSON.stringify(value), updatedAt: Date.now() }));
    const relation = { id: crypto.randomUUID(), from: asset.id, to: account.id, label: 'uses', createdAt: new Date().toISOString(), verifiedAt: '', deleted: false };
    rows.push({ id: `relation:${relation.id}`, type: 'relation', payload: JSON.stringify(relation), updatedAt: Date.now() });
    const changes = rows.map((row, index) => ({ row, sequence: index + 1, version: 1 }));
    const db = await openLocalRepository(dbName);
    await db.fileStore.pullJournal.put({ id: 'interrupted-pull', cursorStart: 0, changes });
    await db.db.records.insert(rows[0]); // Crash after the first RxDB write.
    await db.close();
    const recovered = await openLocalRepository(dbName);
    expect(recovered.syncRecoveryError).toBeNull();
    expect(await recovered.syncCursor()).toBe(3);
    expect(await recovered.allRecords()).toHaveLength(3);
    expect(await recovered.fileStore.pullJournal.count()).toBe(0);
    await recovered.close();
  });

  it('keeps local offline edits and the old cursor when a pulled record conflicts', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const asset = project('Initial');
    const initial: RecordRow = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
    expect(await db.applyPulledBatch([{ row: initial, sequence: 1, version: 1 }], 0)).toBe(1);
    await db.save('asset', { ...asset, name: 'Local offline edit' });
    const remote: RecordRow = { ...initial, payload: JSON.stringify({ ...asset, name: 'Remote offline edit' }) };
    await expect(db.applyPulledBatch([{ row: remote, sequence: 2, version: 2 }], 1)).rejects.toThrow('sync-conflict');
    expect(await db.syncCursor()).toBe(1);
    expect((await db.get<Asset>('asset', asset.id))?.name).toBe('Local offline edit');
    expect(await db.fileStore.pullJournal.count()).toBe(1);
    await db.close();
    const reopened = await openLocalRepository(dbName);
    expect(reopened.syncRecoveryError).toBe('sync-conflict');
    expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('Local offline edit');
    expect(await reopened.syncCursor()).toBe(1);
    await reopened.close();
  });
});
