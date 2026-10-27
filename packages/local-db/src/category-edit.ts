import type { RecordBackend, SideTable, SideStoreRuntime, SideTableRef } from './storage-contracts';
import { z } from 'zod';
import { assetSchema, categorySchema, entitySchemas, kinds, normalizeCategoryName, type Asset, type AssetKind, type Category, type EntityType } from '../../domain/src';
import type { RecordRow } from './index';

export interface EditCustomCategoryInput {
  expectedCategory: Category;
  name: string;
  // Capture the complete kind, including application tombstones, when editing starts.
  expectedAssets: Asset[];
  memberIds: string[];
  reservedNames: string[];
}
export type DeleteCustomCategoryInput = Pick<EditCustomCategoryInput, 'expectedCategory' | 'expectedAssets'>;
export interface CategoryEditJournal {
  id: AssetKind;
  operationId: string;
  phase: 'applying' | 'rolling-back';
  changes: Array<{ before: RecordRow; after: RecordRow }>;
}
export interface PendingCategoryEdit {
  operationId: string;
  kind: AssetKind;
  categoryId: string;
  beforeName: string;
  afterName: string;
  phase: CategoryEditJournal['phase'];
  changedAssets: number;
  deleting: boolean;
}
export interface CategoryEditStore {
  categoryEditJournal: SideTable<CategoryEditJournal>;
  transaction<T>(mode: 'r' | 'rw', tables: SideTableRef | readonly (SideTableRef | string)[], action: (scope: this) => Promise<T>): Promise<T>;
  records: RecordBackend;
  outsideTransaction: SideStoreRuntime['outsideTransaction'];
  waitFor: SideStoreRuntime['waitFor'];
}
export interface CategoryEditOperationStore extends CategoryEditStore {
  recoveryTables: Array<Pick<SideTable<{ id: string }>, 'name' | 'count'>>;
}
export interface CategoryMutationTarget { type: EntityType; id: string; kind?: AssetKind }

const rowSchema = z.object({ id: z.string(), type: z.enum(['category', 'asset', 'preference']),
  payload: z.string(), updatedAt: z.number().int().nonnegative() }).strict();
const journalSchema = z.object({ id: z.enum(kinds), operationId: z.uuid(),
  phase: z.enum(['applying', 'rolling-back']), changes: z.array(z.object({ before: rowSchema, after: rowSchema }).strict()).min(1).max(100002) }).strict();
const canonical = (row: RecordRow): RecordRow => ({ id: row.id, type: row.type, payload: row.payload, updatedAt: row.updatedAt });
const sameRow = (a: RecordRow | null, b: RecordRow): boolean => !!a && a.id === b.id && a.type === b.type &&
  a.payload === b.payload && a.updatedAt === b.updatedAt;
const sameEntity = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function storedRow(db: RecordBackend, id: string): Promise<RecordRow | null> {
  const [raw] = await db.getMany([id], false);
  return raw ? canonical(raw as RecordRow) : null;
}
async function storedRows(db: RecordBackend, type: EntityType): Promise<RecordRow[]> {
  return (await db.list(type)).map(canonical);
}
function entity(row: RecordRow) { return entitySchemas[row.type].parse(JSON.parse(row.payload)); }

// Every public mutation of a category or asset shares this table with intent
// creation and replay. IndexedDB supplies cross-tab exclusion without Web Locks.
export async function withCategoryMutationGate<S extends CategoryEditStore, T>(_db: RecordBackend, store: S,
  targets: CategoryMutationTarget[], action: (scope: S) => Promise<T>, allKinds = false): Promise<T> {
  return store.transaction('rw', store.categoryEditJournal, async (store) => {
    const db = store.records;

    // The callback can run before a queued native transaction obtains its lock.
    // Acquire it with a FileStore request before starting any separate RxDB work.
    await store.categoryEditJournal.count();
    await assertCategoryMutationAllowed(db, store, targets, allKinds);
    return store.outsideTransaction(() => action(store));
  });
}

