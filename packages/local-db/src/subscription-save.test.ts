import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { entitySchemas, newAsset, type Asset, type Relation } from '../../domain/src';
import { LocalRepository, openLocalRepository, type RecordRow } from './index';
import type { SubscriptionSaveJournal } from './subscription-save';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const nextRow = (type: 'asset' | 'relation', value: Asset | Relation): RecordRow => ({
  id: `${type}:${value.id}`, type, payload: JSON.stringify(entitySchemas[type].parse(value)), updatedAt: Date.now(),
});
const planned = (asset: Asset, target: Asset, label = 'Project') => {
  const relation = entitySchemas.relation.parse({ id: crypto.randomUUID(), from: asset.id, to: target.id,
    label, createdAt: new Date().toISOString(), verifiedAt: '' });
  return { row: nextRow('relation', relation), targetKind: target.kind as 'project' | 'account' };
};

test('subscription asset-only submission survives reopening and preserves a later ordinary edit', async () => {
  const databaseName = name();
  const repository = await openLocalRepository(databaseName);
  const subscription = { ...newAsset('subscription'), name: 'Plan' };
  const project = { ...newAsset('project'), name: 'Project' };
  await repository.saveBatch([{ type: 'asset', value: subscription }, { type: 'asset', value: project }]);
  const insert = repository.db.records.insert.bind(repository.db.records);
  const failed = vi.spyOn(repository.db.records, 'insert').mockImplementation(async (...args) => {
    if ((args[0] as RecordRow).type === 'relation') throw Error('injected-relations-offline');
    return insert(...args);
  });
  await expect(repository.saveSubscription(subscription, { ...subscription, subscriptionPaymentMethod: 'Card 4242' },
    [{ id: project.id, kind: 'project', label: 'Project' }])).rejects.toThrow('subscription-relations-pending');
  const saved = await repository.get<Asset>('asset', subscription.id);
  if (!saved) throw Error('subscription-missing');
  expect(saved).toMatchObject({ subscriptionPaymentMethod: 'Card 4242' });
  expect(saved?.lastSubscriptionSaveId).toBeTruthy();
  const journal = (await repository.fileStore.subscriptionSaveJournal.toArray())[0];
  expect(await repository.getPendingSubscriptionSave(subscription.id)).toMatchObject({ assetSaved: true, relationCount: 1 });
  expect(await repository.list('relation')).toHaveLength(0);
  failed.mockRestore();
  await repository.saveAssetIfCurrent(saved, { ...saved, name: 'Renamed later' });
  await repository.close();

  const reopened = await openLocalRepository(databaseName);
  try {
    expect(await reopened.get<Asset>('asset', subscription.id)).toMatchObject({
      name: 'Renamed later', subscriptionPaymentMethod: 'Card 4242', lastSubscriptionSaveId: journal.id,
    });
    expect(await reopened.list<Relation>('relation')).toMatchObject([{ id: journal.relations[0].row.id.slice(9), from: subscription.id, to: project.id }]);
    expect(await reopened.fileStore.subscriptionSaveJournal.count()).toBe(0);
    expect(reopened.subscriptionRecoveryError).toBeNull();
    await reopened.retrySubscriptionSave(subscription.id);
    expect(await reopened.list('relation')).toHaveLength(1);
  } finally { await reopened.close(); }
});

