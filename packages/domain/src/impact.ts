import { type Asset, type ImpactSnapshot, type Relation, type Task, taskSchema } from './index';

export type ImpactTaskName = (relatedAsset: Asset, relation: Relation) => string;

function currentAccountRelations(account: Asset, relations: Relation[], assets: Asset[]) {
  if (account.kind !== 'account' || account.deleted) return [];
  const activeAssets = new Map(assets.filter(asset => !asset.deleted).map(asset => [asset.id, asset]));
  if (!activeAssets.has(account.id)) return [];
  return relations.flatMap(relation => {
    if (relation.deleted || (relation.from !== account.id && relation.to !== account.id)) return [];
    const from = activeAssets.get(relation.from);
    const to = activeAssets.get(relation.to);
    if (!from || !to || from.id === to.id) return [];
    return [{ relation, from, to, related: from.id === account.id ? to : from }];
  });
}

type CurrentRelation = ReturnType<typeof currentAccountRelations>[number];

function snapshotFor(account: Asset, { relation, from, to, related }: CurrentRelation, at: string): ImpactSnapshot {
  return {
    accountId: account.id, relationId: relation.id, relatedAssetId: related.id,
    fromAssetId: from.id, toAssetId: to.id, fromName: from.name, toName: to.name,
    relatedName: related.name, label: relation.label, source: relation.source ?? '',
    verifiedAt: relation.verifiedAt, generatedAt: at,
  };
}

function legacyAssignment(account: Asset, row: CurrentRelation, allRelations: Relation[], tasks: Task[], countByRelated: Map<string, number>) {
  if (countByRelated.get(row.related.id) !== 1) return null;
  const key = `impact:${account.id}:${row.related.id}`;
  // A prior snapshot, including a deleted one, makes the remaining neighbor-keyed
  // history unsafe to assign again. An upgrade records its legacy key there.
  if (tasks.some(task => task.impactSnapshot?.legacyDedupeKey === key ||
    (task.impactSnapshot?.accountId === account.id && task.impactSnapshot.relatedAssetId === row.related.id))) return null;
  const historical = allRelations.filter(relation =>
    (relation.from === account.id && relation.to === row.related.id) ||
    (relation.to === account.id && relation.from === row.related.id));
  // One currently live relationship is insufficient: a deleted old relationship
  // may have been the one checked by the neighbor-keyed task.
  if (historical.length !== 1 || historical[0].id !== row.relation.id) return null;
  const legacy = tasks
    .filter(task => !task.deleted && !task.impactSnapshot && task.dedupeKey === key)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const relationTime = Date.parse(row.relation.createdAt);
  if (!legacy.length || !Number.isFinite(relationTime) ||
    legacy.some(task => !Number.isFinite(Date.parse(task.createdAt)) || Date.parse(task.createdAt) < relationTime)) return null;
  return { key, legacy };
}

function coveredRelationIds(account: Asset, rows: ReturnType<typeof currentAccountRelations>, allRelations: Relation[], tasks: Task[]) {
  const countByRelated = new Map<string, number>();
  for (const row of rows) countByRelated.set(row.related.id, (countByRelated.get(row.related.id) ?? 0) + 1);
  return new Set(rows.filter(row =>
    tasks.some(task => !task.deleted && task.impactSnapshot?.accountId === account.id &&
      task.impactSnapshot.relationId === row.relation.id && task.dedupeKey === `impact:${account.id}:${row.relation.id}`) ||
    legacyAssignment(account, row, allRelations, tasks, countByRelated) !== null
  ).map(row => row.relation.id));
}

/** Current recorded relations missing a live checklist task, including after relation restore or additions. */
export function uncoveredImpactRelationIds(account: Asset, liveRelations: Relation[], liveAssets: Asset[], existingTasks: Task[]) {
  const rows = currentAccountRelations(account, liveRelations, liveAssets);
  const covered = coveredRelationIds(account, rows, liveRelations, existingTasks);
  return rows.filter(row => !covered.has(row.relation.id)).map(row => row.relation.id);
}

/** Upgrades one unambiguous legacy neighbor task in place. Other legacy tasks remain as historical records. */
export function upgradeLegacyImpactTasks(account: Asset, liveRelations: Relation[], liveAssets: Asset[], existingTasks: Task[], at: string): Task[] {
  const rows = currentAccountRelations(account, liveRelations, liveAssets);
  const countByRelated = new Map<string, number>();
  for (const row of rows) countByRelated.set(row.related.id, (countByRelated.get(row.related.id) ?? 0) + 1);
  return rows.flatMap(row => {
    const relationKey = `impact:${account.id}:${row.relation.id}`;
    if (existingTasks.some(task => !task.deleted && task.impactSnapshot?.accountId === account.id &&
      task.impactSnapshot.relationId === row.relation.id && task.dedupeKey === relationKey)) return [];
    const assignment = legacyAssignment(account, row, liveRelations, existingTasks, countByRelated);
    if (!assignment) return [];
    const current = assignment.legacy[0];
    const completionHistory = [...new Set(assignment.legacy.flatMap(task => [
      ...(task.completionHistory ?? []), ...(task.completedAt ? [task.completedAt] : []),
    ]))].sort();
    return [taskSchema.parse({
      ...current, assetId: account.id, dedupeKey: relationKey,
      impactSnapshot: { ...snapshotFor(account, row, at), legacyDedupeKey: assignment.key }, completionHistory,
    })];
  });
}

/** Creates one immutable evidence snapshot per currently recorded relation. Existing completed tasks still cover their relation. */
export function buildImpactTasks(account: Asset, liveRelations: Relation[], liveAssets: Asset[], existingTasks: Task[], at: string, makeName: ImpactTaskName): Task[] {
  const rows = currentAccountRelations(account, liveRelations, liveAssets);
  const covered = coveredRelationIds(account, rows, liveRelations, existingTasks);
  const seen = new Set<string>();
  return rows.flatMap(({ relation, from, to, related }) => {
    if (covered.has(relation.id) || seen.has(relation.id)) return [];
    seen.add(relation.id);
    return [taskSchema.parse({
      id: crypto.randomUUID(), name: makeName(related, relation), assetId: account.id,
      dueDate: '', done: false, completedAt: '', createdAt: at,
      dedupeKey: `impact:${account.id}:${relation.id}`, deleted: false,
      impactSnapshot: snapshotFor(account, { relation, from, to, related }, at),
    })];
  });
}