// Called inside the caller's FileStore transaction when it also owns another
// journal table. Avoid nested overlapping IndexedDB transactions and lock cycles.
export async function assertCategoryMutationAllowed(db: RecordBackend, store: CategoryEditStore,
  targets: CategoryMutationTarget[], allKinds = false): Promise<void> {
  if (allKinds && await store.categoryEditJournal.count()) throw Error('category-edit-pending');
  const kinds = new Set<AssetKind>();
  for (const target of targets) {
    if (target.type === 'preference') {
      const kind = target.id.match(/^categoryOrder-(project|account|subscription|item|vault)$/)?.[1] as AssetKind | undefined;
      if (kind) kinds.add(kind);
    } else if (target.type === 'asset' || target.type === 'category') {
      if (target.kind) kinds.add(target.kind);
      const current = await store.outsideTransaction(() => storedRow(db, `${target.type}:${target.id}`));
      if (current) kinds.add((entity(current) as Asset | Category).kind);
    }
  }
  for (const kind of kinds) if (await store.categoryEditJournal.get(kind)) throw Error('category-edit-pending');
}

function checkedJournal(input: CategoryEditJournal): CategoryEditJournal {
  const parsed = journalSchema.safeParse(input);
  if (!parsed.success) throw Error('category-edit-conflict');
  const journal = parsed.data;
  const category = journal.changes[0];
  if (category.before.type !== 'category' || category.after.type !== 'category') throw Error('category-edit-conflict');
  const beforeCategory = categorySchema.parse(entity(category.before)), afterCategory = categorySchema.parse(entity(category.after));
  if (beforeCategory.kind !== journal.id || afterCategory.id !== beforeCategory.id ||
    afterCategory.kind !== beforeCategory.kind || afterCategory.order !== beforeCategory.order ||
    beforeCategory.deleted || (afterCategory.deleted && afterCategory.name !== beforeCategory.name)) throw Error('category-edit-conflict');
  const ids = new Set<string>();
  for (const change of journal.changes) {
    if (ids.has(change.before.id) || change.before.id !== change.after.id || change.before.type !== change.after.type) throw Error('category-edit-conflict');
    ids.add(change.before.id);
    for (const row of [change.before, change.after]) {
      const value = entity(row);
      if (row.id !== `${row.type}:${value.id}`) throw Error('category-edit-conflict');
      if (row.type === 'asset' && (value as Asset).kind !== journal.id) throw Error('category-edit-conflict');
      if (row.type === 'preference' && value.id !== `categoryOrder-${journal.id}`) throw Error('category-edit-conflict');
    }
    if (change.before.type === 'asset') {
      const before = assetSchema.parse(entity(change.before)), after = assetSchema.parse(entity(change.after));
      if (!sameEntity(before, { ...after, category: before.category, updatedAt: before.updatedAt }) ||
        (before.deleted && before.category !== beforeCategory.name)) throw Error('category-edit-conflict');
    }
  }
  return journal;
}

async function preflight(db: RecordBackend, journal: CategoryEditJournal): Promise<void> {
  for (const change of journal.changes) {
    const current = await storedRow(db, change.before.id);
    if (!sameRow(current, change.before) && !sameRow(current, change.after)) throw Error('category-edit-conflict');
  }
}
async function writeChange(db: RecordBackend, before: RecordRow, after: RecordRow): Promise<void> {
  const [raw] = await db.getMany([before.id], true);
  const current = raw && !raw.internalDeleted ? canonical(raw as RecordRow) : null;
  if (sameRow(current, after)) return;
  if (!sameRow(current, before)) throw Error('category-edit-conflict');
  const result = await db.compareAndWrite([{ previous: raw,
    next: { ...raw, ...after } }], 'category-edit');
  if (result.error.length) throw Error(result.error.some(error => error.status === 409) ? 'category-edit-conflict' : 'category-edit-pending');
}

