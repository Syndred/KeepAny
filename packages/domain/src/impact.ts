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

function coveredRelationIds(account: Asset, rows: ReturnType<typeof currentAccountRelations>, tasks: Task[]) {
  const existingKeys = new Set(tasks.filter(task => !task.deleted).map(task => task.dedupeKey));
  const countByRelated = new Map<string, number>();
  for (const row of rows) countByRelated.set(row.related.id, (countByRelated.get(row.related.id) ?? 0) + 1);
  return new Set(rows.filter(row =>
    existingKeys.has(`impact:${account.id}:${row.relation.id}`) ||
    (countByRelated.get(row.related.id) === 1 && existingKeys.has(`impact:${account.id}:${row.related.id}`))
  ).map(row => row.relation.id));
}

/** Current recorded relations missing a live checklist task, including after relation restore or additions. */
export function uncoveredImpactRelationIds(account: Asset, liveRelations: Relation[], liveAssets: Asset[], existingTasks: Task[]) {
  const rows = currentAccountRelations(account, liveRelations, liveAssets);
  const covered = coveredRelationIds(account, rows, existingTasks);
  return rows.filter(row => !covered.has(row.relation.id)).map(row => row.relation.id);
}

/** Upgrades one unambiguous legacy neighbor task in place. Other legacy tasks remain as historical records. */
export function upgradeLegacyImpactTasks(account: Asset, liveRelations: Relation[], liveAssets: Asset[], existingTasks: Task[], at: string): Task[] {
  const rows = currentAccountRelations(account, liveRelations, liveAssets);
  const countByRelated = new Map<string, number>();
  for (const row of rows) countByRelated.set(row.related.id, (countByRelated.get(row.related.id) ?? 0) + 1);
  return rows.flatMap(row => {
    if (countByRelated.get(row.related.id) !== 1) return [];
    const relationKey = `impact:${account.id}:${row.relation.id}`;
    const legacyKey = `impact:${account.id}:${row.related.id}`;
    if (existingTasks.some(task => !task.deleted && task.dedupeKey === relationKey &&
      (relationKey !== legacyKey || task.impactSnapshot?.relationId === row.relation.id))) return [];
    const legacy = existingTasks
      .filter(task => !task.deleted && !task.impactSnapshot && task.dedupeKey === legacyKey)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const current = legacy[0];
    if (!current) return [];
    const completionHistory = [...new Set(legacy.flatMap(task => [
      ...(task.completionHistory ?? []), ...(task.completedAt ? [task.completedAt] : []),
    ]))].sort();
    return [taskSchema.parse({
      ...current, assetId: account.id, dedupeKey: relationKey,
      impactSnapshot: snapshotFor(account, row, at), completionHistory,
    })];
  });
}

/** Creates one immutable evidence snapshot per currently recorded relation. Existing completed tasks still cover their relation. */
export function buildImpactTasks(account: Asset, liveRelations: Relation[], liveAssets: Asset[], existingTasks: Task[], at: string, makeName: ImpactTaskName): Task[] {
  const rows = currentAccountRelations(account, liveRelations, liveAssets);
  const covered = coveredRelationIds(account, rows, existingTasks);
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
