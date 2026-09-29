import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { newAsset, type Asset } from '../../domain/src';
import { inspectArchive, openLocalRepository, type DatasetBinding } from './index';
import { decryptBackup, encryptBackup } from './backup-crypto';
import { decideReviewedCandidate, editReviewedCandidate, listReviewedCandidates, migrateLegacyIntakeReview,
  parseReviewedCandidates, stageReviewedCandidates, type ReviewedCandidate } from './intake-review';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const fixture = (hash = 'a'.repeat(64), rowNumber = 2, pdf = false): ReviewedCandidate => ({
  id: `${pdf ? 'pdf' : 'csv'}-${hash}${pdf ? '' : `-${rowNumber}`}`, fileHash: hash,
  fileName: pdf ? 'invoice.pdf' : 'review.csv', rowNumber: pdf ? 1 : rowNumber,
  asset: { ...newAsset('project'), id: `${pdf ? 'pdf' : 'csv'}-${hash.slice(0, 48)}${pdf ? '' : `-${rowNumber}`}`, name: `Draft ${rowNumber}` },
  status: 'pending', ...(pdf ? { source: 'pdf', sourceText: 'Original invoice USD 12.00', kindSelected: false } : {}),
});
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
  byte => byte.toString(16).padStart(2, '0')).join('');
async function alter(archive: Uint8Array, mutate: (entries: Record<string, Uint8Array>, manifest: Record<string, unknown>) => void) {
  const entries = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as Record<string, unknown>;
  mutate(entries, manifest);
  if (entries['intake-review.json']) manifest.intakeReviewHash = await hash(entries['intake-review.json']);
  if (entries['records.json']) manifest.recordsHash = await hash(entries['records.json']);
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}
async function binding(): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test', accountId = 'intake-owner', workspaceId = crypto.randomUUID();
  return { endpoint, accountId, workspaceId, scope: `${await hash(strToU8(JSON.stringify([endpoint, accountId])))}:${workspaceId}` };
}

it('round trips edited CSV/PDF drafts, all decisions and stable IDs in an encrypted backup', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    const csv = [fixture(), fixture('a'.repeat(64), 3), fixture('a'.repeat(64), 4)];
    const pdf = fixture('b'.repeat(64), 1, true);
    await stageReviewedCandidates(source.fileStore, csv);
    await stageReviewedCandidates(source.fileStore, [pdf]);
    await editReviewedCandidate(source.fileStore, csv[0].id, { ...csv[0].asset, name: '', url: 'unfinished', description: 'Edited pending' });
    await source.save('asset', csv[1].asset);
    await decideReviewedCandidate(source.fileStore, csv[1].id, 'accepted', async id => !!(await source.get('asset', id)));
    // The saved asset can later change or be soft-deleted independently of its receipt.
    await source.save('asset', { ...csv[1].asset, name: 'Updated asset', deleted: true });
    await decideReviewedCandidate(source.fileStore, csv[2].id, 'ignored', async () => false);
    await editReviewedCandidate(source.fileStore, pdf.id, { ...pdf.asset, name: 'Edited PDF', kind: 'subscription' }, true);
    const before = await listReviewedCandidates(source.fileStore);
    const encrypted = await encryptBackup(await source.exportArchive(), 'intake-backup-test-password');
    expect(new TextDecoder().decode(encrypted)).not.toContain('Original invoice');
    const archive = await decryptBackup(encrypted, 'intake-backup-test-password');
    expect((await inspectArchive(archive)).manifest.intakeReviewCount).toBe(4);
    expect(await target.restoreArchive(archive)).toBe(1);
    expect(await listReviewedCandidates(target.fileStore)).toEqual(before);
    await target.restoreArchive(archive);
    await stageReviewedCandidates(target.fileStore, csv.map(row => ({ ...row, fileName: 'renamed.csv' })));
    await stageReviewedCandidates(target.fileStore, [{ ...pdf, fileName: 'renamed.pdf' }]);
    expect(await listReviewedCandidates(target.fileStore)).toEqual(before);
    expect(await target.get<Asset>('asset', csv[1].asset.id)).toMatchObject({ name: 'Updated asset', deleted: true });
  } finally { await source.close(); await target.close(); }
});