export async function replayCategoryEdit(_db: RecordBackend, store: CategoryEditStore, kind: AssetKind,
  expectedOperationId?: string): Promise<void> {
  await store.transaction('rw', store.categoryEditJournal, async (store) => {
    const db = store.records;

    const entry = await store.categoryEditJournal.get(kind);
    if (expectedOperationId !== undefined && entry?.operationId !== expectedOperationId) throw Error('category-stale');
    if (!entry) return;
    const journal = checkedJournal(entry);
    await store.outsideTransaction(async () => {
      await preflight(db, journal);
      const changes = journal.phase === 'rolling-back' ? [...journal.changes].reverse() : journal.changes;
      for (const change of changes) await writeChange(db,
        journal.phase === 'rolling-back' ? change.after : change.before,
        journal.phase === 'rolling-back' ? change.before : change.after);
    });
    await store.categoryEditJournal.delete(kind);
  });
}

export async function cancelCategoryEdit(db: RecordBackend, store: CategoryEditStore, kind: AssetKind,
  expectedOperationId?: string): Promise<void> {
  // Commit the rollback direction before crossing into RxDB. A crash during undo
  // must resume the undo, even when some original rows have already returned.
  let operationId: string | undefined;
  await store.transaction('rw', store.categoryEditJournal, async (store) => {
    const db = store.records;

    const entry = await store.categoryEditJournal.get(kind);
    if (expectedOperationId !== undefined && entry?.operationId !== expectedOperationId) throw Error('category-stale');
    if (!entry) return;
    const journal = checkedJournal(entry);
    operationId = journal.operationId;
    await store.outsideTransaction(() => preflight(db, journal));
    await store.categoryEditJournal.put({ ...journal, phase: 'rolling-back' });
  });
  if (operationId) await replayCategoryEdit(db, store, kind, operationId);
}

export async function pendingCategoryEdit(store: CategoryEditStore, kind: AssetKind): Promise<PendingCategoryEdit | null> {
  const entry = await store.categoryEditJournal.get(kind);
  if (!entry) return null;
  const journal = checkedJournal(entry), category = journal.changes[0];
  const before = categorySchema.parse(entity(category.before)), after = categorySchema.parse(entity(category.after));
  return { operationId: journal.operationId, kind, categoryId: before.id, beforeName: before.name,
    afterName: after.name, phase: journal.phase, changedAssets: journal.changes.filter(change => change.before.type === 'asset').length,
    deleting: after.deleted };
}

export async function editCustomCategory(db: RecordBackend, store: CategoryEditOperationStore,
  input: EditCustomCategoryInput): Promise<Category> {
  return changeCustomCategory(db, store, input, false);
}

export async function deleteCustomCategory(db: RecordBackend, store: CategoryEditOperationStore,
  input: DeleteCustomCategoryInput): Promise<Category> {
  return changeCustomCategory(db, store, { ...input, name: input.expectedCategory.name, memberIds: [], reservedNames: [] }, true);
}

