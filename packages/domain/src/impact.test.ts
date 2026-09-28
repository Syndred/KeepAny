import { describe, expect, it } from 'vitest';
import { assetSchema, newAsset, relationSchema, taskSchema, type Asset, type Relation, type Task } from './index';
import { buildImpactTasks, uncoveredImpactRelationIds, upgradeLegacyImpactTasks } from './impact';

const at = '2026-09-29T02:00:00.000Z';
const makeName = (related: Asset) => `Check connection: ${related.name}`;
const asset = (kind: Asset['kind'], id: string, name: string) =>
  assetSchema.parse({ ...newAsset(kind), id, name });
const relation = (id: string, from: Asset, to: Asset, label: string, source?: string): Relation =>
  relationSchema.parse({ id, from: from.id, to: to.id, label, source, createdAt: at, verifiedAt: '2026-09-25', deleted: false });

describe('account rebinding impact tasks', () => {
  it('keeps both directions and source evidence in per-relation snapshots without repeating completed tasks', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Workspace');
    const service = asset('subscription', 'service-1', 'Service');
    const incoming = relation('relation-in', project, account, 'admin of', 'contract');
    const outgoing = relation('relation-out', account, service, 'signs in to');
    const tasks = buildImpactTasks(account, [incoming, outgoing], [account, project, service], [], at, makeName);
    expect(tasks.map(task => task.dedupeKey)).toEqual(['impact:account-1:relation-in', 'impact:account-1:relation-out']);
    expect(tasks[0]?.impactSnapshot).toMatchObject({
      accountId: account.id, relationId: incoming.id, relatedAssetId: project.id,
      fromAssetId: project.id, toAssetId: account.id, fromName: project.name, toName: account.name,
      label: incoming.label, source: 'contract', verifiedAt: '2026-09-25', generatedAt: at,
    });
    expect(tasks[1]?.impactSnapshot).toMatchObject({
      fromAssetId: account.id, toAssetId: service.id, source: '', relatedName: service.name,
    });
    expect(tasks.every(task => task.assetId === account.id && task.completionHistory.length === 0)).toBe(true);
    const completed = { ...taskSchema.parse(tasks[0]), done: true, completedAt: at, completionHistory: [at] };
    const outgoingTask = taskSchema.parse(tasks[1]);
    expect(buildImpactTasks(account, [incoming, outgoing], [account, project, service], [completed, outgoingTask], at, makeName)).toEqual([]);
    expect(uncoveredImpactRelationIds(account, [incoming, outgoing], [account, project, service], [completed, outgoingTask])).toEqual([]);
  });

  it('uses stable IDs for same-name assets and preserves separate labels on one neighbor', () => {
    const account = asset('account', 'account-1', 'Email account');
    const first = asset('project', 'project-1', 'Same name');
    const second = asset('project', 'project-2', 'Same name');
    const relations = [
      relation('relation-1', account, first, 'owner', 'document A'),
      relation('relation-2', account, first, 'login', 'document B'),
      relation('relation-3', account, second, 'member', 'document C'),
    ];
    const tasks = buildImpactTasks(account, relations, [account, first, second], [], at, makeName);
    expect(tasks).toHaveLength(3);
    expect(new Set(tasks.map(task => task.dedupeKey)).size).toBe(3);
    expect(tasks.map(task => task.impactSnapshot?.relatedAssetId)).toEqual([first.id, first.id, second.id]);
    expect(tasks.map(task => task.impactSnapshot?.label)).toEqual(['owner', 'login', 'member']);
    expect(tasks.map(task => task.impactSnapshot?.source)).toEqual(['document A', 'document B', 'document C']);
    expect(buildImpactTasks(account, relations, [account, first, second], tasks, at, makeName)).toEqual([]);
  });

  it('keeps old snapshots after relation deletion and rename, reuses them on restore, and adds only new relations', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Original project');
    const original = relation('relation-1', account, project, 'owner', 'original source');
    const tasks = buildImpactTasks(account, [original], [account, project], [], at, makeName);
    const completed = { ...taskSchema.parse(tasks[0]), done: true, completedAt: at, completionHistory: [at] };
    expect(uncoveredImpactRelationIds(account, [{ ...original, deleted: true }], [account, project], [completed])).toEqual([]);
    expect(buildImpactTasks(account, [original], [account, { ...project, name: 'Renamed project' }], [completed], at, makeName)).toEqual([]);
    expect(completed.impactSnapshot?.relatedName).toBe('Original project');
    expect(completed.impactSnapshot?.source).toBe('original source');
    const added = relation('relation-2', account, project, 'billing', 'new source');
    expect(uncoveredImpactRelationIds(account, [original, added], [account, project], [completed])).toEqual([added.id]);
    expect(buildImpactTasks(account, [original, added], [account, project], [completed], at, makeName).map(task => task.dedupeKey))
      .toEqual(['impact:account-1:relation-2']);
    expect(buildImpactTasks(account, [original, added], [account, { ...project, deleted: true }], [completed], at, makeName)).toEqual([]);
  });

  it('recognizes a legacy neighbor task only for a single live relation to that neighbor', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Project');
    const first = relation('relation-1', account, project, 'owner');
    const legacy = taskSchema.parse({ id: 'legacy-task', name: 'Check connection', assetId: project.id,
      createdAt: at, dedupeKey: `impact:${account.id}:${project.id}`, done: true, completedAt: at });
    expect(buildImpactTasks(account, [first], [account, project], [legacy], at, makeName)).toEqual([]);
    const second = relation('relation-2', account, project, 'login');
    expect(buildImpactTasks(account, [first, second], [account, project], [legacy], at, makeName).map(task => task.impactSnapshot?.relationId))
      .toEqual([first.id, second.id]);
  });

  it('upgrades an unambiguous legacy task without changing its ID, dates, completion state or past completions', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Project');
    const link = relation('relation-1', project, account, 'admin of', 'signed note');
    const originalCreatedAt = '2026-09-20T01:00:00.000Z';
    const originalCompletedAt = '2026-09-22T01:00:00.000Z';
    const legacy = taskSchema.parse({ id: 'legacy-task', name: 'Original reminder', assetId: project.id,
      dueDate: '2026-10-01', createdAt: originalCreatedAt, dedupeKey: `impact:${account.id}:${project.id}`,
      done: true, completedAt: originalCompletedAt });
    const [upgraded] = upgradeLegacyImpactTasks(account, [link], [account, project], [legacy], at);
    expect(upgraded).toMatchObject({ id: legacy.id, name: legacy.name, assetId: account.id,
      dueDate: legacy.dueDate, createdAt: originalCreatedAt, done: true,
      completedAt: originalCompletedAt, dedupeKey: `impact:${account.id}:${link.id}`,
      completionHistory: [originalCompletedAt],
      impactSnapshot: { relationId: link.id, relatedAssetId: project.id, fromAssetId: project.id,
        toAssetId: account.id, label: 'admin of', source: 'signed note', generatedAt: at },
    });
    expect(legacy.impactSnapshot).toBeUndefined();
    expect(upgradeLegacyImpactTasks(account, [link], [account, project], [upgraded], at)).toEqual([]);
    expect(buildImpactTasks(account, [link], [account, project], [upgraded], at, makeName)).toEqual([]);
  });

  it('upgrades a raw legacy RxDB payload that has no completionHistory field', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Project');
    const link = relation('relation-1', account, project, 'owner');
    const completedAt = '2026-09-21T00:00:00.000Z';
    const rawLegacy = JSON.parse(JSON.stringify({
      id: 'old-raw', name: 'Old checklist', assetId: project.id, createdAt: at,
      dedupeKey: `impact:${account.id}:${project.id}`, dueDate: '', done: true,
      completedAt, deleted: false,
    })) as Task;
    expect(rawLegacy.completionHistory).toBeUndefined();
    const [upgraded] = upgradeLegacyImpactTasks(account, [link], [account, project], [rawLegacy], at);
    expect(upgraded.id).toBe(rawLegacy.id);
    expect(upgraded.completionHistory).toEqual([completedAt]);
  });

  it('does not assign a legacy completion to one of multiple current relations', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Project');
    const first = relation('relation-1', account, project, 'owner');
    const second = relation('relation-2', account, project, 'login');
    const legacy = taskSchema.parse({ id: 'legacy-task', name: 'Old task', assetId: project.id,
      createdAt: at, dedupeKey: `impact:${account.id}:${project.id}`, done: true, completedAt: at });
    expect(upgradeLegacyImpactTasks(account, [first, second], [account, project], [legacy], at)).toEqual([]);
    expect(buildImpactTasks(account, [first, second], [account, project], [legacy], at, makeName)).toHaveLength(2);
  });

  it('uses the newest live legacy task while preserving older completion timestamps', () => {
    const account = asset('account', 'account-1', 'Email account');
    const project = asset('project', 'project-1', 'Project');
    const link = relation('relation-1', account, project, 'owner');
    const key = `impact:${account.id}:${project.id}`;
    const older = taskSchema.parse({ id: 'old-completed', name: 'Check', assetId: project.id, createdAt: '2026-09-20T00:00:00.000Z',
      dedupeKey: key, done: true, completedAt: '2026-09-21T00:00:00.000Z' });
    const newer = taskSchema.parse({ id: 'new-pending', name: 'Check', assetId: project.id, createdAt: '2026-09-22T00:00:00.000Z',
      dedupeKey: key, dueDate: '2026-09-30', completionHistory: ['2026-09-21T00:00:00.000Z'] });
    const [upgraded] = upgradeLegacyImpactTasks(account, [link], [account, project], [older, newer], at);
    expect(upgraded.id).toBe(newer.id);
    expect(upgraded.done).toBe(false);
    expect(upgraded.dueDate).toBe(newer.dueDate);
    expect(upgraded.completionHistory).toEqual(['2026-09-21T00:00:00.000Z']);
    expect(upgradeLegacyImpactTasks(account, [{ ...link, deleted: true }], [account, project], [older, newer], at)).toEqual([]);
  });

  it('parses old task records and archives without impact fields and preserves completed history when present', () => {
    const oldTask = taskSchema.parse({ id: 'old', name: 'Original task', createdAt: at, done: true, completedAt: at });
    expect(oldTask.completionHistory).toEqual([]);
    expect(oldTask.impactSnapshot).toBeUndefined();
    const archived = JSON.parse(JSON.stringify(oldTask)) as Task;
    expect(taskSchema.parse(archived)).toEqual(oldTask);
    const history = taskSchema.parse({ ...oldTask, completionHistory: [at, '2026-09-30T02:00:00.000Z'] });
    expect(history.completionHistory).toHaveLength(2);
    expect(taskSchema.safeParse({ ...oldTask, completionHistory: ['x'.repeat(65)] }).success).toBe(false);
  });
});