test('new subscription and partially saved connections recover with the original IDs only once', async () => {
  const databaseName = name();
  const repository = await openLocalRepository(databaseName);
  const subscription = { ...newAsset('subscription'), name: 'New plan' };
  const project = newAsset('project'), account = newAsset('account');
  await repository.saveBatch([{ type: 'asset', value: project }, { type: 'asset', value: account }]);
  const insert = repository.db.records.insert.bind(repository.db.records);
  let count = 0;
  const failed = vi.spyOn(repository.db.records, 'insert').mockImplementation(async (...args) => {
    if ((args[0] as RecordRow).type === 'relation' && ++count > 1) throw Error('injected-second-relation');
    return insert(...args);
  });
  await expect(repository.saveSubscription(null, subscription, [
    { id: project.id, kind: 'project', label: 'Project' }, { id: account.id, kind: 'account', label: 'Account' },
  ])).rejects.toThrow('subscription-relations-pending');
  const journal = (await repository.fileStore.subscriptionSaveJournal.toArray())[0];
  expect(await repository.list('relation')).toHaveLength(1);
  failed.mockRestore();
  await repository.close();
  const reopened = await openLocalRepository(databaseName);
  try {
    const relations = await reopened.list<Relation>('relation');
    expect(relations.map(relation => relation.id).sort()).toEqual(journal.relations.map(relation => relation.row.id.slice(9)).sort());
    expect((await reopened.list<Asset>('asset')).filter(asset => asset.kind === 'subscription')).toHaveLength(1);
    await reopened.retrySubscriptionSave(subscription.id);
    expect(await reopened.list('relation')).toHaveLength(2);
  } finally { await reopened.close(); }
});

test('uncommitted subscription intent cancels after interruption without altering a later edit', async () => {
  const databaseName = name();
  const repository = await openLocalRepository(databaseName);
  const subscription = newAsset('subscription'), project = newAsset('project');
  await repository.saveBatch([{ type: 'asset', value: subscription }, { type: 'asset', value: project }]);
  const id = crypto.randomUUID();
  const journal: SubscriptionSaveJournal = { id, assetId: subscription.id, expectedMarker: '',
    next: nextRow('asset', { ...subscription, name: 'Uncommitted', lastSubscriptionSaveId: id }),
    relations: [planned(subscription, project)] };
  await repository.fileStore.subscriptionSaveJournal.add(journal);
  await repository.saveAssetIfCurrent(subscription, { ...subscription, name: 'Newer editor' });
  await repository.close();
  const reopened = await openLocalRepository(databaseName);
  try {
    expect(await reopened.get<Asset>('asset', subscription.id)).toMatchObject({ name: 'Newer editor', lastSubscriptionSaveId: '' });
    expect(await reopened.list('relation')).toHaveLength(0);
    expect(await reopened.fileStore.subscriptionSaveJournal.count()).toBe(0);
  } finally { await reopened.close(); }
});

test('removed endpoints retain a pending intent until abandoned without rolling back saved fields', async () => {
  const repository = await openLocalRepository(name());
  try {
    const subscription = newAsset('subscription'), project = newAsset('project'), replacement = newAsset('project');
    await repository.saveBatch([subscription, project, replacement].map(value => ({ type: 'asset' as const, value })));
    const insert = repository.db.records.insert.bind(repository.db.records);
    const failed = vi.spyOn(repository.db.records, 'insert').mockImplementation(async (...args) => {
      if ((args[0] as RecordRow).type === 'relation') throw Error('injected-write');
      return insert(...args);
    });
    await expect(repository.saveSubscription(subscription, { ...subscription, subscriptionPaymentMethod: 'Bank transfer' },
      [{ id: project.id, kind: 'project', label: 'Project' }])).rejects.toThrow('subscription-relations-pending');
    failed.mockRestore();
    await repository.deleteEntity('asset', project.id);
    await expect(repository.retrySubscriptionSave(subscription.id)).rejects.toThrow('subscription-relations-pending');
    await expect(repository.exportArchive()).rejects.toThrow('subscription-relations-pending');
    const scope = `${'a'.repeat(64)}:${crypto.randomUUID()}`;
    await expect(repository.dirtyScopedRows(scope)).rejects.toThrow('subscription-relations-pending');
    await expect(repository.listScopedOutbox(scope)).rejects.toThrow('subscription-relations-pending');
    const saved = await repository.get<Asset>('asset', subscription.id);
    if (!saved) throw Error('subscription-missing');
    await expect(repository.saveSubscription(saved, { ...saved, name: 'Blocked edit' }, [])).rejects.toThrow('subscription-relations-pending');
    expect(await repository.get<Asset>('asset', subscription.id)).toMatchObject({ name: subscription.name, subscriptionPaymentMethod: 'Bank transfer' });
    expect(await repository.getPendingSubscriptionSave(subscription.id)).toMatchObject({ assetSaved: true });
    await repository.abandonSubscriptionSave(subscription.id);
    expect(await repository.getPendingSubscriptionSave(subscription.id)).toBeNull();
    expect((await repository.exportArchive()).length).toBeGreaterThan(0);
    await repository.saveSubscription(saved, { ...saved, name: 'Recovered edit' }, [{ id: replacement.id, kind: 'project', label: 'Project' }]);
    expect(await repository.get<Asset>('asset', subscription.id)).toMatchObject({ name: 'Recovered edit', subscriptionPaymentMethod: 'Bank transfer' });
    expect(await repository.list<Relation>('relation')).toMatchObject([{ to: replacement.id }]);
  } finally { await repository.close(); }
});

