import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { assetSchema, historySchema, newAsset, relationSchema, submissionSchema, type Asset, type History, type Relation, type Submission, type Task } from '../../domain/src';
import { buildProjectWorkflowTasks, currentProjectWorkflowRound, recordProjectWorkflowTask } from '../../domain/src/project-workflow';
import { inspectArchive, LocalRepository, openLocalRepository, type RecordRow } from './index';

const name = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const project = (label: string): Asset => ({ ...newAsset('project'), name: label });
const renewalFixture = () => {
  const expected: Asset = { ...newAsset('subscription'), name: 'Renewal fixture', amount: 1200,
    dueDate: '2026-01-31', billingAnchor: '2026-01-31' };
  const event = historySchema.parse({ id: crypto.randomUUID(), assetId: expected.id, action: 'renew',
    note: 'Local renewal record', billDate: expected.dueDate, amount: expected.amount,
    currency: expected.currency, createdAt: new Date().toISOString() });
  const next: Asset = { ...expected, dueDate: '2026-02-28', renewalCount: 1, lastRenewalId: event.id,
    updatedAt: new Date(Date.now() + 1000).toISOString() };
  return { expected, next, event };
};
const itemFixture = (expected: Asset = { ...newAsset('item'), name: 'Camera',
  purchaseDate: '2026-01-15', warrantyDate: '2028-01-15' }, action: 'loan' | 'return' | 'maintenance' = 'loan') => {
  const event: History = historySchema.parse({ id: crypto.randomUUID(), assetId: expected.id, action,
    borrower: action === 'loan' ? 'Ada' : expected.borrower, note: action === 'maintenance' ? 'Cleaned lens' : '',
    eventDate: '2026-09-29', createdAt: new Date().toISOString() });
  const next: Asset = { ...expected,
    status: action === 'loan' ? 'loaned' : action === 'return' ? 'active' : expected.status,
    borrower: action === 'loan' ? 'Ada' : action === 'return' ? '' : expected.borrower,
    lastItemEventId: event.id, updatedAt: new Date(Date.now() + 1000).toISOString() };
  return { expected, next, event };
};
const itemStatusFixture = (expected: Asset, after: NonNullable<Asset['itemLifecycleStatus']>, eventDate = '2026-09-29') => {
  const event: History = historySchema.parse({ id: crypto.randomUUID(), assetId: expected.id, action: 'itemStatus',
    itemStatusBefore: expected.itemLifecycleStatus, itemStatusAfter: after, eventDate, note: 'Local status note',
    createdAt: new Date().toISOString() });
  const next: Asset = { ...expected, itemLifecycleStatus: after, itemStatusDate: eventDate,
    lastItemEventId: event.id, updatedAt: new Date(Date.now() + 1000).toISOString() };
  return { expected, next, event };
};
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
  it('refuses to replace a relation that changed after review', async () => {
    const db = await openLocalRepository(name());
    try {
      const from = project('From'), to = project('To');
      await db.saveBatch([{ type: 'asset', value: from }, { type: 'asset', value: to }]);
      const initial = relationSchema.parse({ id: crypto.randomUUID(), from: from.id, to: to.id,
        label: 'Original', createdAt: new Date().toISOString() });
      await db.save('relation', initial);
      const latest = { ...initial, label: 'Edited by user' };
      await db.saveRelationIfCurrent(initial, latest);
      await expect(db.saveRelationIfCurrent(initial, { ...initial, deleted: true })).rejects.toThrow('stale');
      expect(await db.get<Relation>('relation', initial.id)).toEqual(latest);
      await db.saveRelationIfCurrent(latest, { ...latest, deleted: true });
      expect((await db.get<Relation>('relation', initial.id))?.deleted).toBe(true);
    } finally { await db.close(); }
  });
  it('allows only one normalized category across concurrent calls and permits recreation after removal', async () => {
    const first = await openLocalRepository(name());
    try {
      const attempts = await Promise.allSettled([
        first.createCategory('project', '  Work  ', 3),
        first.createCategory('project', 'ｗＯＲＫ', 3),
      ]);
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect((attempts.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message)
        .toBe('category-duplicate');
      const categories = await first.list<{ id: string; kind: string; name: string; deleted: boolean }>('category');
      expect(categories).toHaveLength(1);
      expect(categories[0].kind).toBe('project');
      await first.save('category', { ...categories[0], order: 3, deleted: true });
      const recreated = await first.createCategory('project', 'work', 3);
      expect(recreated.id).not.toBe(categories[0].id);
      expect(await first.list('category')).toHaveLength(1);
    } finally {
      await first.close();
    }
  });

  it('rejects an outdated asset editor snapshot and deletes the latest image-bearing record', async () => {
    const db = await openLocalRepository(name());
    try {
      const first = project('First name');
      await db.save('asset', first);
      const oldEditor = await db.get<Asset>('asset', first.id);
      if (!oldEditor) throw Error('asset-missing');
      const imageId = await db.putFile(new File([new Uint8Array([7, 8])], 'latest.png', { type: 'image/png' }));
      const latest = { ...first, name: 'Latest name', attachments: [imageId] };
      await db.saveAssetIfCurrent(oldEditor, latest);
      await expect(db.saveAssetIfCurrent(oldEditor, { ...oldEditor, name: 'Old edit' })).rejects.toThrow('asset-stale');
      expect(await db.get<Asset>('asset', first.id)).toMatchObject({ name: 'Latest name', attachments: [imageId] });
      await db.deleteEntity('asset', first.id);
      expect(await db.get<Asset>('asset', first.id)).toMatchObject({ deleted: true, name: 'Latest name', attachments: [imageId] });
      await db.restoreEntity('asset', first.id);
      expect(await db.get<Asset>('asset', first.id)).toMatchObject({ deleted: false, name: 'Latest name', attachments: [imageId] });
      expect((await inspectArchive(await db.exportArchive())).manifest.attachments.map(item => item.id)).toEqual([imageId]);
    } finally { await db.close(); }
  });

  it('rejects stale submission edits without rolling back verification and evidence', async () => {
    const db = await openLocalRepository(name());
    const otherTab = new LocalRepository(db.db, db.fileStore);
    try {
      const site = project('Submission site');
      await db.save('asset', site);
      const initial = submissionSchema.parse({ id: crypto.randomUUID(), assetId: site.id,
        name: 'Directory', url: 'https://directory.example/site', status: 'verify',
        submittedAt: '2026-09-28', verifiedAt: '', evidence: 'Receipt 1', deleted: false });
      await db.save('submission', initial);
      const oldEditor = await db.get<Submission>('submission', initial.id);
      if (!oldEditor) throw Error('submission-missing');
      const verified = { ...initial, status: 'indexed' as const,
        verifiedAt: '2026-09-29', evidence: 'https://directory.example/site/live' };
      await otherTab.saveSubmissionIfCurrent(initial, verified);
      await expect(db.saveSubmissionIfCurrent(oldEditor, { ...oldEditor, name: 'Stale title' }))
        .rejects.toThrow('submission-stale');
      expect(await db.get<Submission>('submission', initial.id)).toEqual(verified);
      await db.save('submission', { ...verified, deleted: true });
      await expect(db.saveSubmissionIfCurrent(verified, { ...verified, name: 'Stale after deletion' }))
        .rejects.toThrow('submission-stale');
      expect((await db.get<Submission>('submission', initial.id))?.deleted).toBe(true);
    } finally { await db.close(); }
  });

  it('rejects stale project workflow evidence rather than overwriting another tab', async () => {
    const db = await openLocalRepository(name());
    try {
      const site = project('Evidence site');
      await db.save('asset', site);
      const [initial] = buildProjectWorkflowTasks({ project: site, assets: [site], relations: [], submissions: [], kind: 'brand', proposal: { proposedName: 'New site', proposedDescription: '', proposedUrl: '', changeNote: '' }, roundId: crypto.randomUUID(), at: '2026-09-29T00:00:00.000Z', title: step => step });
      await db.save('task', initial);
      const old = await db.get<Task>('task', initial.id);
      if (!old) throw Error('task-missing');
      const first = recordProjectWorkflowTask(old, 'done', 'Verified by tab A', '2026-09-29T01:00:00.000Z');
      await db.saveTaskIfCurrent(old, first);
      const stale = recordProjectWorkflowTask(old, 'blocked', 'Tab B stale result', '2026-09-29T02:00:00.000Z');
      await expect(db.saveTaskIfCurrent(old, stale)).rejects.toThrow('task-stale');
      expect((await db.get<Task>('task', initial.id))?.projectWorkflow?.record?.evidence).toBe('Verified by tab A');
    } finally { await db.close(); }
  });

  it('checks the live close round before the final decision and local archive', async () => {
    const db = await openLocalRepository(name());
    const otherTab = new LocalRepository(db.db, db.fileStore);
    try {
      const site = project('Close race site');
      await db.save('asset', site);
      const makeRound = (roundId: string, at: string) => buildProjectWorkflowTasks({
        project: site, assets: [site], relations: [], submissions: [], kind: 'close', roundId, at,
        title: step => step,
      });
      const firstRoundId = crypto.randomUUID();
      const initial = makeRound(firstRoundId, '2026-09-29T00:00:00.000Z');
      await db.saveBatch(initial.map(value => ({ type: 'task' as const, value })));
      const resolved = [] as Task[];
      for (const task of initial.slice(0, -1)) {
        const next = recordProjectWorkflowTask(task, 'done', 'Resolved', '2026-09-29T01:00:00.000Z');
        await db.saveTaskIfCurrent(task, next);
        resolved.push(next);
      }

      // Tab A renders an apparently complete round; tab B changes a prerequisite before A writes.
      const staleRound = currentProjectWorkflowRound(await db.list<Task>('task'), site.id, 'close');
      const decision = staleRound.find(task => task.projectWorkflow?.step === 'closeDecision');
      if (!decision) throw Error('decision-missing');
      const blocked = recordProjectWorkflowTask(resolved[0], 'blocked', 'Needs handoff', '2026-09-29T02:00:00.000Z');
      await otherTab.saveTaskIfCurrent(resolved[0], blocked);
      await expect(db.saveTaskIfCurrent(decision, recordProjectWorkflowTask(decision, 'done', 'Close approved', '2026-09-29T02:01:00.000Z')))
        .rejects.toThrow('workflow-stale');
      expect((await db.get<Task>('task', decision.id))?.projectWorkflow?.record).toBeUndefined();
      expect((await db.get<Asset>('asset', site.id))?.status).toBe('active');

      const unblocked = recordProjectWorkflowTask(blocked, 'done', 'Resolved again', '2026-09-29T03:00:00.000Z');
      await db.saveTaskIfCurrent(blocked, unblocked);
      const approved = recordProjectWorkflowTask(decision, 'done', 'Close approved', '2026-09-29T03:01:00.000Z');
      await db.saveTaskIfCurrent(decision, approved);

      // Tab A opens the archive dialog; tab B blocks another prerequisite before confirmation.
      const blockedAgain = recordProjectWorkflowTask(resolved[1], 'blocked', 'Transfer failed', '2026-09-29T04:00:00.000Z');
      await otherTab.saveTaskIfCurrent(resolved[1], blockedAgain);
      await expect(db.archiveProjectIfWorkflowComplete(site, firstRoundId)).rejects.toThrow('workflow-stale');
      expect((await db.get<Asset>('asset', site.id))?.status).toBe('active');
      expect((await db.get<Task>('task', resolved[1].id))?.projectWorkflow?.record?.evidence).toBe('Transfer failed');

      const resolvedAgain = recordProjectWorkflowTask(blockedAgain, 'done', 'Transfer complete', '2026-09-29T05:00:00.000Z');
      await otherTab.saveTaskIfCurrent(blockedAgain, resolvedAgain);
      await otherTab.deleteEntity('task', initial[0].id);
      await expect(db.archiveProjectIfWorkflowComplete(site, firstRoundId)).rejects.toThrow('workflow-stale');
      await otherTab.restoreEntity('task', initial[0].id);
      const secondRoundId = crypto.randomUUID();
      const secondRound = makeRound(secondRoundId, '2026-09-29T06:00:00.000Z');
      await db.saveBatch(secondRound.map(value => ({ type: 'task' as const, value })));
      await expect(db.archiveProjectIfWorkflowComplete(site, firstRoundId)).rejects.toThrow('workflow-stale');
      expect((await db.get<Asset>('asset', site.id))?.status).toBe('active');
      for (const task of secondRound) {
        await db.saveTaskIfCurrent(task, recordProjectWorkflowTask(task, 'done', 'Second round complete', '2026-09-29T07:00:00.000Z'));
      }
      await expect(db.archiveProjectIfWorkflowComplete(site, secondRoundId)).resolves.toMatchObject({ type: 'asset' });
      expect((await db.get<Asset>('asset', site.id))?.status).toBe('archived');
    } finally { await db.close(); }
  });

  it('creates only one pending workflow checklist from concurrent attempts', async () => {
    const db = await openLocalRepository(name());
    try {
      const site = project('Concurrent site');
      await db.save('asset', site);
      const make = () => buildProjectWorkflowTasks({ project: site, assets: [site], relations: [], submissions: [], kind: 'brand', proposal: { proposedName: 'New name', proposedDescription: '', proposedUrl: '', changeNote: '' }, roundId: crypto.randomUUID(), at: new Date().toISOString(), title: step => step });
      const [first, second] = await Promise.allSettled([db.saveBatch(make().map(value => ({ type: 'task' as const, value }))), db.saveBatch(make().map(value => ({ type: 'task' as const, value })))]);
      expect([first, second].filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect([first, second].filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(await db.list<Task>('task')).toHaveLength(1);
    } finally { await db.close(); }
  });

  it('uses compare-and-save for collection preferences', async () => {
    const db = await openLocalRepository(name());
    try {
      const first = { id: 'collection-test', value: { name: 'First' } };
      await db.savePreferenceIfCurrent(null, first);
      await expect(db.savePreferenceIfCurrent(null, { ...first, value: { name: 'Duplicate' } })).rejects.toThrow('preference-stale');
      const old = await db.get<{ id: string; value: unknown }>('preference', first.id);
      if (!old) throw Error('preference-missing');
      await db.savePreferenceIfCurrent(old, { id: first.id, value: { name: 'Updated' } });
      await expect(db.savePreferenceIfCurrent(old, { id: first.id, value: { name: 'Stale' } })).rejects.toThrow('preference-stale');
      expect((await db.get<{ id: string; value: { name: string } }>('preference', first.id))?.value.name).toBe('Updated');
    } finally { await db.close(); }
  });

  it('rejects an image name that would make a later backup impossible', async () => {
    const db = await openLocalRepository(name());
    try {
      await expect(db.putFile(new File([new Uint8Array([1])], `${'a'.repeat(252)}.png`, { type: 'image/png' })))
        .rejects.toThrow('file-name');
      expect(await db.fileStore.blobs.count()).toBe(0);
      await expect(db.exportArchive()).resolves.toBeInstanceOf(Uint8Array);
    } finally { await db.close(); }
  });

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

  it('restores only the exact reviewed relation tombstone and rechecks endpoints', async () => {
    const db = await openLocalRepository(name());
    try {
      const from = project('Reviewed source');
      const to = { ...newAsset('account'), name: 'Reviewed target' };
      await db.save('asset', from);
      await db.save('asset', to);
      const reviewed = relationSchema.parse({ id: 'reviewed-restore', from: from.id, to: to.id, label: 'Login email', createdAt: '2026-10-22T00:00:00Z', deleted: true });
      await db.save('relation', reviewed);
      const edited = { ...reviewed, source: 'Changed after review' };
      await db.saveRelationIfCurrent(reviewed, edited);
      await expect(db.restoreRelationIfCurrent(reviewed)).rejects.toThrow('relation-stale');
      expect(await db.get('relation', reviewed.id)).toEqual(edited);
      await db.deleteEntity('asset', to.id);
      await expect(db.restoreRelationIfCurrent(edited)).rejects.toThrow('relation-endpoint');
      expect((await db.get<Relation>('relation', reviewed.id))?.deleted).toBe(true);
      await db.restoreEntity('asset', to.id);
      const result = await db.restoreRelationIfCurrent(edited);
      expect(JSON.parse(result.payload)).toEqual({ ...edited, deleted: false });
      await expect(db.restoreRelationIfCurrent({ ...edited, deleted: false })).rejects.toThrow('relation-stale');
      expect(await db.list('relation')).toHaveLength(1);
    } finally { await db.close(); }
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

  for (const mixedEntrypoints of [false, true]) {
    it(`keeps a committed stable identity and relation across two repository instances using ${mixedEntrypoints ? 'mixed batch entrypoints' : 'reviewed batches'}`, async () => {
      const dbName = name(), first = await openLocalRepository(dbName);
      const second = new LocalRepository(first.db, first.fileStore);
      // The existing same-process queue is not sufficient across tabs: assert both
      // repository wrappers also request the shared browser lock for this database.
      const request = vi.fn(async (_name: string, action: () => Promise<unknown>) => action());
      vi.stubGlobal('navigator', { ...globalThis.navigator, locks: { request } });
      const source = { ...newAsset('account'), name: 'Synthetic dependent account' };
      const identity = { ...newAsset('account'), id: `login-identity-${'a'.repeat(64)}`,
        name: 'Synthetic mailbox', username: 'synthetic@example.test', category: 'email' };
      const relation = relationSchema.parse({ id: `login-link-${'b'.repeat(64)}`, from: source.id, to: identity.id,
        label: 'Login email', source: identity.username, createdAt: new Date().toISOString() });
      const items = [{ type: 'asset' as const, value: identity }, { type: 'relation' as const, value: relation }];
      try {
        await first.save('asset', source);
        const attempts = await Promise.allSettled([
          mixedEntrypoints ? first.saveBatch(items) : first.saveBatchIfAssetsCurrent(items, [source]),
          second.saveBatchIfAssetsCurrent(items, [source]),
        ]);
        expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect((attempts.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('batch-existing');
        expect(await first.get<Asset>('asset', identity.id)).toEqual(identity);
        expect(await second.get<Relation>('relation', relation.id)).toEqual(relation);
        expect(await first.allRecords()).toHaveLength(3);
        expect(await first.fileStore.importJournal.count()).toBe(0);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request).toHaveBeenCalledWith(`keepany-batch:${dbName}`, expect.any(Function));
        await expect(second.saveBatchIfAssetsCurrent(items, [source])).rejects.toThrow('batch-existing');
        expect(await second.get<Asset>('asset', identity.id)).toEqual(identity);
        expect(await second.get<Relation>('relation', relation.id)).toEqual(relation);
        expect(await first.fileStore.importJournal.count()).toBe(0);
      } finally {
        await first.close();
        vi.unstubAllGlobals();
      }
      const reopened = await openLocalRepository(dbName);
      try {
        expect(await reopened.get<Asset>('asset', identity.id)).toEqual(identity);
        expect(await reopened.get<Relation>('relation', relation.id)).toEqual(relation);
        expect(await reopened.fileStore.importJournal.count()).toBe(0);
      } finally { await reopened.close(); }
    });
  }

  it('waits for the shared browser batch lock before recovering an interrupted import on open', async () => {
    const dbName = name(), interrupted = await openLocalRepository(dbName);
    const asset = project('Interrupted batch'), row: RecordRow = {
      id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now(),
    };
    await interrupted.fileStore.importJournal.put({ id: 'waiting-batch-recovery', rows: [row] });
    await interrupted.db.records.insert(row);
    await interrupted.close();
    let enter = () => {}, release = () => {};
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const request = vi.fn(async (lockName: string, action: () => Promise<unknown>) => {
      if (lockName === `keepany-batch:${dbName}`) { enter(); await held; }
      return action();
    });
    vi.stubGlobal('navigator', { ...globalThis.navigator, locks: { request } });
    let resolved = false;
    const opening = openLocalRepository(dbName).then(repository => { resolved = true; return repository; });
    try {
      await entered;
      expect(resolved).toBe(false);
      await interrupted.fileStore.open();
      expect(await interrupted.fileStore.importJournal.count()).toBe(1);
      release();
      const recovered = await opening;
      expect(await recovered.allRecords()).toHaveLength(0);
      expect(await recovered.fileStore.importJournal.count()).toBe(0);
      expect(request).toHaveBeenCalledWith(`keepany-batch:${dbName}`, expect.any(Function));
    } finally {
      release();
      await (await opening).close();
      interrupted.fileStore.close();
      vi.unstubAllGlobals();
    }
  });

  it('records one renewal under simultaneous calls, rejects the stale snapshot, and restores the exact pair from backup', async () => {
    const db = await openLocalRepository(name());
    const { expected, next, event } = renewalFixture();
    await db.save('asset', expected);
    const second = { ...event, id: crypto.randomUUID() };
    const results = await Promise.allSettled([
      db.recordRenewal(expected, next, event), db.recordRenewal(expected, { ...next, lastRenewalId: second.id }, second),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('renewal-stale');
    expect((await db.get<Asset>('asset', expected.id))?.dueDate).toBe(next.dueDate);
    const histories = await db.list<{ id: string }>('history');
    expect(histories).toHaveLength(1);
    expect([event.id, second.id]).toContain(histories[0].id);
    expect(await db.fileStore.renewalJournal.count()).toBe(0);
    const retry = { ...event, id: crypto.randomUUID() };
    await expect(db.recordRenewal(expected, { ...next, lastRenewalId: retry.id }, retry)).rejects.toThrow('renewal-stale');

    const archive = await db.exportArchive();
    const restored = await openLocalRepository(name());
    expect(await restored.restoreArchive(archive)).toBe(2);
    expect((await restored.get<Asset>('asset', expected.id))?.renewalCount).toBe(1);
    expect(await restored.list('history')).toEqual(histories);
    await restored.close();

    await db.deleteEntity('asset', expected.id);
    expect((await db.get<Asset>('asset', expected.id))?.deleted).toBe(true);
    expect(await db.list('history')).toEqual(histories);
    const deletedCopy = await openLocalRepository(name());
    await deletedCopy.restoreArchive(await db.exportArchive());
    expect((await deletedCopy.get<Asset>('asset', expected.id))?.deleted).toBe(true);
    expect(await deletedCopy.list('history')).toEqual(histories);
    await deletedCopy.close();
    await db.close();
  });

  it('removes an orphan history after a failed storage write before returning an error', async () => {
    const db = await openLocalRepository(name());
    const { expected, next, event } = renewalFixture();
    await db.save('asset', expected);
    const storage = db.db.records.storageInstance;
    const original = storage.bulkWrite.bind(storage);
    const write = vi.spyOn(storage, 'bulkWrite').mockImplementationOnce(async (rows, context) => {
      const inserted = await original([rows[1]], context);
      expect(inserted.error).toHaveLength(0);
      throw Error('injected-history-first');
    });
    await expect(db.recordRenewal(expected, next, event)).rejects.toThrow('injected-history-first');
    write.mockRestore();
    expect((await db.get<Asset>('asset', expected.id))?.dueDate).toBe(expected.dueDate);
    expect(await db.list('history')).toHaveLength(0);
    expect(await db.fileStore.renewalJournal.count()).toBe(0);
    await db.close();
  });

  it('keeps a concurrent external asset edit, cancels the orphan renewal, then permits retry and export', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const otherTab = new LocalRepository(db.db, db.fileStore);
    const { expected, next, event } = renewalFixture();
    await db.save('asset', expected);
    const storage = db.db.records.storageInstance;
    const original = storage.bulkWrite.bind(storage);
    const write = vi.spyOn(storage, 'bulkWrite').mockImplementationOnce(async (rows, context) => {
      expect(context).toBe('keepany-renewal');
      // Public writes share the pair's native gate. An older client can bypass
      // that gate; the storage CAS must still preserve its newer revision.
      const [raw] = await storage.findDocumentsById([`asset:${expected.id}`], false);
      const changed = await original([{ previous: raw, document: { ...raw,
        payload: JSON.stringify(assetSchema.parse({ ...expected, name: 'Concurrent rename' })), updatedAt: raw.updatedAt + 1 } }], 'external-test-edit');
      expect(changed.error).toEqual([]);
      return original(rows, context);
    });
    await expect(db.recordRenewal(expected, next, event)).rejects.toThrow('renewal-stale');
    write.mockRestore();
    const changed = await db.get<Asset>('asset', expected.id);
    expect(changed).toMatchObject({ name: 'Concurrent rename', dueDate: expected.dueDate,
      renewalCount: 0, lastRenewalId: expected.lastRenewalId });
    expect(await db.list('history')).toHaveLength(0);
    expect(await db.fileStore.renewalJournal.count()).toBe(0);
    await expect(db.exportArchive()).resolves.toBeInstanceOf(Uint8Array);

    if (!changed) throw Error('missing-renewal-fixture');
    const retryEvent = { ...event, id: crypto.randomUUID() };
    await otherTab.recordRenewal(changed, { ...changed, dueDate: next.dueDate,
      renewalCount: 1, lastRenewalId: retryEvent.id, updatedAt: new Date().toISOString() }, retryEvent);
    expect((await db.get<Asset>('asset', expected.id))?.name).toBe('Concurrent rename');
    expect((await db.get<Asset>('asset', expected.id))?.renewalCount).toBe(1);
    expect((await db.list<{ id: string }>('history')).map(row => row.id)).toEqual([retryEvent.id]);
    await expect(db.save('asset', { ...expected, name: 'Stale overwrite' })).rejects.toThrow('asset-stale-renewal');
    await db.close();
  });

  it('keeps a committed renewal after journal cleanup fails and another caller edits the asset', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const otherTab = new LocalRepository(db.db, db.fileStore);
    const { expected, next, event } = renewalFixture();
    await db.save('asset', expected);
    const deletion = vi.spyOn(db.fileStore.renewalJournal, 'delete').mockRejectedValueOnce(Error('injected-cleanup'));
    await db.recordRenewal(expected, next, event);
    deletion.mockRestore();
    expect(await db.fileStore.renewalJournal.count()).toBe(1);
    const committed = await otherTab.get<Asset>('asset', expected.id);
    if (!committed) throw Error('missing-renewal-fixture');
    await otherTab.save('asset', { ...committed, name: 'Renamed after renewal' });
    await otherTab.save('asset', { ...committed, name: 'Renamed after renewal',
      dueDate: '2026-07-31', billingAnchor: '2026-07-31', renewalCount: 0 });
    await db.close();

    const reopened = await openLocalRepository(dbName);
    expect(reopened.renewalRecoveryError).toBeNull();
    expect(await reopened.get<Asset>('asset', expected.id)).toMatchObject({ name: 'Renamed after renewal',
      dueDate: '2026-07-31', renewalCount: 0, lastRenewalId: event.id });
    expect((await reopened.list<{ id: string }>('history')).map(row => row.id)).toEqual([event.id]);
    expect(await reopened.fileStore.renewalJournal.count()).toBe(0);
    await expect(reopened.exportArchive()).resolves.toBeInstanceOf(Uint8Array);
    await reopened.close();
  });

  it('retains an ambiguous legacy journal without an operation marker for manual recovery', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const { expected, next, event } = renewalFixture();
    const original = await db.save('asset', expected);
    await db.fileStore.renewalJournal.add({ id: 'legacy-ambiguous', assetId: expected.id,
      expectedPayload: original.payload,
      next: { ...original, payload: JSON.stringify({ ...next, lastRenewalId: '' }) },
      history: { id: `history:${event.id}`, type: 'history', payload: JSON.stringify(event), updatedAt: Date.now() } });
    await db.save('asset', { ...expected, name: 'Another edit' });
    await db.close();

    const reopened = await openLocalRepository(dbName);
    expect(reopened.renewalRecoveryError).toBe('renewal-recovery-conflict');
    expect(await reopened.fileStore.renewalJournal.count()).toBe(1);
    expect((await reopened.get<Asset>('asset', expected.id))?.name).toBe('Another edit');
    await expect(reopened.exportArchive()).rejects.toThrow('renewal-recovery-pending');
    await reopened.close();
  });

  it('serializes export with an in-flight renewal and reopens with a settled journal', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const { expected, next, event } = renewalFixture();
    await db.save('asset', expected);
    let entered!: () => void;
    let release!: () => void;
    const atWrite = new Promise<void>(resolve => { entered = resolve; });
    const allowWrite = new Promise<void>(resolve => { release = resolve; });
    const storage = db.db.records.storageInstance;
    const original = storage.bulkWrite.bind(storage);
    const write = vi.spyOn(storage, 'bulkWrite').mockImplementationOnce(async (rows, context) => {
      entered();
      await allowWrite;
      return original(rows, context);
    });
    const pending = db.recordRenewal(expected, next, event);
    await atWrite;
    let exported = false;
    const exportPromise = new LocalRepository(db.db, db.fileStore).exportArchive().then(archive => { exported = true; return archive; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(exported).toBe(false);
    release();
    await pending;
    write.mockRestore();
    expect(await exportPromise).toBeInstanceOf(Uint8Array);
    await db.close();
    const reopened = await openLocalRepository(dbName);
    expect((await reopened.get<Asset>('asset', expected.id))?.renewalCount).toBe(1);
    expect((await reopened.list<{ id: string }>('history')).map(row => row.id)).toEqual([event.id]);
    expect(await reopened.fileStore.renewalJournal.count()).toBe(0);
    await reopened.close();
  });

  it('repairs a pending renewal journal on reopen without leaving a partial record', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const { expected, next, event } = renewalFixture();
    const original = await db.save('asset', expected);
    const nextRow: RecordRow = { ...original, payload: JSON.stringify(next) };
    const historyRow: RecordRow = { id: `history:${event.id}`, type: 'history',
      payload: JSON.stringify(event), updatedAt: Date.now() };
    await db.fileStore.renewalJournal.add({ id: 'interrupted-renewal', assetId: expected.id,
      expectedPayload: original.payload, next: nextRow, history: historyRow });
    await db.db.records.insert(historyRow);
    await db.close();

    const recovered = await openLocalRepository(dbName);
    expect(recovered.renewalRecoveryError).toBeNull();
    expect((await recovered.get<Asset>('asset', expected.id))?.renewalCount).toBe(0);
    expect(await recovered.list('history')).toHaveLength(0);
    expect(await recovered.fileStore.renewalJournal.count()).toBe(0);
    await recovered.close();
  });

  it('rolls forward an asset-only interrupted renewal to its matching history on reopen', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const { expected, next, event } = renewalFixture();
    const original = await db.save('asset', expected);
    const nextRow: RecordRow = { ...original, payload: JSON.stringify(next) };
    const historyRow: RecordRow = { id: `history:${event.id}`, type: 'history',
      payload: JSON.stringify(event), updatedAt: Date.now() };
    await db.fileStore.renewalJournal.add({ id: 'asset-only-renewal', assetId: expected.id,
      expectedPayload: original.payload, next: nextRow, history: historyRow });
    const current = await db.db.records.findOne(`asset:${expected.id}`).exec();
    if (!current) throw Error('missing-renewal-fixture');
    await current.incrementalModify((data: RecordRow) => ({ ...data, ...nextRow }));
    await db.close();

    const recovered = await openLocalRepository(dbName);
    expect(recovered.renewalRecoveryError).toBeNull();
    expect((await recovered.get<Asset>('asset', expected.id))?.renewalCount).toBe(1);
    expect(await recovered.list('history')).toEqual([event]);
    expect(await recovered.fileStore.renewalJournal.count()).toBe(0);
    await recovered.close();
  });

  it('records one active loan with its borrower, rejects repeated and stale actions, then clears the borrower on return', async () => {
    const db = await openLocalRepository(name());
    const otherTab = new LocalRepository(db.db, db.fileStore);
    const loan = itemFixture();
    await db.save('asset', loan.expected);
    const secondLoan = itemFixture(loan.expected);
    const results = await Promise.allSettled([
      db.recordItemAction(loan.expected, loan.next, loan.event),
      otherTab.recordItemAction(secondLoan.expected, secondLoan.next, secondLoan.event),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('item-stale');
    const committed = await db.get<Asset>('asset', loan.expected.id);
    expect(committed).toMatchObject({ status: 'loaned', borrower: 'Ada' });
    expect((await db.list<History>('history')).filter(event => event.action === 'loan')).toHaveLength(1);
    if (!committed) throw Error('missing-item');
    const repeatedLoan = itemFixture(committed);
    await expect(db.recordItemAction(repeatedLoan.expected, repeatedLoan.next, repeatedLoan.event))
      .rejects.toThrow('item-invalid');
    await expect(db.save('asset', { ...committed, status: 'active', borrower: '' })).rejects.toThrow('item-action-required');
    await expect(db.save('asset', { ...loan.expected, name: 'Stale direct edit' })).rejects.toThrow('item-stale');

    const returned = itemFixture(committed, 'return');
    await db.recordItemAction(returned.expected, returned.next, returned.event);
    expect(await db.get<Asset>('asset', committed.id)).toMatchObject({ status: 'active', borrower: '',
      lastItemEventId: returned.event.id });
    expect((await db.list<History>('history')).map(event => [event.action, event.borrower]))
      .toEqual(expect.arrayContaining([['loan', 'Ada'], ['return', 'Ada']]));
    const afterReturn = await db.get<Asset>('asset', committed.id);
    if (!afterReturn) throw Error('missing-returned-item');
    const repeated = itemFixture(afterReturn, 'return');
    await expect(db.recordItemAction(repeated.expected, repeated.next, repeated.event)).rejects.toThrow('item-invalid');
    expect(await db.list('history')).toHaveLength(2);
    expect(await db.fileStore.renewalJournal.count()).toBe(0);
    await db.close();
  });

  it('commits the expected return date with loan history and clears it atomically on return', async () => {
    const db = await openLocalRepository(name());
    const loan = itemFixture();
    await db.save('asset', loan.expected);
    const expectedReturnDate = '2026-10-10';
    await expect(db.recordItemAction(loan.expected, { ...loan.next, itemExpectedReturnDate: expectedReturnDate }, loan.event))
      .rejects.toThrow('item-invalid');
    expect((await db.get<Asset>('asset', loan.expected.id))?.itemExpectedReturnDate).toBe('');
    expect(await db.list('history')).toHaveLength(0);
    await db.recordItemAction(loan.expected, { ...loan.next, itemExpectedReturnDate: expectedReturnDate },
      { ...loan.event, expectedReturnDate });
    const current = await db.get<Asset>('asset', loan.expected.id);
    expect(current).toMatchObject({ status: 'loaned', borrower: 'Ada', itemExpectedReturnDate: expectedReturnDate });
    expect(await db.list<History>('history')).toMatchObject([{ action: 'loan', expectedReturnDate }]);
    if (!current) throw Error('missing-loaned-item');
    await expect(db.save('asset', { ...current, itemExpectedReturnDate: '2026-10-11' })).rejects.toThrow('item-action-required');
    const returned = itemFixture(current, 'return');
    await expect(db.recordItemAction(current, returned.next, returned.event)).rejects.toThrow();
    await db.recordItemAction(current, { ...returned.next, itemExpectedReturnDate: '' }, returned.event);
    expect(await db.get<Asset>('asset', current.id)).toMatchObject({ status: 'active', borrower: '', itemExpectedReturnDate: '' });
    expect((await db.list<History>('history')).map(row => row.action).sort()).toEqual(['loan', 'return']);
    await db.close();
  });

  it('validates item transitions before writing and keeps archive status CAS separate from loan history', async () => {
    const db = await openLocalRepository(name());
    const loan = itemFixture();
    await expect(db.save('asset', { ...newAsset('item'), status: 'loaned', borrower: 'Ada' }))
      .rejects.toThrow('item-action-required');
    await expect(db.saveBatch([{ type: 'asset', value: { ...newAsset('item'), status: 'loaned', borrower: 'Ada' } }]))
      .rejects.toThrow('item-action-required');
    await expect(db.save('asset', { ...newAsset('item'), status: 'archived' }))
      .rejects.toThrow('item-action-required');
    expect(await db.list('asset')).toHaveLength(0);
    await db.save('asset', loan.expected);
    const impossibleReturn = itemFixture(loan.expected, 'return');
    const invalid = [
      { next: { ...loan.next, borrower: '' }, event: loan.event },
      { next: loan.next, event: { ...loan.event, borrower: 'Someone else' } },
      { next: { ...loan.next, name: 'Unrelated edit' }, event: loan.event },
      { next: impossibleReturn.next, event: impossibleReturn.event },
      { next: { ...loan.next, status: 'archived' as const }, event: loan.event },
      { next: { ...loan.next, lastItemEventId: '' }, event: loan.event },
    ];
    for (const candidate of invalid) {
      await expect(db.recordItemAction(loan.expected, candidate.next, candidate.event)).rejects.toThrow('item-invalid');
    }
    const maintenance = itemFixture(loan.expected, 'maintenance');
    await expect(db.recordItemAction(maintenance.expected, maintenance.next,
      { ...maintenance.event, note: '' })).rejects.toThrow('item-invalid');
    await expect(db.recordItemAction(maintenance.expected, maintenance.next,
      { ...maintenance.event, eventDate: undefined })).rejects.toThrow('item-invalid');
    expect(await db.list('history')).toHaveLength(0);
    expect((await db.get<Asset>('asset', loan.expected.id))?.status).toBe('active');

    const archived = await db.setItemArchived(loan.expected.id, 'active');
    expect(archived.status).toBe('archived');
    await expect(db.setItemArchived(loan.expected.id, 'active')).rejects.toThrow('item-stale');
    const archivedLoan = itemFixture(archived);
    await expect(db.recordItemAction(archivedLoan.expected, archivedLoan.next, archivedLoan.event))
      .rejects.toThrow('item-invalid');
    const restored = await db.setItemArchived(loan.expected.id, 'archived');
    expect(restored.status).toBe('active');
    const freshLoan = itemFixture(restored);
    await db.recordItemAction(freshLoan.expected, freshLoan.next, freshLoan.event);
    await expect(db.setItemArchived(loan.expected.id, 'active')).rejects.toThrow('item-stale');
    await db.close();
  });

  it('cancels an orphan item history when an external asset edit wins the storage CAS', async () => {
    const db = await openLocalRepository(name());
    const otherTab = new LocalRepository(db.db, db.fileStore);
    const loan = itemFixture();
    await db.save('asset', loan.expected);
    const storage = db.db.records.storageInstance;
    const original = storage.bulkWrite.bind(storage);
    const write = vi.spyOn(storage, 'bulkWrite').mockImplementationOnce(async (rows, context) => {
      expect(context).toBe('keepany-item');
      const [raw] = await storage.findDocumentsById([`asset:${loan.expected.id}`], false);
      const changed = await original([{ previous: raw, document: { ...raw,
        payload: JSON.stringify(assetSchema.parse({ ...loan.expected, name: 'Renamed in another tab' })), updatedAt: raw.updatedAt + 1 } }], 'external-test-edit');
      expect(changed.error).toEqual([]);
      return original(rows, context);
    });
    await expect(db.recordItemAction(loan.expected, loan.next, loan.event)).rejects.toThrow('item-stale');
    write.mockRestore();
    expect(await db.get<Asset>('asset', loan.expected.id)).toMatchObject({ name: 'Renamed in another tab',
      status: 'active', borrower: '', lastItemEventId: '' });
    expect(await db.list('history')).toHaveLength(0);
    expect(await db.fileStore.renewalJournal.count()).toBe(0);
    await expect(db.exportArchive()).resolves.toBeInstanceOf(Uint8Array);
    const fresh = await db.get<Asset>('asset', loan.expected.id);
    if (!fresh) throw Error('missing-item');
    const retried = itemFixture(fresh);
    await otherTab.recordItemAction(retried.expected, retried.next, retried.event);
    expect((await db.get<Asset>('asset', fresh.id))?.name).toBe('Renamed in another tab');
    expect((await db.list<History>('history')).map(row => row.id)).toEqual([retried.event.id]);
    await db.close();
  });

  it('recovers either interrupted item row order without inventing a second loan', async () => {
    for (const firstRow of ['asset', 'history'] as const) {
      const dbName = name();
      const db = await openLocalRepository(dbName);
      const loan = itemFixture();
      const original = await db.save('asset', loan.expected);
      const nextRow: RecordRow = { ...original, payload: JSON.stringify(loan.next) };
      const historyRow: RecordRow = { id: `history:${loan.event.id}`, type: 'history',
        payload: JSON.stringify(loan.event), updatedAt: Date.now() };
      await db.fileStore.renewalJournal.add({ id: `interrupted-${firstRow}`, assetId: loan.expected.id,
        expectedPayload: original.payload, next: nextRow, history: historyRow });
      if (firstRow === 'asset') {
        const current = await db.db.records.findOne(original.id).exec();
        if (!current) throw Error('missing-item');
        await current.incrementalModify((data: RecordRow) => ({ ...data, ...nextRow }));
      } else await db.db.records.insert(historyRow);
      await db.close();

      const recovered = await openLocalRepository(dbName);
      expect(recovered.renewalRecoveryError).toBeNull();
      expect(await recovered.fileStore.renewalJournal.count()).toBe(0);
      if (firstRow === 'asset') {
        expect(await recovered.get<Asset>('asset', loan.expected.id)).toMatchObject({ status: 'loaned',
          borrower: 'Ada', lastItemEventId: loan.event.id });
        expect((await recovered.list<History>('history')).map(event => event.id)).toEqual([loan.event.id]);
      } else {
        expect(await recovered.get<Asset>('asset', loan.expected.id)).toMatchObject({ status: 'active',
          borrower: '', lastItemEventId: '' });
        expect(await recovered.list('history')).toHaveLength(0);
      }
      await recovered.close();
    }
  });

  it('keeps a committed item event after journal cleanup fails and the asset is edited, deleted, restored and backed up', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const otherTab = new LocalRepository(db.db, db.fileStore);
    const loan = itemFixture();
    await db.save('asset', loan.expected);
    const deletion = vi.spyOn(db.fileStore.renewalJournal, 'delete').mockRejectedValueOnce(Error('injected-cleanup'));
    await db.recordItemAction(loan.expected, loan.next, loan.event);
    deletion.mockRestore();
    expect(await db.fileStore.renewalJournal.count()).toBe(1);
    const committed = await otherTab.get<Asset>('asset', loan.expected.id);
    if (!committed) throw Error('missing-item');
    await otherTab.save('asset', { ...committed, name: 'Later rename', location: 'Shelf B' });
    await db.close();

    const reopened = await openLocalRepository(dbName);
    expect(reopened.renewalRecoveryError).toBeNull();
    expect(await reopened.fileStore.renewalJournal.count()).toBe(0);
    expect(await reopened.get<Asset>('asset', loan.expected.id)).toMatchObject({ name: 'Later rename',
      location: 'Shelf B', status: 'loaned', borrower: 'Ada', lastItemEventId: loan.event.id });
    expect((await reopened.list<History>('history')).map(event => event.id)).toEqual([loan.event.id]);
    await reopened.deleteEntity('asset', loan.expected.id);
    expect((await reopened.get<Asset>('asset', loan.expected.id))?.deleted).toBe(true);
    expect(await reopened.list('history')).toHaveLength(1);
    await reopened.restoreEntity('asset', loan.expected.id);
    const archive = await reopened.exportArchive();
    const restored = await openLocalRepository(name());
    expect(await restored.restoreArchive(archive)).toBe(2);
    expect(await restored.get<Asset>('asset', loan.expected.id)).toEqual(await reopened.get<Asset>('asset', loan.expected.id));
    expect(await restored.list('history')).toEqual(await reopened.list('history'));
    await restored.close();
    await reopened.close();
  });

  it('journals item status with CAS and keeps loans, maintenance, archive and purchase price separate', async () => {
    const db = await openLocalRepository(name());
    const otherTab = new LocalRepository(db.db, db.fileStore);
    try {
      const item = { ...newAsset('item'), name: 'Camera', amount: 1234, currency: 'USD' as const,
        itemPurchasePriceKnown: true, itemStartDate: '2026-09-01', itemWarrantyStatus: 'inWarranty' as const };
      await db.save('asset', item);
      await expect(db.save('asset', { ...item, itemLifecycleStatus: 'resold' })).rejects.toThrow('item-action-required');
      await expect(db.save('asset', { ...item, itemStatusDate: '2026-09-29' })).rejects.toThrow('item-action-required');
      await expect(db.save('asset', { ...item, kind: 'subscription', itemLifecycleStatus: 'resold' })).rejects.toThrow('asset-kind-immutable');
      await expect(db.save('asset', { ...newAsset('item'), itemLifecycleStatus: 'resold' })).rejects.toThrow('item-action-required');
      const idle = itemStatusFixture(item, 'idle');
      const repairing = itemStatusFixture(item, 'repairing');
      const results = await Promise.allSettled([
        db.recordItemAction(idle.expected, idle.next, idle.event),
        otherTab.recordItemAction(repairing.expected, repairing.next, repairing.event),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('item-stale');
      const committed = await db.get<Asset>('asset', item.id);
      if (!committed) throw Error('missing-item');
      expect(committed).toMatchObject({ amount: 1234, currency: 'USD', itemPurchasePriceKnown: true,
        itemStartDate: '2026-09-01', itemWarrantyStatus: 'inWarranty', itemStatusDate: '2026-09-29' });
      expect((await db.list<History>('history')).filter(row => row.action === 'itemStatus')).toHaveLength(1);
      await expect(db.recordItemAction(idle.expected, idle.next, idle.event)).rejects.toThrow('item-stale');
      const repair = itemStatusFixture(committed, 'repairing', '2026-09-30');
      await db.recordItemAction(repair.expected, repair.next, repair.event);
      const underRepair = await db.get<Asset>('asset', item.id);
      if (!underRepair) throw Error('missing-item');
      const blockedLoan = itemFixture(underRepair);
      await expect(db.recordItemAction(blockedLoan.expected, blockedLoan.next, blockedLoan.event)).rejects.toThrow('item-invalid');
      const service = itemFixture(underRepair, 'maintenance');
      await db.recordItemAction(service.expected, service.next, service.event);
      const serviced = await db.get<Asset>('asset', item.id);
      if (!serviced) throw Error('missing-item');
      const inUse = itemStatusFixture(serviced, 'inUse', '2026-10-01');
      await db.recordItemAction(inUse.expected, inUse.next, inUse.event);
      const loanable = await db.get<Asset>('asset', item.id);
      if (!loanable) throw Error('missing-item');
      const loan = itemFixture(loanable);
      await db.recordItemAction(loan.expected, loan.next, loan.event);
      const lent = await db.get<Asset>('asset', item.id);
      if (!lent) throw Error('missing-item');
      const blockedSale = itemStatusFixture(lent, 'resold', '2026-10-02');
      await expect(db.recordItemAction(blockedSale.expected, blockedSale.next, blockedSale.event)).rejects.toThrow('item-invalid');
      const returned = itemFixture(lent, 'return');
      await db.recordItemAction(returned.expected, returned.next, returned.event);
      const available = await db.get<Asset>('asset', item.id);
      if (!available) throw Error('missing-item');
      const sold = itemStatusFixture(available, 'resold', '2026-10-03');
      await db.recordItemAction(sold.expected, sold.next, sold.event);
      const disposed = await db.get<Asset>('asset', item.id);
      if (!disposed) throw Error('missing-item');
      const disposedLoan = itemFixture(disposed);
      await expect(db.recordItemAction(disposedLoan.expected, disposedLoan.next, disposedLoan.event)).rejects.toThrow('item-invalid');
      expect((await db.setItemArchived(item.id, 'active')).status).toBe('archived');
      expect((await db.get<Asset>('asset', item.id))?.itemLifecycleStatus).toBe('resold');
      const archive = await db.exportArchive();
      const restored = await openLocalRepository(name());
      try {
        expect(await restored.restoreArchive(archive)).toBe(8);
        expect(await restored.get<Asset>('asset', item.id)).toMatchObject({ itemLifecycleStatus: 'resold',
          itemStatusDate: '2026-10-03', itemPurchasePriceKnown: true, amount: 1234, status: 'archived' });
        expect((await restored.list<History>('history')).filter(row => row.action === 'itemStatus')).toHaveLength(4);
      } finally { await restored.close(); }
    } finally { await db.close(); }
  });

  it('removes orphan item status history after an injected partial storage failure', async () => {
    const db = await openLocalRepository(name());
    try {
      const item = { ...newAsset('item'), name: 'Desk' };
      await db.save('asset', item);
      const status = itemStatusFixture(item, 'idle');
      const storage = db.db.records.storageInstance;
      const original = storage.bulkWrite.bind(storage);
      const write = vi.spyOn(storage, 'bulkWrite').mockImplementationOnce(async (rows, context) => {
        expect(context).toBe('keepany-item');
        const inserted = await original([rows[1]], context);
        expect(inserted.error).toHaveLength(0);
        throw Error('injected-status-history-first');
      });
      await expect(db.recordItemAction(status.expected, status.next, status.event)).rejects.toThrow('injected-status-history-first');
      write.mockRestore();
      expect(await db.get<Asset>('asset', item.id)).toMatchObject({ itemLifecycleStatus: 'inUse', itemStatusDate: '' });
      expect(await db.list('history')).toHaveLength(0);
      expect(await db.fileStore.renewalJournal.count()).toBe(0);
    } finally { await db.close(); }
  });

  it('restores a legacy item archive without inventing lifecycle or a zero purchase price', async () => {
    const source = await openLocalRepository(name());
    const item = { ...newAsset('item'), name: 'Legacy camera', amount: 3456, currency: 'USD' as const };
    try {
      await source.save('asset', item);
      const archive = await changedArchive(await source.exportArchive(), (_entries, _manifest, rows) => {
        const row = rows.find(candidate => candidate.id === `asset:${item.id}`);
        if (!row) throw Error('missing-legacy-item');
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        for (const field of ['itemPurchasePriceKnown', 'itemLifecycleStatus', 'itemWarrantyStatus', 'itemStartDate', 'itemStatusDate']) delete payload[field];
        payload.status = 'archived';
        row.payload = JSON.stringify(payload);
      });
      const restored = await openLocalRepository(name());
      try {
        expect(await restored.restoreArchive(archive)).toBe(1);
        expect(await restored.get<Asset>('asset', item.id)).toMatchObject({ status: 'archived', amount: 3456,
          currency: 'USD', itemPurchasePriceKnown: true, itemLifecycleStatus: null, itemWarrantyStatus: null,
          itemStartDate: '', itemStatusDate: '' });
        expect(await restored.list('history')).toHaveLength(0);
      } finally { await restored.close(); }
    } finally { await source.close(); }
  });

  it('deduplicates pending item reminders and preserves every task completion after reopen and retry', async () => {
    const dbName = name();
    const db = await openLocalRepository(dbName);
    const otherTab = new LocalRepository(db.db, db.fileStore);
    const item = itemFixture().expected;
    await db.save('asset', item);
    const task: Task = { id: crypto.randomUUID(), name: 'Service camera', assetId: item.id,
      dueDate: '2026-10-31', done: false, completedAt: '', completionHistory: [],
      createdAt: new Date().toISOString(), dedupeKey: `item:${item.id}:maintenance:2026-10-31`, deleted: false };
    const other = { ...task, id: crypto.randomUUID() };
    const inserted = await Promise.allSettled([db.save('task', task), otherTab.save('task', other)]);
    expect(inserted.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((inserted.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('task-duplicate');
    const stored = (await db.list<Task>('task'))[0];
    const completes = await Promise.allSettled([
      db.setTaskDone(stored.id, false), otherTab.setTaskDone(stored.id, false),
    ]);
    expect(completes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((completes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('task-stale');
    const first = await db.get<Task>('task', stored.id);
    expect(first?.done).toBe(true);
    expect(first?.completionHistory).toHaveLength(1);
    expect(first?.completedAt).toBe(first?.completionHistory[0]);
    await expect(db.setTaskDone(stored.id, false)).rejects.toThrow('task-stale');
    const reopenedTask = await db.setTaskDone(stored.id, true);
    expect(reopenedTask).toMatchObject({ done: false, completedAt: '' });
    expect(reopenedTask.completionHistory).toEqual(first?.completionHistory);
    const second = await otherTab.setTaskDone(stored.id, false);
    expect(second.completionHistory).toHaveLength(2);
    expect(second.completedAt).toBe(second.completionHistory[1]);
    await db.close();

    const reopened = await openLocalRepository(dbName);
    expect(await reopened.get<Task>('task', stored.id)).toMatchObject({ done: true,
      dueDate: '2026-10-31', completionHistory: second.completionHistory });
    // Completed reminders no longer suppress a new pending reminder on the same date.
    await reopened.save('task', { ...task, id: crypto.randomUUID() });
    expect((await reopened.list<Task>('task')).filter(value => !value.done)).toHaveLength(1);
    await expect(reopened.setTaskDone(stored.id, true)).rejects.toThrow('task-duplicate');
    expect((await reopened.get<Task>('task', stored.id))?.completionHistory).toEqual(second.completionHistory);
    await reopened.close();
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
