import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { newAsset, type Asset } from '../../domain/src';
import { inspectArchive, openLocalRepository, type RecordRow } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const project = (label: string): Asset => ({ ...newAsset('project'), name: label });
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const changedArchive = async (backup: Uint8Array, edit: (entries: Record<string, Uint8Array>, manifest: Record<string, unknown>, rows: RecordRow[]) => void) => {
  const entries = unzipSync(backup);
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as Record<string, unknown>;
  const rows = JSON.parse(strFromU8(entries['records.json'])) as RecordRow[];
  edit(entries, manifest, rows);
  entries['records.json'] = strToU8(JSON.stringify(rows));
  manifest.recordCount = rows.length;
  manifest.recordsHash = await hash(entries['records.json']);
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
};

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

  it('deletes and restores one directed relation without changing another relation to the same asset', async () => {
    const db = await openLocalRepository(name());
    const projectAsset = project('Relation owner');
    const account = { ...newAsset('account'), name: 'Related account' };
    await db.save('asset', projectAsset);
    await db.save('asset', account);
    const createdAt = '2026-09-29T01:00:00.000Z';
    const verifiedAt = '2026-09-29T02:00:00.000Z';
    const first = { id: crypto.randomUUID(), from: projectAsset.id, to: account.id, label: 'signs in with',
      source: 'Account settings', createdAt, verifiedAt };
    const second = { ...first, id: crypto.randomUUID(), label: 'pays for', source: 'Billing settings' };
    const reverse = { ...first, id: crypto.randomUUID(), from: account.id, to: projectAsset.id, label: 'manages' };
    for (const relation of [first, second, reverse]) await db.save('relation', relation);

    const deleted = await db.deleteEntity('relation', first.id);
    expect(JSON.parse(deleted.payload)).toMatchObject({ ...first, deleted: true });
    expect(await db.deleteEntity('relation', first.id)).toEqual(deleted);
    expect((await db.list<{ id: string }>('relation')).map(value => value.id).sort()).toEqual([second.id, reverse.id].sort());
    expect(await db.list('asset')).toHaveLength(2);
    await expect(db.save('relation', first)).rejects.toThrow('tombstone-restore-required');

    const restored = await db.restoreEntity('relation', first.id);
    expect(JSON.parse(restored.payload)).toMatchObject({ ...first, deleted: false });
    expect((await db.list<{ id: string }>('relation')).map(value => value.id).sort()).toEqual([first.id, second.id, reverse.id].sort());
    await expect(db.restoreEntity('relation', first.id)).rejects.toThrow('not-in-trash');
    await db.close();
  });

  it('refuses relation restoration when an endpoint is deleted or missing, and keeps its tombstone', async () => {
    const db = await openLocalRepository(name());
    const projectAsset = project('Relation source');
    const account = { ...newAsset('account'), name: 'Relation target' };
    await db.save('asset', projectAsset);
    await db.save('asset', account);
    const relation = { id: crypto.randomUUID(), from: projectAsset.id, to: account.id, label: 'uses',
      source: 'Profile page', createdAt: '2026-09-29T01:00:00.000Z', verifiedAt: '2026-09-29T02:00:00.000Z' };
    await db.save('relation', relation);
    await db.deleteEntity('relation', relation.id);
    await db.deleteEntity('asset', account.id);
    await expect(db.restoreEntity('relation', relation.id)).rejects.toThrow('relation-endpoint');
    expect((await db.get<{ deleted: boolean }>('relation', relation.id))?.deleted).toBe(true);
    expect((await db.get<Asset>('asset', account.id))?.deleted).toBe(true);
    await db.restoreEntity('asset', account.id);
    await db.restoreEntity('relation', relation.id);
    expect((await db.get<{ deleted: boolean }>('relation', relation.id))?.deleted).toBe(false);

    const missing = { ...relation, id: crypto.randomUUID(), to: crypto.randomUUID(), deleted: true };
    await db.save('relation', missing);
    await expect(db.restoreEntity('relation', missing.id)).rejects.toThrow('relation-endpoint');
    expect((await db.get<{ deleted: boolean }>('relation', missing.id))?.deleted).toBe(true);
    await db.close();
  });

  it('rechecks relation endpoints at the final restore write and keeps legacy source absent', async () => {
    const db = await openLocalRepository(name());
    const projectAsset = project('Legacy source');
    const account = { ...newAsset('account'), name: 'Legacy target' };
    await db.save('asset', projectAsset);
    await db.save('asset', account);
    const legacy = { id: crypto.randomUUID(), from: projectAsset.id, to: account.id,
      label: 'legacy link', createdAt: '2026-09-29T01:00:00.000Z' };
    await db.save('relation', legacy);
    await db.deleteEntity('relation', legacy.id);
    let targetLookups = 0;
    const originalGet = db.get.bind(db);
    const getSpy = vi.spyOn(db, 'get').mockImplementation(async (type, id) => {
      // Simulate the endpoint disappearing after the preliminary check.
      if (type === 'asset' && id === account.id && ++targetLookups === 2) return null;
      return originalGet(type, id);
    });
    await expect(db.restoreEntity('relation', legacy.id)).rejects.toThrow('relation-endpoint');
    getSpy.mockRestore();
    expect(targetLookups).toBe(2);
    const tombstone = await db.get<{ deleted: boolean; source?: string }>('relation', legacy.id);
    expect(tombstone?.deleted).toBe(true);
    expect(Object.hasOwn(tombstone ?? {}, 'source')).toBe(false);
    const restored = await db.restoreEntity('relation', legacy.id);
    expect(Object.hasOwn(JSON.parse(restored.payload), 'source')).toBe(false);
    const archive = await inspectArchive(await db.exportArchive());
    const legacyRow = archive.rows.find(row => row.id === `relation:${legacy.id}`);
    expect(Object.hasOwn(JSON.parse(legacyRow?.payload ?? '{}'), 'source')).toBe(false);
    await db.close();
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
    if (!image) throw Error('restored-image-missing');
    expect(Array.from(new Uint8Array(await image.blob.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    expect(await restored.fileStore.journal.count()).toBe(0);
    await restored.close();
  });

  it('round trips completed history, submission ledger, relation tombstones and exact multiple images, then imports again', async () => {
    const source = await openLocalRepository(name());
    const asset = project('Full backup');
    const linked = { ...newAsset('item'), name: 'Camera' };
    const imageInputs = [
      { name: 'front.png', type: 'image/png', bytes: new Uint8Array([0, 1, 2, 255]) },
      { name: 'back.webp', type: 'image/webp', bytes: new Uint8Array([9, 8, 7, 6]) },
    ];
    const imageIds: string[] = [];
    try {
      for (const image of imageInputs) imageIds.push(await source.putFile(new File([image.bytes], image.name, { type: image.type })));
      await source.save('asset', { ...asset, attachments: imageIds });
      await source.save('asset', linked);
      const relationId = crypto.randomUUID();
      await source.save('relation', { id: relationId, from: asset.id, to: linked.id, label: 'contains', createdAt: new Date().toISOString() });
      await source.deleteEntity('relation', relationId);
      await source.save('task', { id: crypto.randomUUID(), name: 'Service camera', assetId: linked.id,
        done: true, completedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
      await source.save('history', { id: crypto.randomUUID(), assetId: linked.id, action: 'maintenance',
        note: 'Cleaned sensor', createdAt: new Date().toISOString() });
      await source.save('submission', { id: crypto.randomUUID(), assetId: asset.id, name: 'Directory',
        url: 'https://example.com/listing', status: 'submitted', submittedAt: new Date().toISOString() });
      await source.deleteEntity('asset', linked.id);
      const backup = await source.exportArchive();
      const sourceRows = await source.allRecords();
      const target = await openLocalRepository(name());
      try {
        expect(await target.restoreArchive(backup)).toBe(sourceRows.length);
        expect(await target.restoreArchive(backup)).toBe(sourceRows.length);
        expect((await target.allRecords()).map(row => [row.id, row.payload]).sort()).toEqual(
          sourceRows.map(row => [row.id, row.payload]).sort());
        expect((await target.get<Asset>('asset', linked.id))?.deleted).toBe(true);
        expect(await target.list('relation')).toHaveLength(0);
        expect(await target.list('relation', true)).toHaveLength(1);
        expect(await target.list('history')).toHaveLength(1);
        expect(await target.list('submission')).toHaveLength(1);
        expect(await target.list('task')).toHaveLength(1);
        for (const [index, id] of imageIds.entries()) {
          const file = await target.readFile(id);
          expect(file).toEqual({ id, ...imageInputs[index] });
          if (!file) throw Error('restored-image-missing');
          expect(await hash(file.bytes)).toBe(await hash(imageInputs[index].bytes));
        }
        expect(await target.fileStore.journal.count()).toBe(0);
      } finally { await target.close(); }
    } finally { await source.close(); }
  });

  it('rejects a same-ID image with changed name, MIME or bytes without changing local data', async () => {
    const source = await openLocalRepository(name());
    const asset = project('Image source');
    const fileId = await source.putFile(new File([new Uint8Array([1, 2, 3])], 'original.png', { type: 'image/png' }));
    await source.save('asset', { ...asset, attachments: [fileId] });
    const backup = await source.exportArchive();
    await source.close();
    for (const change of [
      { name: 'renamed.png', type: 'image/png', bytes: [1, 2, 3] },
      { name: 'original.png', type: 'image/webp', bytes: [1, 2, 3] },
      { name: 'original.png', type: 'image/png', bytes: [3, 2, 1] },
    ]) {
      const target = await openLocalRepository(name());
      try {
        await target.fileStore.blobs.add({ id: fileId, name: change.name,
          blob: new Blob([new Uint8Array(change.bytes)], { type: change.type }) });
        await expect(target.restoreArchive(backup)).rejects.toThrow('restore-conflict');
        expect(await target.allRecords()).toHaveLength(0);
        expect(await target.fileStore.journal.count()).toBe(0);
        expect(await target.readFile(fileId)).toEqual({ id: fileId, name: change.name,
          type: change.type, bytes: new Uint8Array(change.bytes) });
      } finally { await target.close(); }
    }
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

  it('rejects tampered, missing, duplicate, dangling and unsupported archives before any local write', async () => {
    const source = await openLocalRepository(name());
    const asset = project('Archive base');
    const fileId = await source.putFile(new File([new Uint8Array([1, 2, 3])], 'source.png', { type: 'image/png' }));
    await source.save('asset', { ...asset, attachments: [fileId] });
    const backup = await source.exportArchive();
    await source.close();
    const danglingId = crypto.randomUUID();
    const row = (type: RecordRow['type'], value: Record<string, unknown>): RecordRow => ({
      id: `${type}:${value.id}`, type, payload: JSON.stringify(value), updatedAt: Date.now(),
    });
    const cases: Array<[string, Uint8Array, string]> = [
      ['tampered image', await changedArchive(backup, entries => { entries[`files/${fileId}`] = new Uint8Array([9, 9, 9]); }), 'archive-hash'],
      ['missing image', await changedArchive(backup, entries => { delete entries[`files/${fileId}`]; }), 'archive-hash'],
      ['missing manifest entry', await changedArchive(backup, (_entries, manifest) => { manifest.attachments = []; }), 'archive-entry'],
      ['duplicate record ID', await changedArchive(backup, (_entries, _manifest, rows) => { rows.push({ ...rows[0] }); }), 'archive-id'],
      ['dangling relation', await changedArchive(backup, (_entries, _manifest, rows) => { rows.push(row('relation', {
        id: crypto.randomUUID(), from: asset.id, to: danglingId, label: 'missing', createdAt: new Date().toISOString(),
      })); }), 'archive-relation-reference'],
      ['dangling task', await changedArchive(backup, (_entries, _manifest, rows) => { rows.push(row('task', {
        id: crypto.randomUUID(), name: 'missing', assetId: danglingId, createdAt: new Date().toISOString(),
      })); }), 'archive-task-reference'],
      ['dangling submission', await changedArchive(backup, (_entries, _manifest, rows) => { rows.push(row('submission', {
        id: crypto.randomUUID(), assetId: danglingId, name: 'missing', url: 'https://example.com', status: 'planned',
      })); }), 'archive-submission-reference'],
      ['dangling history', await changedArchive(backup, (_entries, _manifest, rows) => { rows.push(row('history', {
        id: crypto.randomUUID(), assetId: danglingId, action: 'maintenance', note: 'missing', createdAt: new Date().toISOString(),
      })); }), 'archive-history-reference'],
      ['unsupported version', await changedArchive(backup, (_entries, manifest) => { manifest.version = 2; }), ''],
    ];
    const target = await openLocalRepository(name());
    const local = project('Keep local data');
    try {
      await target.save('asset', local);
      for (const [label, altered, error] of cases) {
        await expect(target.restoreArchive(altered), label).rejects.toThrow(error);
        expect((await target.get<Asset>('asset', local.id))?.name, label).toBe('Keep local data');
        expect(await target.get('asset', asset.id), label).toBeNull();
        expect(await target.fileStore.blobs.count(), label).toBe(0);
        expect(await target.fileStore.journal.count(), label).toBe(0);
      }
    } finally { await target.close(); }
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
    const first = project('Journal recovery');
    const fileId = await source.putFile(new File([new Uint8Array([5, 4, 3])], 'journal.gif', { type: 'image/gif' }));
    await source.save('asset', { ...first, attachments: [fileId] });
    await source.save('asset', project('Second journal record'));
    const rows: RecordRow[] = await source.allRecords();
    const file = await source.readFile(fileId);
    if (!file) throw Error('source-image-missing');
    await source.close();
    const dbName = name();
    const target = await openLocalRepository(dbName);
    // Fixture simulates the durable Dexie attachment+journal commit and one RxDB row before a crash.
    await target.fileStore.blobs.add({ id: fileId, name: file.name, blob: new Blob([new Uint8Array(file.bytes)], { type: file.type }) });
    await target.db.records.insert(rows[0]); // The first row was written before interruption.
    await target.fileStore.journal.put({ id: 'interrupted', rows });
    await target.close();
    const recovered = await openLocalRepository(dbName);
    expect(recovered.restoreRecoveryError).toBeNull();
    expect(await recovered.allRecords()).toHaveLength(2);
    expect(await recovered.readFile(fileId)).toEqual(file);
    expect(await recovered.fileStore.journal.count()).toBe(0);
    await recovered.close();
  });

  it('exposes a live restore replay failure before reopening and clears it after replay', async () => {
    const source = await openLocalRepository(name());
    const asset = project('Interrupted live restore');
    await source.save('asset', asset);
    const backup = await source.exportArchive();
    await source.close();
    const dbName = name();
    const target = await openLocalRepository(dbName);
    const insert = vi.spyOn(target.db.records, 'insert').mockRejectedValueOnce(Error('storage-interrupted'));
    try {
      await expect(target.restoreArchive(backup)).rejects.toThrow('storage-interrupted');
      expect(target.restoreRecoveryError).toBe('storage-interrupted');
      expect(await target.fileStore.journal.count()).toBe(1);
    } finally {
      insert.mockRestore();
      await target.close();
    }
    const reopened = await openLocalRepository(dbName);
    expect(reopened.restoreRecoveryError).toBeNull();
    expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe(asset.name);
    expect(await reopened.fileStore.journal.count()).toBe(0);
    await reopened.close();
  });

  it('opens local data after a conflicting restore replay and retains the journal for explicit recovery', async () => {
    const dbName = name();
    const source = await openLocalRepository(name());
    const asset = project('Archive version');
    const first = project('Already replayed');
    await source.save('asset', first);
    await source.save('asset', asset);
    const rows = await source.allRecords();
    const backup = await source.exportArchive();
    await source.close();
    const target = await openLocalRepository(dbName);
    await target.save('asset', { ...asset, name: 'New local edit' });
    const firstRow = rows.find(row => row.id === `asset:${first.id}`);
    if (!firstRow) throw Error('source-record-missing');
    await target.db.records.insert(firstRow);
    await target.fileStore.journal.put({ id: 'conflicting', rows });
    await target.close();
    const reopened = await openLocalRepository(dbName);
    try {
      expect(reopened.restoreRecoveryError).toBe('restore-conflict');
      expect((await reopened.get<Asset>('asset', asset.id))?.name).toBe('New local edit');
      expect(await reopened.fileStore.journal.count()).toBe(1);
      await expect(reopened.restoreArchive(backup)).rejects.toThrow('restore-recovery-pending');
      expect(await reopened.list('asset')).toHaveLength(2);
      expect((await reopened.get<Asset>('asset', first.id))?.name).toBe('Already replayed');
    } finally { await reopened.close(); }
    const again = await openLocalRepository(dbName);
    expect(again.restoreRecoveryError).toBe('restore-conflict');
    expect((await again.get<Asset>('asset', asset.id))?.name).toBe('New local edit');
    await again.close();
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