it('copies legacy candidates atomically without deleting the source or replacing a newer migrated draft', async () => {
  const repo = await openLocalRepository(name()), legacyName = name();
  const legacy = new Dexie(legacyName);
  legacy.version(1).stores({ rows: 'id, fileHash, status' });
  const rows = [fixture(), fixture('a'.repeat(64), 3)];
  try {
    await legacy.table('rows').bulkAdd(rows);
    const original = repo.fileStore.intakeReview.add.bind(repo.fileStore.intakeReview);
    let calls = 0;
    const failure = vi.spyOn(repo.fileStore.intakeReview, 'add').mockImplementation((row, key) => {
      if (++calls === 2) throw Error('interrupted-migration');
      return original(row, key);
    });
    await expect(migrateLegacyIntakeReview(repo.fileStore, legacyName)).rejects.toThrow('review-migration-failed');
    failure.mockRestore();
    expect(await repo.fileStore.intakeReview.count()).toBe(0);
    expect(await legacy.table('rows').count()).toBe(2);
    await migrateLegacyIntakeReview(repo.fileStore, legacyName);
    await editReviewedCandidate(repo.fileStore, rows[0].id, { ...rows[0].asset, name: 'Newer edit' });
    await migrateLegacyIntakeReview(repo.fileStore, legacyName);
    expect((await listReviewedCandidates(repo.fileStore))[0].asset.name).toBe('Newer edit');
    expect(await legacy.table('rows').toArray()).toEqual(rows);
  } finally { legacy.close(); await Dexie.delete(legacyName); await repo.close(); }
});

it('keeps assets and migrated rows readable when an invalid legacy row prevents migration, and retries safely', async () => {
  const legacy = new Dexie('keepany-intake-review-v1');
  legacy.version(1).stores({ rows: 'id, fileHash, status' });
  const old = fixture('c'.repeat(64)), current = fixture('d'.repeat(64));
  let repo: Awaited<ReturnType<typeof openLocalRepository>> | undefined;
  try {
    await legacy.table('rows').bulkPut([old, { ...fixture('e'.repeat(64)), id: 'invalid-legacy-id' }]);
    repo = await openLocalRepository('keepany-v1');
    expect(repo.intakeReviewMigrationError).toBe('review-migration-failed');
    const asset = { ...newAsset('project'), name: 'Usable asset' };
    await repo.save('asset', asset);
    await stageReviewedCandidates(repo.fileStore, [current]);
    expect(await repo.get('asset', asset.id)).not.toBeNull();
    expect(await listReviewedCandidates(repo.fileStore)).toEqual([current]);
    await expect(repo.exportArchive()).rejects.toThrow('review-migration-failed');
    await expect(repo.restoreArchive(new Uint8Array())).rejects.toThrow('review-migration-failed');
    await expect(repo.previewArchiveMerge(new Uint8Array())).rejects.toThrow('review-migration-failed');
    await expect(repo.applyArchiveMerge(new Uint8Array(), {}, '')).rejects.toThrow('review-migration-failed');
    expect(await legacy.table('rows').count()).toBe(2);
    await legacy.table('rows').delete('invalid-legacy-id');
    await repo.retryIntakeReviewMigration();
    expect(repo.intakeReviewMigrationError).toBeNull();
    expect(await listReviewedCandidates(repo.fileStore)).toHaveLength(2);
    expect((await inspectArchive(await repo.exportArchive())).intakeReview).toHaveLength(2);
    expect(await legacy.table('rows').get(old.id)).toEqual(old);
  } finally { await repo?.close(); legacy.close(); await Dexie.delete('keepany-intake-review-v1'); }
});

it('refuses a mixed export if a second tab edits a candidate while the snapshot is being read', async () => {
  const repo = await openLocalRepository(name());
  try {
    const row = fixture(); await stageReviewedCandidates(repo.fileStore, [row]);
    const original = repo.fileStore.intakeReview.toArray.bind(repo.fileStore.intakeReview);
    const interleaved = vi.spyOn(repo.fileStore.intakeReview, 'toArray').mockImplementationOnce(() => Dexie.Promise.resolve().then(async () => {
      const snapshot = await original();
      await editReviewedCandidate(repo.fileStore, row.id, { ...row.asset, name: 'Concurrent edit' });
      return snapshot;
    }));
    await expect(repo.exportArchive()).rejects.toThrow('archive-export-stale');
    interleaved.mockRestore();
    expect((await listReviewedCandidates(repo.fileStore))[0].asset.name).toBe('Concurrent edit');
  } finally { await repo.close(); }
});