test('deleted partially saved relation remains a tombstone after retry and reopen', async () => {
  const databaseName = name();
  const repository = await openLocalRepository(databaseName);
  const subscription = newAsset('subscription'), project = newAsset('project'), account = newAsset('account');
  await repository.saveBatch([subscription, project, account].map(value => ({ type: 'asset' as const, value })));
  const insert = repository.db.records.insert.bind(repository.db.records);
  let count = 0;
  const failed = vi.spyOn(repository.db.records, 'insert').mockImplementation(async (...args) => {
    if ((args[0] as RecordRow).type === 'relation' && ++count > 1) throw Error('injected-write');
    return insert(...args);
  });
  await expect(repository.saveSubscription(subscription, { ...subscription, name: 'Saved plan' }, [
    { id: project.id, kind: 'project', label: 'Project' }, { id: account.id, kind: 'account', label: 'Account' },
  ])).rejects.toThrow('subscription-relations-pending');
  failed.mockRestore();
  const relation = (await repository.list<Relation>('relation'))[0];
  await repository.deleteEntity('relation', relation.id);
  await repository.close();
  const reopened = await openLocalRepository(databaseName);
  try {
    expect(reopened.subscriptionRecoveryError).toBe('subscription-relation-unavailable');
    await expect(reopened.retrySubscriptionSave(subscription.id)).rejects.toThrow('subscription-relations-pending');
    expect(await reopened.get<Relation>('relation', relation.id)).toMatchObject({ deleted: true });
    expect(await reopened.list('relation')).toHaveLength(0);
    expect(await reopened.fileStore.subscriptionSaveJournal.count()).toBe(1);
    await reopened.abandonSubscriptionSave(subscription.id);
    expect(await reopened.get<Relation>('relation', relation.id)).toMatchObject({ deleted: true });
    expect(await reopened.get<Asset>('asset', subscription.id)).toMatchObject({ name: 'Saved plan' });
  } finally { await reopened.close(); }
});

test('concurrent subscription editors accept one asset snapshot and do not create duplicate relations', async () => {
  const repository = await openLocalRepository(name());
  try {
    const subscription = newAsset('subscription'), project = newAsset('project');
    await repository.saveBatch([subscription, project].map(value => ({ type: 'asset' as const, value })));
    const otherTab = new LocalRepository(repository.records, repository.fileStore);
    const links = [{ id: project.id, kind: 'project' as const, label: 'Project' }];
    const outcomes = await Promise.allSettled([
      repository.saveSubscription(subscription, { ...subscription, name: 'First' }, links),
      otherTab.saveSubscription(subscription, { ...subscription, name: 'Second' }, links),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('asset-stale');
    expect(await repository.list('relation')).toHaveLength(1);
    expect(await repository.fileStore.subscriptionSaveJournal.count()).toBe(0);
    const saved = await repository.get<Asset>('asset', subscription.id);
    if (!saved) throw Error('subscription-missing');
    await expect(repository.saveAssetIfCurrent(saved, { ...saved, lastSubscriptionSaveId: '' })).rejects.toThrow('asset-stale');
  } finally { await repository.close(); }
});