async function changeCustomCategory(db: RecordBackend, store: CategoryEditOperationStore,
  input: EditCustomCategoryInput, deleting: boolean): Promise<Category> {
  const expected = categorySchema.parse(input.expectedCategory);
  if (expected.deleted ||
    input.expectedAssets.length > 100000 || new Set(input.memberIds).size !== input.memberIds.length) throw Error('category-edit-invalid');
  const name = input.name.trim(), normalized = normalizeCategoryName(name);
  if (!normalized || name.length > 60) throw Error('category-name');
  if (input.reservedNames.some(reserved => normalizeCategoryName(reserved) === normalized)) throw Error('category-reserved');
  const expectedAssets = input.expectedAssets.map(asset => assetSchema.parse(asset));
  if (expectedAssets.some(asset => asset.kind !== expected.kind) || new Set(expectedAssets.map(asset => asset.id)).size !== expectedAssets.length) throw Error('category-edit-invalid');
  const selected = new Set(input.memberIds);
  if (input.memberIds.some(id => !expectedAssets.some(asset => asset.id === id && !asset.deleted))) throw Error('category-edit-invalid');
  let planned: CategoryEditJournal | undefined;
  await store.transaction('rw', [store.categoryEditJournal, ...store.recoveryTables.map(table => table.name)], async (store) => {
    const db = store.records;

    if (await store.categoryEditJournal.get(expected.kind)) throw Error('category-edit-pending');
    for (const table of store.recoveryTables) if (await table.count()) throw Error('category-edit-pending');
    planned = await store.outsideTransaction(async () => {
      const categoryRow = await storedRow(db, `category:${expected.id}`);
      if (!categoryRow || !sameEntity(categorySchema.parse(entity(categoryRow)), expected)) throw Error('category-stale');
      const categories = await storedRows(db, 'category');
      if (categories.some(row => {
        const category = categorySchema.parse(entity(row));
        return category.id !== expected.id && category.kind === expected.kind && !category.deleted && normalizeCategoryName(category.name) === normalized;
      })) throw Error('category-duplicate');
      const assets = (await storedRows(db, 'asset')).filter(row => assetSchema.parse(entity(row)).kind === expected.kind);
      const byId = new Map(expectedAssets.map(asset => [asset.id, asset]));
      if (assets.length !== expectedAssets.length || assets.some(row => {
        const asset = assetSchema.parse(entity(row));
        return !sameEntity(asset, byId.get(asset.id));
      })) throw Error('category-members-stale');
      const nextCategory = categorySchema.parse({ ...expected, name, deleted: deleting });
      const now = Date.now(), updatedAt = new Date(now).toISOString();
      const categoryPayload = JSON.stringify(nextCategory);
      const changes: CategoryEditJournal['changes'] = [{ before: categoryRow,
        after: categoryPayload === categoryRow.payload ? categoryRow : { ...categoryRow, payload: categoryPayload, updatedAt: now } }];
      for (const row of assets) {
        const asset = assetSchema.parse(entity(row));
        const category = deleting ? (asset.category === expected.name ? '' : asset.category)
          : asset.deleted ? (asset.category === expected.name ? name : asset.category)
          : selected.has(asset.id) ? name : asset.category === expected.name ? '' : asset.category;
        if (category !== asset.category) changes.push({ before: row,
          after: { ...row, payload: JSON.stringify(assetSchema.parse({ ...asset, category, updatedAt })), updatedAt: now } });
      }
      const order = await storedRow(db, `preference:categoryOrder-${expected.kind}`);
      if (order && (expected.name !== name || deleting)) {
        const preference = entitySchemas.preference.parse(entity(order));
        if (Array.isArray(preference.value) && preference.value.includes(expected.name)) changes.push({ before: order,
          after: { ...order, payload: JSON.stringify({ ...preference,
            value: deleting ? preference.value.filter(value => value !== expected.name)
              : [...new Set(preference.value.map(value => value === expected.name ? name : value))] }), updatedAt: now } });
      }
      return { id: expected.kind, operationId: crypto.randomUUID(), phase: 'applying', changes };
    });
    await store.categoryEditJournal.add(planned);
  });
  if (!planned) throw Error('category-edit-pending');
  try { await replayCategoryEdit(db, store, expected.kind, planned.operationId); }
  catch (error) {
    // A competing retry may have already completed this operation. The complete
    // result check below recognizes it without ever replaying a newer intent.
    if (!(error instanceof Error) || error.message !== 'category-stale') throw error;
  }
  // A concurrent cancel/retry may remove the intent before this caller resumes.
  // Report success only when the complete frozen result actually exists.
  for (const change of planned.changes) if (!sameRow(await storedRow(db, change.after.id), change.after)) throw Error('category-stale');
  return categorySchema.parse(entity(planned.changes[0].after));
}