it('continues to restore legacy archives with no candidate entry or manifest fields', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    await source.save('asset', { ...newAsset('project'), name: 'Legacy asset' });
    const old = await alter(await source.exportArchive(), (entries, manifest) => {
      delete entries['intake-review.json']; delete manifest.intakeReviewCount; delete manifest.intakeReviewHash;
    });
    expect((await inspectArchive(old)).intakeReview).toEqual([]);
    expect(await target.restoreArchive(old)).toBe(1);
    expect(await target.list('asset')).toHaveLength(1);
  } finally { await source.close(); await target.close(); }
});

it('refuses migration of an accepted receipt without its RxDB asset and leaves the source intact', async () => {
  const repo = await openLocalRepository(name()), legacyName = name();
  const legacy = new Dexie(legacyName); legacy.version(1).stores({ rows: 'id, fileHash, status' });
  const receipt = { ...fixture(), status: 'accepted' as const };
  try {
    await legacy.table('rows').add(receipt);
    await expect(migrateLegacyIntakeReview(repo.fileStore, legacyName, new Set())).rejects.toThrow('review-migration-failed');
    expect(await repo.fileStore.intakeReview.count()).toBe(0);
    expect(await legacy.table('rows').get(receipt.id)).toEqual(receipt);
    await repo.save('asset', receipt.asset);
    await migrateLegacyIntakeReview(repo.fileStore, legacyName, new Set([receipt.asset.id]));
    expect((await listReviewedCandidates(repo.fileStore))[0].status).toBe('accepted');
  } finally { legacy.close(); await Dexie.delete(legacyName); await repo.close(); }
});

it('rejects missing accepted assets, changed hashes, duplicate IDs and malformed candidate references before writing', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    const row = fixture();
    await stageReviewedCandidates(source.fileStore, [row]);
    await expect(decideReviewedCandidate(source.fileStore, row.id, 'accepted', async () => false)).rejects.toThrow('review-asset-missing');
    await source.save('asset', row.asset);
    await decideReviewedCandidate(source.fileStore, row.id, 'accepted', async () => true);
    const archive = await source.exportArchive();
    const missing = await alter(archive, (entries, manifest) => { entries['records.json'] = strToU8('[]'); manifest.recordCount = 0; });
    await expect(target.restoreArchive(missing)).rejects.toThrow('archive-review-asset-reference');
    const duplicate = await alter(archive, (entries, manifest) => {
      const [value] = JSON.parse(strFromU8(entries['intake-review.json']));
      entries['intake-review.json'] = strToU8(JSON.stringify([value, value])); manifest.intakeReviewCount = 2;
    });
    await expect(target.restoreArchive(duplicate)).rejects.toThrow('archive-review-id');
    const malformed = await alter(archive, entries => {
      const [value] = JSON.parse(strFromU8(entries['intake-review.json']));
      value.asset.id = 'incorrect'; entries['intake-review.json'] = strToU8(JSON.stringify([value]));
    });
    await expect(target.restoreArchive(malformed)).rejects.toThrow('review-id');
    const entries = unzipSync(archive); entries['intake-review.json'] = strToU8('[]');
    await expect(target.restoreArchive(zipSync(entries))).rejects.toThrow('archive-hash');
    expect(await target.allRecords()).toEqual([]);
    expect(await target.fileStore.intakeReview.count()).toBe(0);
    expect(await target.fileStore.journal.count()).toBe(0);
    expect(await target.fileStore.blobs.count()).toBe(0);
  } finally { await source.close(); await target.close(); }
});

it('preflights edited candidate conflicts without adding archive assets or a journal', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    const row = fixture();
    await stageReviewedCandidates(source.fileStore, [row]);
    await source.save('asset', { ...newAsset('project'), name: 'Must not be inserted' });
    await stageReviewedCandidates(target.fileStore, [row]);
    await editReviewedCandidate(target.fileStore, row.id, { ...row.asset, name: 'Target edit' });
    await expect(target.restoreArchive(await source.exportArchive())).rejects.toThrow('restore-conflict');
    expect(await target.allRecords()).toEqual([]);
    expect(await target.fileStore.journal.count()).toBe(0);
    expect((await listReviewedCandidates(target.fileStore))[0].asset.name).toBe('Target edit');
  } finally { await source.close(); await target.close(); }
});

