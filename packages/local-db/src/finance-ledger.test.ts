import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { effectiveFinanceEntry, historyAssetIds, historySchema, newAsset, type Asset, type History } from '../../domain/src';
import { inspectArchive, LocalRepository, openLocalRepository } from './index';

const databaseName = () => `finance-${crypto.randomUUID().slice(0, 12)}`;
const bill = (assetId: string, assetIds?: string[]): History => historySchema.parse({
  id: crypto.randomUUID(), assetId, ...(assetIds ? { assetIds } : {}), action: 'expense', title: 'Shared deployment invoice',
  source: 'Synthetic receipt', note: 'Full evidence note', amount: 10008, currency: 'CNY', eventDate: '2026-10-27',
  createdAt: '2026-10-27T00:00:00.000Z',
});
const correction = (entry: History, assetIds = [entry.assetId]) => historySchema.parse({ ...entry,
  financeCorrection: { title: 'Corrected renewal invoice', source: 'Revised receipt', note: 'Currency corrected',
    eventDate: '2026-10-26', amount: 3301, currency: 'JPY', assetIds, hidden: false },
});

describe('confirmed finance ledger mutations', () => {
  it('creates one bill for project, item, account and subscription owners and restores exact ownership', async () => {
    const source = await openLocalRepository(databaseName()), restored = await openLocalRepository(databaseName());
    try {
      const assets = (['project', 'item', 'account', 'subscription'] as const).map(kind => ({ ...newAsset(kind), name: `${kind} owner` }));
      await source.saveBatch(assets.map(value => ({ type: 'asset', value })));
      const entry = bill(assets[0].id, assets.map(asset => asset.id));
      await source.createFinanceEntry(entry);
      expect(await source.list('history')).toEqual([entry]);
      await restored.restoreArchive(await source.exportArchive());
      expect(await restored.list('history')).toEqual([entry]);
      expect(historyAssetIds((await restored.list<History>('history'))[0])).toEqual(assets.map(asset => asset.id));
      expect(await restored.list('asset')).toHaveLength(4);
    } finally { await source.close(); await restored.close(); }
  });

  it('rejects missing, deleted and vault targets without writing and refuses to replace an existing bill on create', async () => {
    const repository = await openLocalRepository(databaseName());
    try {
      const live = newAsset('project'), deleted = { ...newAsset('item'), deleted: true }, vault = newAsset('vault');
      await repository.saveBatch([live, deleted, vault].map(value => ({ type: 'asset', value })));
      for (const id of ['missing-owner', deleted.id, vault.id]) await expect(repository.createFinanceEntry(bill(live.id, [live.id, id]))).rejects.toThrow('finance-target-changed');
      expect(await repository.list('history')).toEqual([]);
      const entry = bill(live.id); await repository.createFinanceEntry(entry);
      await expect(repository.createFinanceEntry({ ...entry, amount: 1 })).rejects.toThrow('history-stale');
      expect(await repository.get('history', entry.id)).toEqual(entry);
    } finally { await repository.close(); }
  });

  it('edits exact minor units and dates, removes the former primary ownership and preserves the bill identity', async () => {
    const repository = await openLocalRepository(databaseName());
    try {
      const first = newAsset('project'), second = newAsset('item');
      await repository.saveBatch([first, second].map(value => ({ type: 'asset', value })));
      const entry = bill(first.id, [first.id, second.id]); await repository.createFinanceEntry(entry);
      const edited = { ...entry, assetId: second.id, assetIds: [second.id], amount: 2345, currency: 'JPY' as const,
        eventDate: '2026-10-25', note: '  Exact evidence\nnext line  ' };
      await repository.saveFinanceEntryIfCurrent(entry, edited);
      expect(await repository.list('history')).toEqual([edited]);
      expect(historyAssetIds(edited)).toEqual([second.id]);
      expect(edited.id).toBe(entry.id); expect(edited.createdAt).toBe(entry.createdAt);
    } finally { await repository.close(); }
  });

  it('rejects stale edits and deletion across two instances, then deletes only the reviewed bill', async () => {
    const first = await openLocalRepository(databaseName()), second = new LocalRepository(first.db, first.fileStore);
    try {
      const asset = newAsset('account'); await first.save('asset', asset);
      const entry = bill(asset.id), unrelated = bill(asset.id);
      await first.createFinanceEntry(entry); await first.createFinanceEntry(unrelated);
      const edited = { ...entry, amount: 1 }; await second.saveFinanceEntryIfCurrent(entry, edited);
      await expect(first.saveFinanceEntryIfCurrent(entry, { ...entry, deleted: true })).rejects.toThrow('history-stale');
      await expect(first.saveFinanceEntryIfCurrent(entry, { ...entry, amount: 200 })).rejects.toThrow('history-stale');
      await first.saveFinanceEntryIfCurrent(edited, { ...edited, deleted: true });
      expect(await first.list('history')).toEqual([unrelated]);
      expect(await first.get('history', entry.id)).toEqual({ ...edited, deleted: true });
    } finally { await first.close(); }
  });

  it('corrects and removes a renewal bill without changing its fact, subscription schedule or renewal identity', async () => {
    const repository = await openLocalRepository(databaseName()), restored = await openLocalRepository(databaseName());
    try {
      const subscription = { ...newAsset('subscription'), name: 'Subscription', dueDate: '2026-10-27', billingAnchor: '2026-10-27' };
      const project = newAsset('project'); await repository.saveBatch([subscription, project].map(value => ({ type: 'asset', value })));
      const renewal = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: 'renew', note: 'Renewal fact',
        billDate: subscription.dueDate, amount: 1200, currency: 'CNY', createdAt: '2026-10-27T00:00:00.000Z' });
      const next: Asset = { ...subscription, dueDate: '2026-11-27', renewalCount: 1, lastRenewalId: renewal.id, updatedAt: '2026-10-27T00:00:01.000Z' };
      await repository.recordRenewal(subscription, next, renewal);
      const corrected = correction(renewal, [project.id]); await repository.saveFinanceEntryIfCurrent(renewal, corrected);
      expect(await repository.get('asset', subscription.id)).toEqual(next);
      expect(historyAssetIds(corrected)).toEqual([project.id]);
      expect(effectiveFinanceEntry(corrected)).toMatchObject({ amount: 3301, currency: 'JPY', billDate: '2026-10-26' });
      const hidden = historySchema.parse({ ...corrected, financeCorrection: { ...corrected.financeCorrection, hidden: true } });
      await repository.saveFinanceEntryIfCurrent(corrected, hidden);
      const stored = await repository.get<History>('history', renewal.id);
      if (!stored) throw Error('missing-renewal');
      expect(effectiveFinanceEntry(stored).deleted).toBe(true);
      expect(await repository.list('history')).toEqual([hidden]);
      expect(hidden).toMatchObject(renewal);
      await restored.restoreArchive(await repository.exportArchive());
      expect(await restored.get('history', renewal.id)).toEqual(hidden);
      expect(await restored.get('asset', subscription.id)).toEqual(next);
    } finally { await repository.close(); await restored.close(); }
  });

  it('refuses to rewrite renewal facts through the bill editor', async () => {
    const repository = await openLocalRepository(databaseName());
    try {
      const asset = newAsset('subscription'); await repository.save('asset', asset);
      const entry = historySchema.parse({ ...bill(asset.id), action: 'renew', billDate: '2026-10-27' });
      await repository.save('history', entry);
      for (const patch of [{ amount: 1 }, { billDate: '2026-10-26' }, { deleted: true }, { note: 'Overwritten renewal' }])
        await expect(repository.saveFinanceEntryIfCurrent(entry, { ...entry, ...patch })).rejects.toThrow('finance-renewal-immutable');
      expect(await repository.get('history', entry.id)).toEqual(entry);
    } finally { await repository.close(); }
  });

  it('retains the bill after a failed storage write and permits retry without creating duplicates', async () => {
    const repository = await openLocalRepository(databaseName());
    try {
      const asset = newAsset('project'); await repository.save('asset', asset);
      const entry = bill(asset.id);
      const fail = vi.spyOn(repository.db.records, 'insert').mockRejectedValueOnce(Error('synthetic-quota'));
      await expect(repository.createFinanceEntry(entry)).rejects.toThrow('synthetic-quota'); fail.mockRestore();
      expect(await repository.list('history')).toEqual([]);
      await repository.createFinanceEntry(entry);
      expect(await repository.list('history')).toEqual([entry]);
    } finally { await repository.close(); }
  });

  it('includes secondary ownership in permanent erasure and blocks a stale edit from restoring its evidence', async () => {
    const repository = await openLocalRepository(databaseName());
    try {
      const first = newAsset('project'), second = newAsset('item');
      await repository.saveBatch([first, second].map(value => ({ type: 'asset', value })));
      const entry = bill(first.id, [first.id, second.id]); await repository.createFinanceEntry(entry);
      await repository.deleteEntity('asset', second.id);
      const plan = await repository.previewTrashPurge([{ type: 'asset', id: second.id }]);
      expect(plan.rows.map(row => row.id)).toContain(`history:${entry.id}`);
      await repository.purgeTrash(plan);
      expect(await repository.get('history', entry.id)).toMatchObject({ deleted: true, purged: true, note: '' });
      await expect(repository.saveFinanceEntryIfCurrent(entry, { ...entry, amount: 1 })).rejects.toThrow();
      expect(new TextDecoder().decode(await repository.exportArchive())).not.toContain('Full evidence note');
    } finally { await repository.close(); }
  });

  it('rejects an archive with a dangling secondary owner before replacing the destination', async () => {
    const source = await openLocalRepository(databaseName()), target = await openLocalRepository(databaseName());
    try {
      const asset = newAsset('project'), kept = { ...newAsset('item'), name: 'Keep target' };
      await source.save('asset', asset); await source.createFinanceEntry(bill(asset.id)); await target.save('asset', kept);
      const entries = unzipSync(await source.exportArchive()), rows = JSON.parse(strFromU8(entries['records.json']));
      const history = rows.find((row: { type: string }) => row.type === 'history');
      history.payload = JSON.stringify({ ...JSON.parse(history.payload), assetIds: [asset.id, 'missing-owner'] });
      entries['records.json'] = strToU8(JSON.stringify(rows));
      const manifest = JSON.parse(strFromU8(entries['manifest.json']));
      manifest.recordsHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', entries['records.json'] as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
      entries['manifest.json'] = strToU8(JSON.stringify(manifest)); const archive = zipSync(entries);
      await expect(inspectArchive(archive)).rejects.toThrow('archive-history-reference');
      await expect(target.restoreArchive(archive)).rejects.toThrow('archive-history-reference');
      expect(await target.list('asset')).toEqual([kept]);
    } finally { await source.close(); await target.close(); }
  });
});