it('replays a restore interrupted after asset writes and commits candidates together with journal deletion', async () => {
  const source = await openLocalRepository(name()), targetName = name();
  const target = await openLocalRepository(targetName);
  const row = fixture();
  await stageReviewedCandidates(source.fileStore, [row]);
  await source.save('asset', row.asset);
  await decideReviewedCandidate(source.fileStore, row.id, 'accepted', async () => true);
  const archive = await source.exportArchive(); await source.close();
  const failure = vi.spyOn(target.fileStore.intakeReview, 'add').mockImplementationOnce(() => { throw Error('interrupted-restore'); });
  await expect(target.restoreArchive(archive)).rejects.toThrow('interrupted-restore');
  failure.mockRestore();
  expect(await target.fileStore.journal.count()).toBe(1);
  expect(await target.fileStore.intakeReview.count()).toBe(0);
  expect(await target.get('asset', row.asset.id)).not.toBeNull();
  await target.close();
  const reopened = await openLocalRepository(targetName);
  try {
    expect(reopened.restoreRecoveryError).toBeNull();
    expect(await reopened.fileStore.journal.count()).toBe(0);
    expect((await listReviewedCandidates(reopened.fileStore))[0].status).toBe('accepted');
    expect(await reopened.allRecords()).toHaveLength(1);
  } finally { await reopened.close(); }
});

it('leaves a replay journal intact and adds no rows when a candidate changed during the interruption', async () => {
  const targetName = name(), target = await openLocalRepository(targetName), row = fixture();
  await stageReviewedCandidates(target.fileStore, [row]);
  await target.fileStore.journal.put({ id: 'interrupted', rows: [{ id: `asset:${row.asset.id}`, type: 'asset',
    payload: JSON.stringify(row.asset), updatedAt: Date.now() }], intakeReview: [{ ...row, status: 'ignored' }] });
  await target.close();
  const reopened = await openLocalRepository(targetName);
  try {
    expect(reopened.restoreRecoveryError).toBe('restore-conflict');
    expect(await reopened.allRecords()).toEqual([]);
    expect(await reopened.fileStore.journal.count()).toBe(1);
    expect((await listReviewedCandidates(reopened.fileStore))[0].status).toBe('pending');
  } finally { await reopened.close(); }
});

it('includes candidate conflict choices and stale edits in archive merge, with durable rollback', async () => {
  const source = await openLocalRepository(name()), targetName = name(), target = await openLocalRepository(targetName);
  const row = fixture(), pdf = fixture('b'.repeat(64), 1, true);
  try {
    await stageReviewedCandidates(source.fileStore, [row]); await stageReviewedCandidates(source.fileStore, [pdf]);
    await source.save('asset', row.asset); await decideReviewedCandidate(source.fileStore, row.id, 'accepted', async () => true);
    const archive = await source.exportArchive();
    await target.claimDatasetBinding(await binding()); await stageReviewedCandidates(target.fileStore, [row]);
    await editReviewedCandidate(target.fileStore, row.id, { ...row.asset, name: 'Target draft' });
    let preview = await target.previewArchiveMerge(archive);
    expect(preview.intakeReview.find(item => item.id === `review:${row.id}`)?.status).toBe('conflict');
    await expect(target.applyArchiveMerge(archive, {}, preview.targetFingerprint)).rejects.toThrow('archive-merge-choice');
    await editReviewedCandidate(target.fileStore, row.id, { ...row.asset, name: 'Later edit' });
    await expect(target.applyArchiveMerge(archive, { [`review:${row.id}`]: 'source' }, preview.targetFingerprint)).rejects.toThrow('archive-merge-stale');
    preview = await target.previewArchiveMerge(archive);
    expect(await target.applyArchiveMerge(archive, { [`review:${row.id}`]: 'source' }, preview.targetFingerprint)).toEqual({
      imported: 1, replaced: 0, skipped: 0, review: { imported: 1, replaced: 1, skipped: 0 },
    });
    expect(await target.pendingArchiveMerge()).toMatchObject({ phase: 'applied', changedCandidates: 2 });
    expect((await listReviewedCandidates(target.fileStore)).find(item => item.id === row.id)?.status).toBe('accepted');
  } finally { await source.close(); await target.close(); }
  const reopened = await openLocalRepository(targetName);
  try {
    await reopened.rollbackArchiveMerge();
    expect(await listReviewedCandidates(reopened.fileStore)).toEqual([{ ...row, asset: { ...row.asset, name: 'Later edit' } }]);
    expect(await reopened.get('asset', row.asset.id)).toBeNull();
    expect(await reopened.pendingArchiveMerge()).toBeNull();
  } finally { await reopened.close(); }
});

it('rolls back candidate merge and inserted assets if final phase persistence is interrupted', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    const row = fixture(); await stageReviewedCandidates(source.fileStore, [row]); await source.save('asset', row.asset);
    await target.claimDatasetBinding(await binding());
    const archive = await source.exportArchive(), preview = await target.previewArchiveMerge(archive);
    const failure = vi.spyOn(target.fileStore.archiveMerge, 'update').mockImplementationOnce(() => { throw Error('interrupted-merge'); });
    await expect(target.applyArchiveMerge(archive, {}, preview.targetFingerprint)).rejects.toThrow('interrupted-merge');
    failure.mockRestore();
    expect(await target.fileStore.intakeReview.count()).toBe(0);
    expect(await target.allRecords()).toEqual([]);
    expect(await target.pendingArchiveMerge()).toBeNull();
  } finally { await source.close(); await target.close(); }
});

it('preserves an edited candidate and its merge journal when a rollback would overwrite the edit', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    const row = fixture(); await stageReviewedCandidates(source.fileStore, [row]); await source.save('asset', row.asset);
    await target.claimDatasetBinding(await binding());
    const archive = await source.exportArchive(), preview = await target.previewArchiveMerge(archive);
    await target.applyArchiveMerge(archive, {}, preview.targetFingerprint);
    await editReviewedCandidate(target.fileStore, row.id, { ...row.asset, name: 'Keep this newer draft' });
    await expect(target.rollbackArchiveMerge()).rejects.toThrow('archive-merge-rollback-conflict');
    expect((await listReviewedCandidates(target.fileStore))[0].asset.name).toBe('Keep this newer draft');
    expect(await target.get('asset', row.asset.id)).not.toBeNull();
    expect(await target.pendingArchiveMerge()).toMatchObject({ phase: 'applied', changedCandidates: 1 });
  } finally { await source.close(); await target.close(); }
});

it('rejects a merge preview whose displayed candidate changed while its fingerprint was being built', async () => {
  const source = await openLocalRepository(name()), target = await openLocalRepository(name());
  try {
    const row = fixture(); await stageReviewedCandidates(source.fileStore, [row]); await stageReviewedCandidates(target.fileStore, [row]);
    const archive = await source.exportArchive();
    const original = target.fileStore.intakeReview.toArray.bind(target.fileStore.intakeReview);
    const interleaved = vi.spyOn(target.fileStore.intakeReview, 'toArray').mockImplementationOnce(() => Dexie.Promise.resolve().then(async () => {
      const snapshot = await original(); await editReviewedCandidate(target.fileStore, row.id, { ...row.asset, name: 'Concurrent preview edit' });
      return snapshot;
    }));
    await expect(target.previewArchiveMerge(archive)).rejects.toThrow('archive-merge-stale');
    interleaved.mockRestore();
    expect((await listReviewedCandidates(target.fileStore))[0].asset.name).toBe('Concurrent preview edit');
  } finally { await source.close(); await target.close(); }
});

it('validates draft structure while preserving editable whitespace and invalid fields', () => {
  const row = fixture();
  expect(parseReviewedCandidates([{ ...row, asset: { ...row.asset, name: ' ', url: 'not ready' } }])[0].asset.name).toBe(' ');
  expect(() => parseReviewedCandidates([{ ...row, asset: { ...row.asset, amount: -1 } }])).toThrow('review-asset');
  expect(() => parseReviewedCandidates([{ ...row, status: 'accepted', asset: { ...row.asset, name: '' } }])).toThrow('review-accepted');
});
