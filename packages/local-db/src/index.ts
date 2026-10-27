import { createRxDatabase, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { conflictsWithAccountRestore } from '../../domain/src/account-identity';
import Dexie, { type Table } from 'dexie';
import type { RecordBackend, SideTable, SideStoreRuntime, SideTableRef } from './storage-contracts';
import { WebRecordBackend, WebSideTable, WebSideRuntime } from './web-storage';
export type { RecordBackend, StoredRecord, SideTable, SideStoreRuntime } from './storage-contracts';
import { z } from 'zod';
import { trashPurgeRows, redactedTrashRow, type TrashPurgePlan, type TrashTarget } from './trash-purge';
export type { TrashPurgePlan, TrashTarget } from './trash-purge';
import { dueOnCycle, entitySchemas, financeActions, historyAssetIds, historyReferenceIds, normalizeCategoryName, type Asset, type AssetKind, type Category, type EntityType, type History, type Relation, type Submission, type Task } from '../../domain/src';
import { canRecordProjectWorkflowTask, currentProjectWorkflowRound } from '../../domain/src/project-workflow';
import { advanceTaskReminder, zonedParts } from '../../domain/src/task-reminder';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { unzipArchive } from './archive-unzip';
import { checkedPasswordVaultBytes, checkedPasswordVaultRecord, PASSWORD_VAULT_LIMIT, type VaultRecord } from './password-vault-storage';
export type { VaultRecord } from './password-vault-storage';
import type { SyncOperation } from '../../contracts/src';
import { assertReviewedAssetReferences, cancelReviewedExpenseConfirmation, confirmReviewedExpense, migrateLegacyIntakeReview,
  parseReviewedCandidates, pendingReviewedExpenseConfirmations, replayReviewedExpense, sameReviewedCandidate,
  retainReviewedCsvSources,
  type PendingReviewedExpenseConfirmation, type ReviewedCandidate, type ReviewedImportJournal } from './intake-review';
import { cancelReviewedWithdrawal, withdrawReviewedCandidate, replayReviewedWithdrawal, pendingReviewedWithdrawals, type PendingReviewedWithdrawal } from './intake-withdrawal';
import { replayReviewedAssetMerge } from './intake-asset-merge';
import { pendingSubscriptionSave, replaySubscriptionSave, subscriptionSaveComplete, type PendingSubscriptionSave, type SubscriptionLink, type SubscriptionSaveJournal } from './subscription-save';
import { assertCategoryMutationAllowed, cancelCategoryEdit as cancelCategoryEditIntent, deleteCustomCategory as deleteCustomCategoryIntent,
  editCustomCategory as editCustomCategoryIntent, pendingCategoryEdit, replayCategoryEdit, withCategoryMutationGate,
  type CategoryEditJournal, type DeleteCustomCategoryInput, type EditCustomCategoryInput, type PendingCategoryEdit } from './category-edit';
export type { PendingSubscriptionSave, SubscriptionLink } from './subscription-save';
export type { DeleteCustomCategoryInput, EditCustomCategoryInput, PendingCategoryEdit } from './category-edit';

// Shared transport shape. Storage metadata stays outside the business payload.
export interface RecordRow { id: string; type: EntityType; payload: string; updatedAt: number }
function isPurgedPayload(type: EntityType, payload: string | null | undefined): boolean {
  if (!payload) return false;
  const value = JSON.parse(payload) as { purged?: boolean; financeCorrection?: { purged?: boolean } };
  return !!value.purged || type === 'history' && !!value.financeCorrection?.purged;
}
export class AccountRestoreConflict extends Error {
  constructor(readonly existingId: string) { super('account-restore-conflict'); }
}
interface StoredFile { id: string; blob: Blob; name: string }
interface Journal { id: string; rows: RecordRow[]; intakeReview?: ReviewedCandidate[]; sourceBinding?: DatasetBinding; passwordVault?: VaultRecord }
export interface RestoreRecoveryToken { journalId: string; planHash: string; datasetProof: string }
export interface PendingRestoreRecovery {
  token: RestoreRecoveryToken;
  rowCount: number; candidateCount: number; presentEqual: number; missing: number; different: number;
  canRetry: boolean; canAbandon: boolean; reason: string | null;
}
type ImportJournal = ReviewedImportJournal;
interface RenewalJournal { id: string; assetId: string; expectedPayload: string; next: RecordRow; history: RecordRow }
interface SyncBase { id: string; payload: string; version: number }
export interface PulledRow { row: RecordRow; sequence: number; version: number; operationId?: string; keyEpoch?: number; ciphertext?: string }
interface PullJournal { id: string; cursorStart: number; changes: PulledRow[] }
interface ScopedBase { id: string; scope: string; rowId: string; payload: string; version: number; row?: RecordRow; operationId?: string; keyEpoch?: number; ciphertext?: string }
export interface ScopedOutbox { id: string; scope: string; row: RecordRow; operation: SyncOperation; blocked?: boolean }
interface ScopedPullJournal { id: string; scope: string; cursorStart: number; change: PulledRow; localPayload: string | null; decision?: 'local' | 'remote' }
export interface ScopedConflict { rowId: string; localPayload: string | null; remotePayload: string; basePayload: string | null; remoteVersion: number }
export interface DatasetBinding { endpoint: string; accountId: string; workspaceId: string; scope: string }
interface StoredDatasetBinding extends DatasetBinding { id: 'active' }
export interface ScopedAttachmentUploadPlan {
  scope: string;
  attachmentId: string;
  sourceSha256: string;
  keyEpoch: number;
  objects: Array<{ id: string; sha256: string; bytes: Uint8Array }>;
}
interface StoredScopedAttachmentUploadPlan extends ScopedAttachmentUploadPlan { id: string }
export type ArchiveMergeChoice = 'source' | 'target';
export interface ArchiveMergePreviewRow {
  id: string; type: EntityType; status: 'new' | 'same' | 'conflict';
  sourcePayload: string; targetPayload: string | null;
}
export interface ArchiveMergePreviewCandidate {
  id: string; status: 'new' | 'same' | 'conflict';
  sourceCandidate: ReviewedCandidate; targetCandidate: ReviewedCandidate | null;
}
export interface ArchiveMergePreview {
  rows: ArchiveMergePreviewRow[]; intakeReview: ArchiveMergePreviewCandidate[]; targetFingerprint: string;
}
interface ArchiveMergeChange { before: RecordRow | null; after: RecordRow }
interface ArchiveMergeReviewChange { before: ReviewedCandidate | null; after: ReviewedCandidate }
interface ArchiveMergeJournal {
  id: 'active'; phase: 'applying' | 'applied' | 'syncing';
  archiveHash: string; targetFingerprint: string; changes: ArchiveMergeChange[];
  addedFileIds: string[]; insertedFileIds: string[];
  intakeReviewChanges?: ArchiveMergeReviewChange[];
}
export interface PendingArchiveMerge {
  phase: ArchiveMergeJournal['phase']; archiveHash: string; changedRows: number; addedFiles: number;
  changedCandidates: number;
}

class RawWebFileStore extends Dexie {
  blobs!: Table<StoredFile, string>;
  journal!: Table<Journal, string>;
  importJournal!: Table<ImportJournal, string>;
  renewalJournal!: Table<RenewalJournal, string>;
  syncBase!: Table<SyncBase, string>;
  syncMeta!: Table<{ id: string; cursor: number }, string>;
  pullJournal!: Table<PullJournal, string>;
  scopedBase!: Table<ScopedBase, string>;
  scopedMeta!: Table<{ id: string; cursor: number; keyFingerprint?: string; keyEpoch?: number }, string>;
  scopedOutbox!: Table<ScopedOutbox, string>;
  scopedPull!: Table<ScopedPullJournal, string>;
  datasetBinding!: Table<StoredDatasetBinding, string>;
  scopedAttachmentUploads!: Table<StoredScopedAttachmentUploadPlan, string>;
  archiveMerge!: Table<ArchiveMergeJournal, string>;
  subscriptionSaveJournal!: Table<SubscriptionSaveJournal, string>;
  intakeReview!: Table<ReviewedCandidate, string>;
  categoryEditJournal!: Table<CategoryEditJournal, string>;
  passwordVault!: Table<VaultRecord, string>;
  constructor(name: string) {
    super(`${name}-files-v1`);
    this.version(1).stores({ blobs: 'id', journal: 'id' });
    this.version(2).stores({ blobs: 'id', journal: 'id', importJournal: 'id' });
    this.version(3).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id' });
    this.version(4).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id' });
    this.version(5).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id' });
    this.version(6).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope' });
    this.version(7).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId' });
    this.version(8).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId', archiveMerge: 'id' });
    this.version(9).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId', archiveMerge: 'id', subscriptionSaveJournal: 'id, &assetId' });
    this.version(10).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId', archiveMerge: 'id', subscriptionSaveJournal: 'id, &assetId',
      intakeReview: 'id, fileHash, status' });
    this.version(11).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId', archiveMerge: 'id', subscriptionSaveJournal: 'id, &assetId',
      intakeReview: 'id, fileHash, status', categoryEditJournal: 'id' });
    this.version(12).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId', archiveMerge: 'id', subscriptionSaveJournal: 'id, &assetId',
      intakeReview: 'id, fileHash, status', categoryEditJournal: 'id', passwordVault: 'id' });
  }
}

export interface FileStore extends SideStoreRuntime {
  readonly recoveryTables: SideTableRef[];
  blobs: SideTable<StoredFile>;
  journal: SideTable<Journal>;
  importJournal: SideTable<ImportJournal>;
  renewalJournal: SideTable<RenewalJournal>;
  syncBase: SideTable<SyncBase>;
  syncMeta: SideTable<{ id: string; cursor: number }>;
  pullJournal: SideTable<PullJournal>;
  scopedBase: SideTable<ScopedBase>;
  scopedMeta: SideTable<{ id: string; cursor: number; keyFingerprint?: string; keyEpoch?: number }>;
  scopedOutbox: SideTable<ScopedOutbox>;
  scopedPull: SideTable<ScopedPullJournal>;
  datasetBinding: SideTable<StoredDatasetBinding>;
  scopedAttachmentUploads: SideTable<StoredScopedAttachmentUploadPlan>;
  archiveMerge: SideTable<ArchiveMergeJournal>;
  subscriptionSaveJournal: SideTable<SubscriptionSaveJournal>;
  intakeReview: SideTable<ReviewedCandidate>;
  categoryEditJournal: SideTable<CategoryEditJournal>;
  passwordVault: SideTable<VaultRecord>;
}
class WebFileStore extends WebSideRuntime implements FileStore {
  get recoveryTables(): SideTableRef[] {
    return [this.journal, this.importJournal, this.pullJournal, this.scopedPull, this.scopedOutbox,
      this.scopedAttachmentUploads, this.archiveMerge, this.renewalJournal, this.subscriptionSaveJournal];
  }
  declare blobs: SideTable<StoredFile>;
  declare journal: SideTable<Journal>;
  declare importJournal: SideTable<ImportJournal>;
  declare renewalJournal: SideTable<RenewalJournal>;
  declare syncBase: SideTable<SyncBase>;
  declare syncMeta: SideTable<{ id: string; cursor: number }>;
  declare pullJournal: SideTable<PullJournal>;
  declare scopedBase: SideTable<ScopedBase>;
  declare scopedMeta: SideTable<{ id: string; cursor: number; keyFingerprint?: string; keyEpoch?: number }>;
  declare scopedOutbox: SideTable<ScopedOutbox>;
  declare scopedPull: SideTable<ScopedPullJournal>;
  declare datasetBinding: SideTable<StoredDatasetBinding>;
  declare scopedAttachmentUploads: SideTable<StoredScopedAttachmentUploadPlan>;
  declare archiveMerge: SideTable<ArchiveMergeJournal>;
  declare subscriptionSaveJournal: SideTable<SubscriptionSaveJournal>;
  declare intakeReview: SideTable<ReviewedCandidate>;
  declare categoryEditJournal: SideTable<CategoryEditJournal>;
  declare passwordVault: SideTable<VaultRecord>;
  constructor(name: string, records?: RecordBackend) {
    const raw = new RawWebFileStore(name);
    super(raw, records);
    this.blobs = new WebSideTable(raw.blobs);
    this.journal = new WebSideTable(raw.journal);
    this.importJournal = new WebSideTable(raw.importJournal);
    this.renewalJournal = new WebSideTable(raw.renewalJournal);
    this.syncBase = new WebSideTable(raw.syncBase);
    this.syncMeta = new WebSideTable(raw.syncMeta);
    this.pullJournal = new WebSideTable(raw.pullJournal);
    this.scopedBase = new WebSideTable(raw.scopedBase);
    this.scopedMeta = new WebSideTable(raw.scopedMeta);
    this.scopedOutbox = new WebSideTable(raw.scopedOutbox);
    this.scopedPull = new WebSideTable(raw.scopedPull);
    this.datasetBinding = new WebSideTable(raw.datasetBinding);
    this.scopedAttachmentUploads = new WebSideTable(raw.scopedAttachmentUploads);
    this.archiveMerge = new WebSideTable(raw.archiveMerge);
    this.subscriptionSaveJournal = new WebSideTable(raw.subscriptionSaveJournal);
    this.intakeReview = new WebSideTable(raw.intakeReview);
    this.categoryEditJournal = new WebSideTable(raw.categoryEditJournal);
    this.passwordVault = new WebSideTable(raw.passwordVault);
  }
}

interface DefaultRepositoryState {
  factory?: () => Promise<LocalRepository>;
  fileStore?: WebFileStore;
  resources?: Promise<{ db: RxDatabase; records: RecordBackend; fileStore: FileStore; recoveryState?: RepositoryRecoveryState }>;
}
interface RepositoryRecoveryState { syncError: string | null; restoreError: string | null; renewalError: string | null; subscriptionError?: string | null; intakeError?: string | null; intakeExpenseError?: string | null; categoryEditError?: string | null }
// Vite HMR re-evaluates this module while the old RxDB remains open. Keep the resource across reloads.
const defaultGlobal = globalThis as typeof globalThis & { __keepanyLocalDbState?: DefaultRepositoryState };
if (!defaultGlobal.__keepanyLocalDbState) defaultGlobal.__keepanyLocalDbState = {};
const defaultState = defaultGlobal.__keepanyLocalDbState;
// Create browser storage lazily: importing archive codecs on Native must not open IndexedDB.
function defaultFiles(): WebFileStore {
  if (!defaultState.fileStore) defaultState.fileStore = new WebFileStore('keepany');
  return defaultState.fileStore;
}
export function webFiles(): FileStore { return defaultFiles(); }
/** Lazy compatibility handle; importing the module never creates a browser store. */
export const files = new Proxy({} as FileStore, {
  get(_target, property) {
    if (defaultState.factory) throw Error('web-files-unavailable');
    const store = defaultFiles();
    const value = Reflect.get(store, property);
    return typeof value === 'function' ? value.bind(store) : value;
  },
});
const recordSchema = {
  title: 'KeepAny entity', version: 0, primaryKey: 'id', type: 'object',
  properties: {
    id: { type: 'string', maxLength: 120 },
    type: { type: 'string', maxLength: 20 },
    payload: { type: 'string' },
    updatedAt: { type: 'number', minimum: 0, maximum: 9999999999999, multipleOf: 1 },
  },
  required: ['id', 'type', 'payload', 'updatedAt'], indexes: ['type'],
} as const;

const key = (type: EntityType, id: string) => `${type}:${id}`;
const canonical = (value: RecordRow): RecordRow => {
  return { id: value.id as string, type: value.type as EntityType, payload: value.payload as string, updatedAt: value.updatedAt as number };
};
const parseEntity = (type: EntityType, value: unknown): { id: string; deleted: boolean } =>
  entitySchemas[type].parse(value) as unknown as { id: string; deleted: boolean };
const parsedPayload = (row: RecordRow) => parseEntity(row.type, JSON.parse(row.payload));
const rowFor = (type: EntityType, value: unknown): RecordRow => {
  const parsed = parseEntity(type, value);
  return { id: key(type, parsed.id), type, payload: JSON.stringify(parsed), updatedAt: Date.now() };
};
const renewalLocks = new Map<string, Promise<void>>();
async function withRenewalLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const previous = renewalLocks.get(name) ?? Promise.resolve();
  const run = previous.then(() => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? locks.request(name, action) : action();
  });
  const tail = run.then(() => {}, () => {});
  renewalLocks.set(name, tail);
  try { return await run; }
  finally { if (renewalLocks.get(name) === tail) renewalLocks.delete(name); }
}

export class LocalRepository {
  readonly records: RecordBackend;
  private readonly webDb?: RxDatabase;
  constructor(db: RecordBackend | RxDatabase, readonly fileStore: FileStore,
    readonly recoveryState: RepositoryRecoveryState = { syncError: null, restoreError: null, renewalError: null }) {
    this.records = 'getMany' in db ? db as RecordBackend : new WebRecordBackend(db);
    this.webDb = this.records.webDatabase;
    if (fileStore instanceof WebSideRuntime) fileStore.bindRecords(this.records);
  }
  /** Browser-only diagnostic compatibility. Product logic uses records. */
  get db(): RxDatabase { if (!this.webDb) throw Error('web-database-unavailable'); return this.webDb; }
  private withStorage(scope: FileStore): LocalRepository { return new LocalRepository(scope.records, scope, this.recoveryState); }
  subscribe(listener: () => void): () => void {
    const records = this.records.subscribe(listener), side = this.fileStore.subscribe(listener);
    return () => { records(); side(); };
  }
  observe<T>(read: (repository: LocalRepository) => Promise<T>, observer: { next(value: T): void; error(error: unknown): void }): () => void {
    let active = true, generation = 0;
    const refresh = () => {
      const current = ++generation;
      void read(this).then(value => { if (active && current === generation) observer.next(value); },
        error => { if (active && current === generation) observer.error(error); });
    };
    const unsubscribe = this.subscribe(refresh);
    refresh();
    return () => { active = false; generation++; unsubscribe(); };
  }
  get syncRecoveryError(): string | null { return this.recoveryState.syncError; }
  set syncRecoveryError(value: string | null) { this.recoveryState.syncError = value; }
  get restoreRecoveryError(): string | null { return this.recoveryState.restoreError; }
  set restoreRecoveryError(value: string | null) { this.recoveryState.restoreError = value; }
  get renewalRecoveryError(): string | null { return this.recoveryState.renewalError; }
  set renewalRecoveryError(value: string | null) { this.recoveryState.renewalError = value; }
  get subscriptionRecoveryError(): string | null { return this.recoveryState.subscriptionError ?? null; }
  set subscriptionRecoveryError(value: string | null) { this.recoveryState.subscriptionError = value; }
  get intakeReviewMigrationError(): string | null { return this.recoveryState.intakeError ?? null; }
  set intakeReviewMigrationError(value: string | null) { this.recoveryState.intakeError = value; }
  get intakeExpenseRecoveryError(): string | null { return this.recoveryState.intakeExpenseError ?? null; }
  set intakeExpenseRecoveryError(value: string | null) { this.recoveryState.intakeExpenseError = value; }
  get categoryEditRecoveryError(): string | null { return this.recoveryState.categoryEditError ?? null; }
  set categoryEditRecoveryError(value: string | null) { this.recoveryState.categoryEditError = value; }

  async readPasswordVault(): Promise<VaultRecord | null> {
    const current = await this.fileStore.passwordVault.get('local');
    return current ? checkedPasswordVaultRecord(current) : null;
  }

  async savePasswordVault(input: Uint8Array, expectedRevision: string | null): Promise<VaultRecord> {
    const bytes = checkedPasswordVaultBytes(input);
    if (expectedRevision !== null && typeof expectedRevision !== 'string') throw Error('vault-invalid');
    return this.fileStore.transaction('rw', restoreRecoveryTables(this.fileStore), async (scopeTx1) => {
      const repositoryTx1 = this.withStorage(scopeTx1);

      if (await repositoryTx1.fileStore.journal.count()) throw Error('restore-recovery-pending');
      await assertRestoreRecoveryGate(repositoryTx1.fileStore);
      if (await repositoryTx1.fileStore.importJournal.count() || await repositoryTx1.fileStore.pullJournal.count() ||
        await repositoryTx1.fileStore.scopedPull.count()) throw Error('vault-recovery-pending');
      const current = await repositoryTx1.fileStore.passwordVault.get('local');
      if ((current?.revision ?? null) !== expectedRevision) throw Error('vault-stale');
      const record: VaultRecord = { id: 'local', revision: crypto.randomUUID(), bytes, updatedAt: new Date().toISOString() };
      await repositoryTx1.fileStore.passwordVault.put(record);
      return checkedPasswordVaultRecord(record);
    });
  }

  async getPendingCategoryEdit(kind: AssetKind): Promise<PendingCategoryEdit | null> {
    return pendingCategoryEdit(this.fileStore, kind);
  }

  private async settleCategoryEdits(kind?: AssetKind, expectedOperationId?: string): Promise<void> {
    const pendingKinds = kind ? [kind] : (await this.fileStore.categoryEditJournal.toArray()).map(entry => entry.id);
    for (const pendingKind of pendingKinds) {
      try { await replayCategoryEdit(this.records, this.fileStore, pendingKind, expectedOperationId); }
      catch (error) {
        if (error instanceof Error && error.message === 'category-stale') throw error;
        this.categoryEditRecoveryError = error instanceof Error && error.message === 'category-edit-conflict' ? error.message : 'category-edit-pending';
        throw Error(this.categoryEditRecoveryError);
      }
    }
    if (!(await this.fileStore.categoryEditJournal.count())) this.categoryEditRecoveryError = null;
  }

  async retryCategoryEdit(kind: AssetKind, expectedOperationId?: string): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, () => this.settleCategoryEdits(kind, expectedOperationId));
  }

  async retryAllCategoryEdits(): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, () => this.settleCategoryEdits());
  }

  async cancelCategoryEdit(kind: AssetKind, expectedOperationId?: string): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      try {
        await cancelCategoryEditIntent(this.records, this.fileStore, kind, expectedOperationId);
        if (!(await this.fileStore.categoryEditJournal.count())) this.categoryEditRecoveryError = null;
      } catch (error) {
        if (error instanceof Error && error.message === 'category-stale') throw error;
        this.categoryEditRecoveryError = error instanceof Error && error.message === 'category-edit-conflict' ? error.message : 'category-edit-pending';
        throw Error(this.categoryEditRecoveryError);
      }
    });
  }

  async editCustomCategory(input: EditCustomCategoryInput): Promise<Category> {
    return this.changeCustomCategory(input, false);
  }

  async deleteCustomCategory(input: DeleteCustomCategoryInput): Promise<Category> {
    return this.changeCustomCategory(input, true);
  }

  private async changeCustomCategory(input: EditCustomCategoryInput | DeleteCustomCategoryInput, deleting: boolean): Promise<Category> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves();
      await this.settleReviewedExpenseConfirmations();
      try {
        const store = this.fileStore;
        const result = deleting ? await deleteCustomCategoryIntent(this.records, store, input)
          : await editCustomCategoryIntent(this.records, store, input as EditCustomCategoryInput);
        if (!(await this.fileStore.categoryEditJournal.count())) this.categoryEditRecoveryError = null;
        return result;
      } catch (error) {
        if (error instanceof Error && error.message === 'category-stale') throw error;
        if (await this.fileStore.categoryEditJournal.get(input.expectedCategory.kind)) {
          this.categoryEditRecoveryError = error instanceof Error && error.message === 'category-edit-conflict' ? error.message : 'category-edit-pending';
          throw Error(this.categoryEditRecoveryError);
        }
        throw error;
      }
    });
  }

  async retryIntakeReviewMigration(): Promise<void> {
    if (!this.webDb || this.records.name !== 'keepany-v1') return;
    try {
      const records = await this.allRecords();
      const assetIds = new Set(records.filter(row => row.type === 'asset')
        .map(row => (JSON.parse(row.payload) as Asset).id));
      await migrateLegacyIntakeReview(this.fileStore, 'keepany-intake-review-v1', assetIds, historyByIdIn(records));
      this.intakeReviewMigrationError = null;
    } catch (error) {
      this.intakeReviewMigrationError = 'review-migration-failed';
      throw error;
    }
  }

  async confirmReviewedExpense(expected: ReviewedCandidate): Promise<History> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      if (this.intakeReviewMigrationError) await this.retryIntakeReviewMigration();
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves();
      if (await this.pendingArchiveMerge()) throw Error('archive-merge-pending');
      try {
        const history = await confirmReviewedExpense(this.records, this.fileStore, expected);
        if (!(await this.fileStore.importJournal.toArray()).some(entry => entry.reviewedExpense)) this.intakeExpenseRecoveryError = null;
        return history;
      } catch (error) {
        const code = error instanceof Error && error.message.startsWith('review-expense-') ? error.message : 'review-expense-pending';
        if ((await this.fileStore.importJournal.toArray()).some(entry => entry.reviewedExpense)) this.intakeExpenseRecoveryError = code;
        throw Error(code);
      }
    });
  }

  async retryReviewedExpenseConfirmations(): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, () => this.settleReviewedExpenseConfirmations());
  }

  async pendingReviewedExpenseConfirmations(): Promise<PendingReviewedExpenseConfirmation[]> {
    return pendingReviewedExpenseConfirmations(this.records, this.fileStore);
  }

  async cancelReviewedExpenseConfirmation(candidateId: string): Promise<'cancelled' | 'completed'> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      try {
        const outcome = await cancelReviewedExpenseConfirmation(this.records, this.fileStore, candidateId);
        if (!(await this.fileStore.importJournal.toArray()).some(entry => entry.reviewedExpense)) this.intakeExpenseRecoveryError = null;
        return outcome;
      } catch (error) {
        const code = error instanceof Error && error.message.startsWith('review-expense-') ? error.message : 'review-expense-pending';
        this.intakeExpenseRecoveryError = code;
        throw Error(code);
      }
    });
  }

  async withdrawReviewedCandidate(expected: ReviewedCandidate): Promise<void> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves();
      await withdrawReviewedCandidate(this.records, this.fileStore, expected);
    });
  }
  async cancelReviewedWithdrawal(candidateId: string): Promise<'cancelled' | 'completed'> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, () => cancelReviewedWithdrawal(this.records, this.fileStore, candidateId));
  }
  async pendingReviewedWithdrawals(): Promise<PendingReviewedWithdrawal[]> { return pendingReviewedWithdrawals(this.records, this.fileStore); }
  async retryReviewedWithdrawals(): Promise<void> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, () => this.settleReviewedWithdrawals());
  }
  private async settleReviewedWithdrawals(): Promise<void> {
    for (const entry of await this.fileStore.importJournal.toArray()) if (entry.reviewedWithdrawal) await replayReviewedWithdrawal(this.records, this.fileStore, entry.id);
  }

  private async settleReviewedExpenseConfirmations(): Promise<void> {
    for (const entry of await this.fileStore.importJournal.toArray()) {
      if (!entry.reviewedExpense) continue;
      try { await replayReviewedExpense(this.records, this.fileStore, entry.id); }
      catch (error) {
        this.intakeExpenseRecoveryError = error instanceof Error && error.message.startsWith('review-expense-')
          ? error.message : 'review-expense-pending';
        throw Error(this.intakeExpenseRecoveryError);
      }
    }
    this.intakeExpenseRecoveryError = null;
    await this.settleReviewedWithdrawals();
  }

  async allRecords(): Promise<RecordRow[]> {
    return (await this.records.list()).map(canonical);
  }

  async get<T>(type: EntityType, id: string): Promise<T | null> {
    const doc = await this.records.get(key(type, id));
    return doc ? JSON.parse(canonical(doc).payload) as T : null;
  }

  async list<T>(type: EntityType, includeDeleted = false): Promise<T[]> {
    const docs = await this.records.list(type);
    return docs.map(doc => JSON.parse(canonical(doc).payload) as T)
      .filter(value => includeDeleted || !(value as { deleted?: boolean }).deleted);
  }

  private async assertRelationEndpoints(relation: { from: string; to: string }): Promise<void> {
    const from = await this.get<{ deleted: boolean }>('asset', relation.from);
    const to = await this.get<{ deleted: boolean }>('asset', relation.to);
    if (!from || !to || from.deleted || to.deleted) throw Error('relation-endpoint');
  }

  async save(type: EntityType, value: unknown): Promise<RecordRow> {
    const task = type === 'task' ? entitySchemas.task.parse(value) : null;
    if (task) {
      return withRenewalLock(`keepany-task:${this.records.name}`, () => this.saveUnlocked(type, value));
    }
    return this.saveUnlocked(type, value);
  }

  async createCategory(kind: AssetKind, name: string, order: number): Promise<Category> {
    const trimmed = name.trim();
    const normalized = normalizeCategoryName(trimmed);
    if (!normalized) throw Error('category-name');
    return withRenewalLock(`keepany-category:${this.records.name}:${kind}:${normalized}`, () =>
      withCategoryMutationGate(this.records, this.fileStore, [{ type: 'category', id: '', kind }], async (scopeGate1) => {
        const repositoryGate1 = this.withStorage(scopeGate1);

      const categories = (await repositoryGate1.records.list('category'))
        .map((row: RecordRow) => entitySchemas.category.parse(JSON.parse(row.payload)));
      if (categories.some(category => category.kind === kind && !category.deleted &&
        normalizeCategoryName(category.name) === normalized)) throw Error('category-duplicate');
      const hash = await sha(new TextEncoder().encode(`${kind}:${normalized}`));
      const prefix = `category-${kind}-${hash}`;
      const used = new Set(categories.map(category => category.id));
      let sequence = 1;
      while (used.has(`${prefix}-${sequence}`)) sequence++;
      const category = entitySchemas.category.parse({
        id: `${prefix}-${sequence}`, kind, name: trimmed, order, deleted: false,
      });
      try {
        await repositoryGate1.records.insert(rowFor('category', category));
      } catch (error) {
        if (await repositoryGate1.get<Category>('category', category.id)) throw Error('category-duplicate');
        throw error;
      }
      return category;
      }));
  }

  async saveAssetIfCurrent(expected: Asset, next: Asset): Promise<RecordRow> {
    if (expected.id !== next.id || expected.kind !== next.kind) throw Error('asset-stale');
    return this.saveUnlocked('asset', next, rowFor('asset', expected).payload);
  }

  async saveRelationIfCurrent(expected: Relation, next: Relation): Promise<RecordRow> {
    if (expected.id !== next.id || expected.from !== next.from || expected.to !== next.to) throw Error('relation-stale');
    return this.saveUnlocked('relation', next, rowFor('relation', expected).payload);
  }

  async getPendingSubscriptionSave(assetId: string): Promise<PendingSubscriptionSave | null> {
    return pendingSubscriptionSave(this.records, this.fileStore, assetId);
  }

  private async settleSubscriptionSaves(assetId?: string): Promise<void> {
    const journals = assetId
      ? await this.fileStore.subscriptionSaveJournal.equals('assetId', assetId)
      : await this.fileStore.subscriptionSaveJournal.toArray();
    for (const journal of journals) {
      try { await replaySubscriptionSave(this.records, this.fileStore, journal.id); }
      catch (error) {
        this.subscriptionRecoveryError = error instanceof Error ? error.message : 'subscription-relations-pending';
        throw Error('subscription-relations-pending');
      }
    }
    if (!(await this.fileStore.subscriptionSaveJournal.count())) this.subscriptionRecoveryError = null;
  }

  async retrySubscriptionSave(assetId: string): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, () => this.settleSubscriptionSaves(assetId));
  }

  async retryAllSubscriptionSaves(): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, () => this.settleSubscriptionSaves());
  }

  // Abandon only the remaining relation intent. Asset fields and relations already
  // accepted by RxDB stay in place and can be reviewed through normal editing.
  async abandonSubscriptionSave(assetId: string): Promise<void> {
    await withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.fileStore.subscriptionSaveJournal.deleteEquals('assetId', assetId);
      if (!(await this.fileStore.subscriptionSaveJournal.count())) this.subscriptionRecoveryError = null;
    });
  }

  async saveSubscription(expectedAsset: Asset | null, nextAsset: Asset,
    links: ReadonlyArray<SubscriptionLink>): Promise<Asset> {
    const expected = expectedAsset ? entitySchemas.asset.parse(expectedAsset) : null;
    const proposed = entitySchemas.asset.parse(nextAsset);
    if (proposed.kind !== 'subscription' || proposed.deleted ||
      (expected && (expected.kind !== 'subscription' || expected.deleted || expected.id !== proposed.id)) ||
      links.length > 2 || new Set(links.map(link => link.kind)).size !== links.length ||
      links.some(link => !['project', 'account'].includes(link.kind) || !link.id || link.id === proposed.id)) {
      throw Error('subscription-save-invalid');
    }
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves(proposed.id);
      const [current] = await this.records.getMany([key('asset', proposed.id)], false);
      if (expected ? !current || JSON.stringify(parsedPayload(current as RecordRow)) !== rowFor('asset', expected).payload : !!current) {
        throw Error('asset-stale');
      }
      for (const link of links) {
        const target = await this.get<Asset>('asset', link.id);
        if (!target || target.deleted || target.kind !== link.kind) throw Error('relation-endpoint');
      }
      const id = crypto.randomUUID();
      const next = entitySchemas.asset.parse({ ...proposed, lastSubscriptionSaveId: id });
      const relations = links.map(link => ({ targetKind: link.kind, row: rowFor('relation', {
        id: crypto.randomUUID(), from: next.id, to: link.id, label: link.label,
        createdAt: new Date().toISOString(), verifiedAt: '', deleted: false,
      }) }));
      // The unique assetId index prevents two tabs without Web Locks from creating
      // competing pending intents for the same subscription.
      const journal: SubscriptionSaveJournal = { id, assetId: next.id,
        expectedMarker: expected?.lastSubscriptionSaveId ?? '', next: rowFor('asset', next), relations };
      for (const fileId of next.attachments) if (!(await this.fileStore.blobs.get(fileId))) throw Error('attachment-missing');
      try {
        await this.fileStore.transaction('rw', [this.fileStore.subscriptionSaveJournal, this.fileStore.categoryEditJournal], async (scopeTx2) => {
          const repositoryTx2 = this.withStorage(scopeTx2);

          await assertCategoryMutationAllowed(repositoryTx2.records, repositoryTx2.fileStore, [{ type: 'asset', id: next.id, kind: next.kind }]);
          await repositoryTx2.fileStore.subscriptionSaveJournal.add(journal);
        });
      } catch (error) {
        if (await this.getPendingSubscriptionSave(next.id)) throw Error('subscription-relations-pending');
        throw error;
      }
      try {
        await this.fileStore.transaction('rw', [this.fileStore.subscriptionSaveJournal, this.fileStore.categoryEditJournal], async (scopeTx3) => {
          const repositoryTx3 = this.withStorage(scopeTx3);

          await assertCategoryMutationAllowed(repositoryTx3.records, repositoryTx3.fileStore, [{ type: 'asset', id: next.id, kind: next.kind }]);
          // A second tab may cancel an uncommitted intent before this transaction
          // starts. Never commit the asset after its recovery record has disappeared.
          if (!(await repositoryTx3.fileStore.subscriptionSaveJournal.get(id))) throw Error('asset-stale');
          await repositoryTx3.fileStore.outsideTransaction(() => repositoryTx3.saveEntityUnlocked('asset', next,
            expected ? rowFor('asset', expected).payload : null, true, true));
        });
      } catch (error) {
        try {
          const outcome = await replaySubscriptionSave(this.records, this.fileStore, id);
          if (outcome === 'committed' || await subscriptionSaveComplete(this.records, journal)) return next;
        } catch (recoveryError) {
          this.subscriptionRecoveryError = recoveryError instanceof Error ? recoveryError.message : 'subscription-relations-pending';
          throw Error('subscription-relations-pending');
        }
        throw error;
      }
      try {
        if (await replaySubscriptionSave(this.records, this.fileStore, id) !== 'committed' &&
          !(await subscriptionSaveComplete(this.records, journal))) throw Error('asset-stale');
      }
      catch (error) {
        if (error instanceof Error && error.message === 'asset-stale') throw error;
        this.subscriptionRecoveryError = error instanceof Error ? error.message : 'subscription-relations-pending';
        throw Error('subscription-relations-pending');
      }
      if (!(await this.fileStore.subscriptionSaveJournal.count())) this.subscriptionRecoveryError = null;
      return next;
    });
  }

  async saveTaskIfCurrent(expected: Task, next: Task): Promise<RecordRow> {
    if (expected.id !== next.id || expected.projectWorkflow?.roundId !== next.projectWorkflow?.roundId) throw Error('task-stale');
    if (expected.assetId !== next.assetId && !expected.impactSnapshot && !expected.projectWorkflow && !expected.maintenancePlan) return this.saveManualTaskIfCurrent(expected, next);
    return withRenewalLock(`keepany-task:${this.records.name}`, () => this.saveUnlocked('task', next, rowFor('task', expected).payload));
  }

  /** Ordinary task form saves validate a newly selected target under the mutation gate. */
  async saveManualTaskIfCurrent(expected: Task | null, value: Task): Promise<RecordRow> {
    const next = entitySchemas.task.parse(value);
    const special = (task: Task) => !!(task.impactSnapshot || task.projectWorkflow || task.maintenancePlan);
    if (next.deleted || next.purged || special(next) || expected && (expected.deleted || expected.purged || special(expected) ||
      expected.id !== next.id || expected.createdAt !== next.createdAt || expected.done !== next.done || expected.completedAt !== next.completedAt ||
      JSON.stringify(expected.completionHistory) !== JSON.stringify(next.completionHistory))) throw Error('task-stale');
    return withRenewalLock(`keepany-task:${this.records.name}`, () => withCategoryMutationGate(this.records, this.fileStore,
      [{ type: 'task', id: next.id }, ...(next.assetId ? [{ type: 'asset' as const, id: next.assetId }] : [])], async scope => {
        const repository = this.withStorage(scope);
        if (next.assetId && (!expected || expected.assetId !== next.assetId)) {
          const target = await repository.get<Asset>('asset', next.assetId);
          if (!target || target.deleted || target.purged) throw Error('task-target-changed');
        }
        return repository.saveEntityUnlocked('task', next, expected ? rowFor('task', expected).payload : null);
      }));
  }

  async deleteTaskIfCurrent(expected: Task): Promise<RecordRow> {
    if (expected.deleted || expected.purged || expected.impactSnapshot || expected.projectWorkflow || expected.maintenancePlan) throw Error('task-stale');
    return this.saveTaskIfCurrent(expected, { ...expected, deleted: true });
  }

  async restoreTaskIfCurrent(expected: Task): Promise<RecordRow> {
    if (!expected.deleted || expected.purged || expected.impactSnapshot || expected.projectWorkflow || expected.maintenancePlan) throw Error('task-stale');
    return withRenewalLock(`keepany-task:${this.records.name}`, () => this.restoreEntityUnlocked('task', expected.id, rowFor('task', expected).payload))
      .catch(error => { if (error instanceof Error && error.message === 'not-in-trash') throw Error('task-stale'); throw error; });
  }

  async restoreSubmissionIfCurrent(expected: Submission): Promise<RecordRow> {
    if (!expected.deleted || expected.purged) throw Error('submission-stale');
    return this.restoreEntityUnlocked('submission', expected.id, rowFor('submission', expected).payload)
      .catch(error => { if (error instanceof Error && ['relation-stale', 'not-in-trash'].includes(error.message)) throw Error('submission-stale'); throw error; });
  }

  async saveSubmissionIfCurrent(expected: Submission, next: Submission): Promise<RecordRow> {
    if (expected.id !== next.id || expected.assetId !== next.assetId || expected.deleted || next.deleted) throw Error('submission-stale');
    return this.saveUnlocked('submission', next, rowFor('submission', expected).payload);
  }

  async deleteSubmissionIfCurrent(expected: Submission): Promise<RecordRow> {
    if (expected.deleted || expected.purged) throw Error('submission-stale');
    return this.saveUnlocked('submission', { ...expected, deleted: true }, rowFor('submission', expected).payload);
  }

  /** One confirmed bill, with any number of explicit ordinary-asset owners. */
  async createFinanceEntry(value: History): Promise<RecordRow> {
    const next = entitySchemas.history.parse(value);
    if (next.deleted || !financeActions.includes(next.action as typeof financeActions[number])) throw Error('finance-invalid');
    return withCategoryMutationGate(this.records, this.fileStore, [], async (scopeGate2) => {
      const repositoryGate2 = this.withStorage(scopeGate2);

      await repositoryGate2.assertFinanceTargets(next);
      return repositoryGate2.saveEntityUnlocked('history', next, null);
    });
  }

  /** Keep the original ID/action/time and reject an edit or deletion based on stale contents. */
  async saveFinanceEntryIfCurrent(expected: History, value: History): Promise<RecordRow> {
    const next = entitySchemas.history.parse(value);
    if (expected.id !== next.id || expected.action !== next.action || expected.createdAt !== next.createdAt ||
      expected.deleted || expected.purged || expected.financeCorrection?.purged || next.financeCorrection?.purged || !(expected.action === 'renew' || financeActions.includes(expected.action as typeof financeActions[number]))) throw Error('history-stale');
    if (expected.action === 'renew') {
      const originalFields = (entry: History) => JSON.stringify({ ...entry, assetIds: undefined, financeCorrection: undefined });
      if (originalFields(next) !== originalFields(expected)) throw Error('finance-renewal-immutable');
    }
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      return withCategoryMutationGate(this.records, this.fileStore, [], async (scopeGate3) => {
        const repositoryGate3 = this.withStorage(scopeGate3);

        if (!next.deleted && !next.financeCorrection?.hidden) await repositoryGate3.assertFinanceTargets(next);
        return repositoryGate3.saveEntityUnlocked('history', next, rowFor('history', expected).payload);
      });
    });
  }

  private async assertFinanceTargets(entry: History): Promise<void> {
    const ids = historyAssetIds(entry);
    const rows = await this.records.getMany(ids.map(id => key('asset', id)), false);
    const targets = new Map(rows.map(row => {
      const asset = entitySchemas.asset.parse(JSON.parse(row.payload));
      return [asset.id, asset] as const;
    }));
    if (ids.some(id => { const target = targets.get(id); return !target || target.deleted || target.purged || target.kind === 'vault'; })) throw Error('finance-target-changed');
  }

  /** Unhide a ledger projection, never replay a renewal or restore an erased fact. */
  async restoreFinanceEntryIfCurrent(expected: History): Promise<RecordRow> {
    if (expected.purged || expected.financeCorrection?.purged) throw Error('history-stale');
    if (expected.action === 'renew') {
      if (expected.deleted || !expected.financeCorrection?.hidden) throw Error('history-stale');
      return this.saveFinanceEntryIfCurrent(expected, { ...expected, financeCorrection: { ...expected.financeCorrection, hidden: false } });
    }
    if (!expected.deleted || !financeActions.includes(expected.action as typeof financeActions[number])) throw Error('history-stale');
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      return this.restoreEntityUnlocked('history', expected.id, rowFor('history', expected).payload)
        .catch(error => { if (error instanceof Error && error.message === 'not-in-trash') throw Error('history-stale'); throw error; });
    });
  }

  async archiveProjectIfWorkflowComplete(expectedProject: Asset, expectedRoundId: string): Promise<RecordRow> {
    if (expectedProject.kind !== 'project' || expectedProject.deleted || expectedProject.status === 'archived' || !expectedRoundId) throw Error('workflow-stale');
    return withRenewalLock(`keepany-task:${this.records.name}`, async () => {
      const tasks = await this.list<Task>('task', true);
      const round = currentProjectWorkflowRound(tasks, expectedProject.id, 'close');
      if (!round.length || round[0].projectWorkflow?.roundId !== expectedRoundId ||
        tasks.some(task => task.deleted && task.projectWorkflow?.roundId === expectedRoundId) ||
        round.some(task => !['done', 'na'].includes(task.projectWorkflow?.record?.outcome ?? '')) ||
        !round.some(task => task.projectWorkflow?.step === 'closeDecision' && task.projectWorkflow.record?.outcome === 'done')) throw Error('workflow-stale');
      return this.saveUnlocked('asset', { ...expectedProject, status: 'archived', updatedAt: new Date().toISOString() }, rowFor('asset', expectedProject).payload);
    });
  }

  async savePreferenceIfCurrent(expected: { id: string; value: unknown } | null, next: { id: string; value: unknown }): Promise<RecordRow> {
    if (expected && expected.id !== next.id) throw Error('preference-stale');
    return this.saveUnlocked('preference', next, expected ? rowFor('preference', expected).payload : null);
  }

  async saveReminderPreferenceIfCurrent(expected: { id: string; value: unknown } | null, next: { id: string; value: unknown }, expectedAsset?: Asset): Promise<RecordRow> {
    if (next.id !== 'reminder-settings' || (expected && expected.id !== next.id)) throw Error('preference-stale');
    return withCategoryMutationGate(this.records, this.fileStore, [], async (scopeGate4) => {
      const repositoryGate4 = this.withStorage(scopeGate4);

      if (expectedAsset) {
        const [row] = await repositoryGate4.records.getMany([key('asset', expectedAsset.id)], false);
        const current = row ? entitySchemas.asset.parse(JSON.parse(row.payload)) : null;
        if (!current || current.deleted || current.kind !== 'subscription' || current.status !== 'active' || JSON.stringify(current) !== rowFor('asset', expectedAsset).payload) throw Error('asset-stale');
      }
      return repositoryGate4.saveEntityUnlocked('preference', next, expected ? rowFor('preference', expected).payload : null);
    });
  }

  // The existing mutation gate excludes edits, completions and deletions in every tab.
  // Persist an at-most-once receipt before the synchronous notification callback.
  async deliverReminderIfCurrent(input: { id: string; sourceType: 'task' | 'asset'; expected: Task | Asset; expectedPreference: { id: string; value: unknown } | null; scheduledAt: string }, deliver: () => void): Promise<boolean> {
    if (!/^reminder-delivery:[a-f0-9]{64}$/.test(input.id) || !Number.isFinite(Date.parse(input.scheduledAt)) || Date.parse(input.scheduledAt) > Date.now()) throw Error('reminder-invalid');
    return withCategoryMutationGate(this.records, this.fileStore, [], async (scopeGate5) => {
      const repositoryGate5 = this.withStorage(scopeGate5);

      const read = async (type: EntityType, id: string) => {
        const [row] = await repositoryGate5.records.getMany([key(type, id)], false);
        return row ? parsedPayload(row as RecordRow) : null;
      };
      const current = await read(input.sourceType, input.expected.id);
      if (!current || current.deleted || JSON.stringify(current) !== rowFor(input.sourceType, input.expected).payload) return false;
      if (input.sourceType === 'task') {
        const task = current as Task;
        if (task.done) return false;
        if (task.assetId) {
          const asset = await read('asset', task.assetId) as Asset | null;
          if (!asset || asset.deleted || (asset.kind === 'subscription' && asset.status !== 'active')) return false;
        }
      } else if ((current as Asset).kind !== 'subscription' || (current as Asset).status !== 'active') return false;
      const settings = await read('preference', 'reminder-settings');
      if (JSON.stringify(settings) !== JSON.stringify(input.expectedPreference ? entitySchemas.preference.parse(input.expectedPreference) : null)) return false;
      if (await read('preference', input.id)) return false;
      await repositoryGate5.saveEntityUnlocked('preference', { id: input.id, value: { sourceType: input.sourceType, sourceId: input.expected.id, scheduledAt: input.scheduledAt, deliveredAt: new Date().toISOString() } }, null);
      deliver();
      return true;
    });
  }

  private async saveUnlocked(type: EntityType, value: unknown, expectedPayload?: string | null, subscriptionSave = false): Promise<RecordRow> {
    // Recovery validates one actual RxDB snapshot while holding this table.
    // Histories and tasks must not change behind that validation either.
    const entity = parseEntity(type, value) as Asset | Category | { id: string };
    if (type === 'asset') for (const id of (entity as Asset).attachments) {
      if (!(await this.fileStore.blobs.get(id))) throw Error('attachment-missing');
    }
    return withCategoryMutationGate(this.records, this.fileStore, [{ type, id: entity.id, ...('kind' in entity ? { kind: entity.kind } : {}) }],
      async (scopeGate6) => {
      const repositoryGate6 = this.withStorage(scopeGate6);
return repositoryGate6.saveEntityUnlocked(type, value, expectedPayload, subscriptionSave, true);
    });
  }

  private async saveEntityUnlocked(type: EntityType, value: unknown, expectedPayload?: string | null, subscriptionSave = false, attachmentsChecked = false): Promise<RecordRow> {
    if (type === 'asset' && this.renewalRecoveryError) throw Error('renewal-recovery-pending');
    const next = rowFor(type, value);
    const entity = parsedPayload(next) as Record<string, unknown>;
    // A queued edit must not append personal contents to an already erased parent.
    const erasedParentIds = type === 'relation' ? [entity.from, entity.to]
      : type === 'history' ? historyReferenceIds(entity as unknown as History)
      : ['task', 'submission'].includes(type) ? [entity.assetId] : [];
    for (const id of erasedParentIds) {
      if (typeof id === 'string' && id && (await this.get<{ purged?: boolean }>('asset', id))?.purged) throw Error('trash-purged');
    }
    if (type === 'history' && (entity.assetIds || entity.financeCorrection) && !entity.deleted && !(entity.financeCorrection as History['financeCorrection'])?.hidden) await this.assertFinanceTargets(entity as unknown as History);
    if (type === 'task') {
      const task = entity as unknown as Task;
      if (task.projectWorkflow?.step === 'closeDecision' && task.projectWorkflow.record) {
        const tasks = await this.list<Task>('task', true);
        const round = currentProjectWorkflowRound(tasks, task.projectWorkflow.projectId, 'close');
        if (!round.some(row => row.id === task.id) || round[0]?.projectWorkflow?.roundId !== task.projectWorkflow.roundId ||
          tasks.some(row => row.deleted && row.projectWorkflow?.roundId === task.projectWorkflow?.roundId) ||
          !canRecordProjectWorkflowTask(task, round)) throw Error('workflow-stale');
      }
    }
    if (type === 'asset' && !attachmentsChecked) {
      for (const id of entity.attachments as string[]) {
        if (!(await this.fileStore.blobs.get(id))) throw Error('attachment-missing');
      }
    }
    if (type === 'relation' && !entity.deleted) {
      await this.assertRelationEndpoints(entity as { from: string; to: string });
    }
    if (type === 'task' && entity.dedupeKey && !entity.deleted && !entity.done) {
      const tasks = await this.list<{ id: string; dedupeKey: string; done: boolean }>('task');
      if (tasks.some(task => task.id !== entity.id && task.dedupeKey === entity.dedupeKey && !task.done)) throw Error('task-duplicate');
    }
    const current = await this.records.get(next.id);
    if (current) {
      await this.records.modify(current.id, (data: RecordRow) => {
        if (expectedPayload === null || (expectedPayload !== undefined && JSON.stringify(parsedPayload(data)) !== expectedPayload)) throw Error(type === 'task' ? 'task-stale' : type === 'preference' ? 'preference-stale' : type === 'submission' ? 'submission-stale' : type === 'history' ? 'history-stale' : 'asset-stale');
        if (isPurgedPayload(type, data.payload) && next.payload !== data.payload) throw Error('trash-purged');
        if (parsedPayload(data).deleted && !parsedPayload(next).deleted) throw Error('tombstone-restore-required');
        if (type === 'category') {
          const previous = parsedPayload(data) as Category, proposed = parsedPayload(next) as Category;
          if (previous.kind !== proposed.kind || previous.name !== proposed.name || previous.order !== proposed.order) throw Error('category-stale');
        }
        if (type === 'asset') {
          const previous = parsedPayload(data) as Asset;
          const proposed = parsedPayload(next) as Asset;
          if (previous.kind !== proposed.kind && (previous.kind === 'item' || proposed.kind === 'item')) throw Error('asset-kind-immutable');
          if (previous.lastRenewalId !== proposed.lastRenewalId) throw Error('asset-stale-renewal');
          if (!subscriptionSave && previous.lastSubscriptionSaveId !== proposed.lastSubscriptionSaveId) throw Error('asset-stale');
          if (previous.lastItemEventId !== proposed.lastItemEventId) throw Error('item-stale');
          if (previous.kind === 'item' &&
            (previous.status !== proposed.status || previous.borrower !== proposed.borrower ||
              previous.itemLifecycleStatus !== proposed.itemLifecycleStatus || previous.itemStatusDate !== proposed.itemStatusDate ||
              previous.itemExpectedReturnDate !== proposed.itemExpectedReturnDate)) throw Error('item-action-required');
        }
        return { ...data, ...next };
      });
    } else {
      if (expectedPayload !== undefined && expectedPayload !== null) throw Error(type === 'task' ? 'task-stale' : type === 'preference' ? 'preference-stale' : type === 'submission' ? 'submission-stale' : type === 'history' ? 'history-stale' : 'asset-stale');
      if (type === 'asset' && entity.kind === 'item' &&
        (entity.status !== 'active' || entity.borrower ||
          (entity.itemLifecycleStatus !== null && entity.itemLifecycleStatus !== 'inUse') || entity.itemStatusDate)) throw Error('item-action-required');
      try {
        await this.records.insert(next);
      } catch (error) {
        if (!(await this.records.get(next.id))) throw error;
        if (expectedPayload !== undefined) throw Error(type === 'task' ? 'task-stale' : type === 'preference' ? 'preference-stale' : type === 'submission' ? 'submission-stale' : type === 'history' ? 'history-stale' : 'asset-stale');
        return this.saveEntityUnlocked(type, value, undefined, subscriptionSave, attachmentsChecked);
      }
    }
    return next;
  }

  // Re-read the current row inside RxDB's CAS retry to preserve every completion timestamp.
  async setTaskDone(id: string, expectedDone: boolean, expectedReminderAt?: string, expectedTask?: Task): Promise<Task> {
    if (expectedTask && expectedTask.id !== id) throw Error('task-stale');
    const expectedPayload = expectedTask ? rowFor('task', expectedTask).payload : undefined;
    return withRenewalLock(`keepany-task:${this.records.name}`, async () => {
      return withCategoryMutationGate(this.records, this.fileStore, [], async (scopeGate7) => {
        const repositoryGate7 = this.withStorage(scopeGate7);

      const current = await repositoryGate7.records.get(key('task', id));
      if (!current) throw Error('task-stale');
      const before = entitySchemas.task.parse(JSON.parse(canonical(current).payload));
      if (expectedPayload !== undefined && JSON.stringify(before) !== expectedPayload) throw Error('task-stale');
      if (before.reminder?.rule.mode !== undefined && before.reminder.rule.mode !== 'once' && before.reminder.at !== expectedReminderAt) throw Error('task-stale');
      const now = new Date().toISOString();
      const recurringReminder = !expectedDone && before.reminder ? advanceTaskReminder(before.reminder, now) : null;
      const nextDueDate = recurringReminder ? zonedParts(recurringReminder.at, recurringReminder.timeZone).date : before.dueDate;
      const nextDedupeKey = recurringReminder && before.dedupeKey.startsWith('manual:') ? `${before.dedupeKey.slice(0, before.dedupeKey.lastIndexOf(':'))}:${nextDueDate}` : before.dedupeKey;
      if (recurringReminder && nextDedupeKey) {
        const tasks = await repositoryGate7.list<Task>('task');
        if (tasks.some(task => task.id !== id && !task.done && task.dedupeKey === nextDedupeKey)) throw Error('task-duplicate');
      }
      if (expectedDone && before.dedupeKey) {
        const tasks = await repositoryGate7.list<Task>('task');
        if (tasks.some(task => task.id !== id && !task.done && task.dedupeKey === before.dedupeKey)) throw Error('task-duplicate');
      }
      let result: Task | null = null;
      await repositoryGate7.records.modify(current.id, (data: RecordRow) => {
        const task = entitySchemas.task.parse(JSON.parse(data.payload));
        if (expectedPayload !== undefined && JSON.stringify(task) !== expectedPayload) throw Error('task-stale');
        if (task.deleted || task.done !== expectedDone || (task.reminder?.rule.mode !== undefined && task.reminder.rule.mode !== 'once' && task.reminder.at !== expectedReminderAt)) throw Error('task-stale');
        const history = task.completionHistory.length ? task.completionHistory :
          task.done && task.completedAt ? [task.completedAt] : [];
        result = entitySchemas.task.parse({ ...task, ...(recurringReminder ? { reminder: recurringReminder, dueDate: nextDueDate, dedupeKey: nextDedupeKey } : {}), done: recurringReminder ? false : !expectedDone,
          completedAt: expectedDone || recurringReminder ? '' : now,
          completionHistory: expectedDone ? history : [...history, now] });
        return { ...data, payload: JSON.stringify(result), updatedAt: Date.now() };
      });
      if (!result) throw Error('task-stale');
      return result;
      });
    });
  }

  async setItemArchived(id: string, expectedStatus: 'active' | 'archived'): Promise<Asset> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      return withCategoryMutationGate(this.records, this.fileStore, [{ type: 'asset', id, kind: 'item' }], async (scopeGate8) => {
        const repositoryGate8 = this.withStorage(scopeGate8);

      const current = await repositoryGate8.records.get(key('asset', id));
      if (!current) throw Error('item-stale');
      let result: Asset | null = null;
      await repositoryGate8.records.modify(current.id, (data: RecordRow) => {
        const item = entitySchemas.asset.parse(JSON.parse(data.payload));
        if (item.kind !== 'item' || item.deleted || item.status !== expectedStatus || item.borrower) throw Error('item-stale');
        result = entitySchemas.asset.parse({ ...item, status: expectedStatus === 'active' ? 'archived' : 'active',
          updatedAt: new Date().toISOString() });
        return { ...data, payload: JSON.stringify(result), updatedAt: Date.now() };
      });
      if (!result) throw Error('item-stale');
      return result;
      });
    });
  }

  // New records only. A durable journal rolls back partial writes after errors or interruption.
  async saveBatch(items: ReadonlyArray<{ type: EntityType; value: unknown }>): Promise<number> {
    const run = () => withRenewalLock(`keepany-batch:${this.records.name}`, () => this.saveBatchUnlocked(items));
    return items.some(item => item.type === 'task')
      ? withRenewalLock(`keepany-task:${this.records.name}`, run) : run();
  }

  async saveBatchIfAssetsCurrent(items: ReadonlyArray<{ type: EntityType; value: unknown }>, expectedAssets: readonly Asset[]): Promise<number> {
    return withRenewalLock(`keepany-batch:${this.records.name}`, () => this.saveBatchUnlocked(items, expectedAssets));
  }

  private async saveBatchUnlocked(items: ReadonlyArray<{ type: EntityType; value: unknown }>, expectedAssets: readonly Asset[] = []): Promise<number> {
    if (!items.length || items.length > 1000) throw Error('batch-size');
    const rows = items.map(item => rowFor(item.type, item.value));
    const ids = new Set(rows.map(row => row.id));
    if (ids.size !== rows.length) throw Error('batch-duplicate');
    const liveAssets = new Map<string, boolean>();
    for (const row of rows.filter(row => row.type === 'asset')) {
      const asset = parsedPayload(row);
      liveAssets.set(asset.id, !asset.deleted);
      if ((asset as unknown as Asset).kind === 'item' &&
        ((asset as unknown as Asset).status !== 'active' || (asset as unknown as Asset).borrower ||
          ((asset as unknown as Asset).itemLifecycleStatus !== null && (asset as unknown as Asset).itemLifecycleStatus !== 'inUse') ||
          (asset as unknown as Asset).itemStatusDate)) throw Error('item-action-required');
      for (const id of (asset as unknown as { attachments: string[] }).attachments) {
        if (!(await this.fileStore.blobs.get(id))) throw Error('attachment-missing');
      }
    }
    const taskKeys = new Set<string>();
    const existingTasks = await this.list<{ id: string; dedupeKey: string; done: boolean }>('task');
    for (const row of rows) {
      if (await this.records.get(row.id)) throw Error('batch-existing');
      const value = parsedPayload(row) as Record<string, unknown>;
      if (row.type === 'relation' && !value.deleted) {
        for (const endpoint of [value.from, value.to] as string[]) {
          const live = liveAssets.get(endpoint);
          if (live === false) throw Error('relation-endpoint');
          if (live === undefined) {
            const existing = await this.get<{ deleted: boolean }>('asset', endpoint);
            if (!existing || existing.deleted) throw Error('relation-endpoint');
          }
        }
      }
      if (row.type === 'task' && value.dedupeKey && !value.done && !value.deleted) {
        const dedupeKey = value.dedupeKey as string;
        if (taskKeys.has(dedupeKey) || existingTasks.some(task => task.dedupeKey === dedupeKey && !task.done)) throw Error('task-duplicate');
        taskKeys.add(dedupeKey);
      }
    }
    const expected = expectedAssets.map(asset => rowFor('asset', entitySchemas.asset.parse(asset)));
    const assertAssetsCurrent = async (records: RecordBackend) => {
      for (const asset of expected) {
        const [current] = await records.getMany([asset.id], false);
        if (!current || JSON.stringify(parsedPayload(current as RecordRow)) !== asset.payload) throw Error('asset-stale');
      }
    };
    const id = crypto.randomUUID();
    const targets = rows.map(row => {
      const value = parsedPayload(row) as Asset | Category | { id: string };
      return { type: row.type, id: value.id, ...('kind' in value ? { kind: value.kind } : {}) };
    });
    await this.fileStore.transaction('rw', [this.fileStore.categoryEditJournal, this.fileStore.importJournal,
      this.fileStore.journal, this.fileStore.archiveMerge], async (scopeTx4) => {
      const repositoryTx4 = this.withStorage(scopeTx4);

      if (await repositoryTx4.fileStore.journal.count()) throw Error('restore-recovery-pending');
      if (await repositoryTx4.fileStore.archiveMerge.count()) throw Error('archive-merge-pending');
      await assertCategoryMutationAllowed(repositoryTx4.records, repositoryTx4.fileStore, targets);
      await repositoryTx4.fileStore.outsideTransaction(() => assertAssetsCurrent(repositoryTx4.records));
      await repositoryTx4.fileStore.importJournal.put({ id, rows });
    });
    try {
      await this.fileStore.transaction('rw', [this.fileStore.categoryEditJournal, this.fileStore.importJournal,
        this.fileStore.journal, this.fileStore.archiveMerge], async (scopeTx5) => {
        const repositoryTx5 = this.withStorage(scopeTx5);

        if (await repositoryTx5.fileStore.journal.count()) throw Error('restore-recovery-pending');
        if (await repositoryTx5.fileStore.archiveMerge.count()) throw Error('archive-merge-pending');
        await assertCategoryMutationAllowed(repositoryTx5.records, repositoryTx5.fileStore, targets);
        if (!(await repositoryTx5.fileStore.importJournal.get(id))) throw Error('batch-insert-failed');
        const result = await repositoryTx5.fileStore.outsideTransaction(async () => {
          await assertAssetsCurrent(repositoryTx5.records);
          return repositoryTx5.records.insertMany(rows);
        });
        if (result.error.length) throw Error('batch-insert-failed');
        await repositoryTx5.fileStore.importJournal.delete(id);
      });
      return rows.length;
    } catch (error) {
      await rollbackImport(this.records, this.fileStore, id);
      throw error;
    }
  }

  private async settleRenewalJournals(): Promise<void> {
    for (const entry of await this.fileStore.renewalJournal.toArray()) {
      try { await replayRenewalJournal(this.records, this.fileStore, entry.id); }
      catch (error) {
        this.renewalRecoveryError = error instanceof Error ? error.message : 'renewal-recovery-pending';
        throw Error('renewal-recovery-pending');
      }
    }
    this.renewalRecoveryError = null;
  }

  // The wrapped RxDB storage sends both rows through one Dexie transaction. Its CAS can
  // reject one row while accepting the other, so the durable journal repairs that case.
  async recordRenewal(expectedAsset: Asset, nextAsset: Asset, history: History): Promise<void> {
    const expected = entitySchemas.asset.parse(expectedAsset);
    const next = entitySchemas.asset.parse(nextAsset);
    const event = entitySchemas.history.parse(history);
    const anchor = expected.billingAnchor || expected.dueDate;
    const unchanged = Object.keys(expected).every(field =>
      ['dueDate', 'billingAnchor', 'renewalCount', 'lastRenewalId', 'updatedAt'].includes(field) ||
      JSON.stringify(expected[field as keyof Asset]) === JSON.stringify(next[field as keyof Asset]));
    if (expected.kind !== 'subscription' || expected.status !== 'active' || expected.deleted || !expected.dueDate ||
      next.id !== expected.id || next.kind !== 'subscription' || next.status !== 'active' || next.deleted ||
      next.renewalCount !== expected.renewalCount + 1 || next.billingAnchor !== anchor ||
      next.lastRenewalId !== event.id ||
      next.dueDate !== dueOnCycle(anchor, expected.cycle, expected.interval, next.renewalCount) ||
      !unchanged ||
      event.action !== 'renew' || event.assetId !== expected.id || event.deleted ||
      event.billDate !== expected.dueDate || event.amount === undefined || event.currency !== expected.currency) {
      throw Error('renewal-invalid');
    }
    await this.recordHistoryPair(expected, next, event, 'renewal');
  }

  async recordItemAction(expectedAsset: Asset, nextAsset: Asset, history: History): Promise<void> {
    const expected = entitySchemas.asset.parse(expectedAsset);
    const next = entitySchemas.asset.parse(nextAsset);
    const event = entitySchemas.history.parse(history);
    const unchanged = Object.keys(expected).every(field =>
      ['status', 'borrower', 'itemLifecycleStatus', 'itemStatusDate', 'itemExpectedReturnDate', 'lastItemEventId', 'updatedAt'].includes(field) ||
      JSON.stringify(expected[field as keyof Asset]) === JSON.stringify(next[field as keyof Asset]));
    const active = expected.status === 'active';
    const loaned = expected.status === 'loaned';
    const validTransition = event.action === 'loan'
      ? active && !['repairing','resold','retired'].includes(expected.itemLifecycleStatus ?? '') &&
        next.status === 'loaned' && !!next.borrower.trim() &&
        event.borrower === next.borrower && !expected.borrower &&
        next.itemExpectedReturnDate === (event.expectedReturnDate ?? '')
      : event.action === 'return'
        ? loaned && next.status === 'active' && !next.borrower && event.borrower === expected.borrower &&
          !next.itemExpectedReturnDate && !event.expectedReturnDate
        : event.action === 'maintenance'
          ? (active || loaned) && !['resold','retired'].includes(expected.itemLifecycleStatus ?? '') &&
            next.status === expected.status && next.borrower === expected.borrower &&
            next.itemExpectedReturnDate === expected.itemExpectedReturnDate && !!event.note.trim() && !!event.eventDate
          : event.action === 'itemStatus' && (active || loaned || expected.status === 'archived') &&
            event.itemStatusBefore === expected.itemLifecycleStatus && !!event.itemStatusAfter && !!event.eventDate &&
            (expected.itemLifecycleStatus !== event.itemStatusAfter || expected.itemStatusDate !== event.eventDate) &&
            (!loaned || !['resold','retired'].includes(event.itemStatusAfter)) &&
            next.status === expected.status && next.borrower === expected.borrower &&
            next.itemExpectedReturnDate === expected.itemExpectedReturnDate &&
            next.itemLifecycleStatus === event.itemStatusAfter && next.itemStatusDate === event.eventDate;
    if (expected.kind !== 'item' || expected.deleted || next.id !== expected.id ||
      next.kind !== 'item' || next.deleted || !unchanged || !validTransition ||
      (event.action !== 'itemStatus' && (event.itemStatusBefore !== undefined || event.itemStatusAfter !== undefined)) ||
      (event.action !== 'itemStatus' && (next.itemLifecycleStatus !== expected.itemLifecycleStatus || next.itemStatusDate !== expected.itemStatusDate)) ||
      next.lastItemEventId !== event.id || event.assetId !== expected.id || event.deleted ||
      (event.eventDate !== undefined && !event.eventDate)) throw Error('item-invalid');
    await this.recordHistoryPair(expected, next, event, 'item');
  }

  private async recordHistoryPair(expected: Asset, next: Asset, event: History,
    kind: 'renewal' | 'item'): Promise<void> {
    const lockName = `keepany-renewal:${this.records.name}`;
    await withRenewalLock(lockName, async () => {
      await this.settleRenewalJournals();
      for (let attempt = 0; attempt < 3; attempt++) {
        // Direct storage writes can leave RxDocument._data at an older revision until
        // its change event arrives. Read the storage revision used by the CAS itself.
        const [current] = await this.records.getMany([key('asset', expected.id)], false);
        const [existingHistory] = await this.records.getMany([key('history', event.id)], false);
        if (!current || existingHistory) throw Error(kind === 'item' ? 'item-stale' : 'renewal-stale');
        const currentRow = current as RecordRow;
        const currentAsset = entitySchemas.asset.parse(JSON.parse(currentRow.payload));
        if (JSON.stringify(currentAsset) !== JSON.stringify(expected)) throw Error(kind === 'item' ? 'item-stale' : 'renewal-stale');
        const nextRow = rowFor('asset', next);
        const historyRow = rowFor('history', event);
        const journalId = crypto.randomUUID();
        await this.fileStore.transaction('rw', [this.fileStore.categoryEditJournal, this.fileStore.renewalJournal], async (scopeTx6) => {
          const repositoryTx6 = this.withStorage(scopeTx6);

          await assertCategoryMutationAllowed(repositoryTx6.records, repositoryTx6.fileStore, [{ type: 'asset', id: expected.id, kind: expected.kind }]);
          await repositoryTx6.fileStore.renewalJournal.add({ id: journalId, assetId: expected.id,
            expectedPayload: currentRow.payload, next: nextRow, history: historyRow });
        });
        try {
          await this.fileStore.transaction('rw', [this.fileStore.categoryEditJournal, this.fileStore.renewalJournal], async (scopeTx7) => {
            const repositoryTx7 = this.withStorage(scopeTx7);

            await assertCategoryMutationAllowed(repositoryTx7.records, repositoryTx7.fileStore, [{ type: 'asset', id: expected.id, kind: expected.kind }]);
            if (!(await repositoryTx7.fileStore.renewalJournal.get(journalId))) throw Error(kind === 'item' ? 'item-stale' : 'renewal-stale');
            const result = await repositoryTx7.fileStore.outsideTransaction(() => repositoryTx7.records.compareAndWrite([
              { previous: current, next: { ...current, ...nextRow } },
              { previous: null, next: historyRow },
            ], `keepany-${kind}`));
            if (result.error.length) throw Error(result.error.some(error => error.status === 409) ?
              (kind === 'item' ? 'item-stale' : 'renewal-stale') : `${kind}-write-failed`);
            // A failed cleanup leaves a committed pair that replay can recognize.
            await repositoryTx7.fileStore.renewalJournal.delete(journalId).catch(() => {});
          });
          return;
        } catch (error) {
          let outcome: 'committed' | 'cancelled';
          try { outcome = await replayRenewalJournal(this.records, this.fileStore, journalId); }
          catch (recoveryError) {
            this.renewalRecoveryError = recoveryError instanceof Error ? recoveryError.message : 'renewal-recovery-pending';
            throw Error('renewal-recovery-pending');
          }
          if (outcome === 'committed') return;
          // A storage revision can advance while its payload remains unchanged.
          // Retry only a CAS conflict after the journal has cancelled its own row;
          // the next iteration rechecks the exact expected asset payload.
          if (error instanceof Error && error.message === (kind === 'item' ? 'item-stale' : 'renewal-stale') &&
            attempt < 2) continue;
          throw error;
        }
      }
    });
  }

  async syncCursor(): Promise<number> { return (await this.fileStore.syncMeta.get('cursor'))?.cursor ?? 0; }

  async getDatasetBinding(): Promise<DatasetBinding | null> {
    const binding = await this.fileStore.datasetBinding.get('active');
    if (!binding) return null;
    const { endpoint, accountId, workspaceId, scope } = binding;
    return { endpoint, accountId, workspaceId, scope };
  }

  // RxDB records are one local dataset. Only an explicit migration may attach them to another remote.
  async claimDatasetBinding(binding: DatasetBinding): Promise<DatasetBinding> {
    await validateDatasetBinding(binding);
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedMeta,
        this.fileStore.scopedBase, this.fileStore.scopedOutbox, this.fileStore.scopedPull,
        this.fileStore.scopedAttachmentUploads, this.fileStore.syncBase, this.fileStore.syncMeta,
        this.fileStore.pullJournal, this.fileStore.journal], async (scopeTx8) => {
        const repositoryTx8 = this.withStorage(scopeTx8);

          if (await repositoryTx8.fileStore.journal.count()) throw Error('restore-recovery-pending');
          await claimDatasetBindingInTransaction(repositoryTx8.fileStore, binding);
      });
      return { ...binding };
    });
  }

  private async assertDatasetScope(scope: string): Promise<void> {
    const binding = await this.fileStore.datasetBinding.get('active');
    if (binding && binding.scope !== scope) throw Error('sync-dataset-bound');
  }

  private async assertArchiveMergeSyncAllowed(): Promise<void> {
    if (await this.fileStore.journal.count()) throw Error('restore-recovery-pending');
    if (await this.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
    if (await this.fileStore.subscriptionSaveJournal.count()) throw Error('subscription-relations-pending');
    await assertNoPendingReviewedConfirmations(this.fileStore);
    const pending = await this.fileStore.archiveMerge.get('active');
    if (pending && pending.phase !== 'syncing') throw Error('archive-merge-sync-paused');
  }

  async scopedCursor(scope: string): Promise<number> { return (await this.fileStore.scopedMeta.get(scope))?.cursor ?? 0; }

  async verifyPinnedScopedKey(scope: string, fingerprint: string, keyEpoch: number): Promise<void> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    const stored = await this.fileStore.scopedMeta.get(scope);
    if (!stored || stored.keyFingerprint !== fingerprint || stored.keyEpoch !== keyEpoch)
      throw Error('sync-key-mismatch');
  }

  // A key is fixed once ciphertext or an authenticated pull has durable local evidence.
  // A cursor-zero fingerprint alone may come from a failed first attempt or a crash.
  async pinScopedKey(scope: string, fingerprint: string, keyEpoch: number): Promise<'provisional' | 'trusted'> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    await this.assertDatasetScope(scope);
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw Error('sync-key');
    return this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedMeta,
      this.fileStore.scopedBase, this.fileStore.scopedOutbox, this.fileStore.scopedPull,
      this.fileStore.scopedAttachmentUploads, this.fileStore.journal], async (scopeTx9) => {
      const repositoryTx9 = this.withStorage(scopeTx9);

      if (await repositoryTx9.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const binding = await repositoryTx9.fileStore.datasetBinding.get('active');
      if (binding && binding.scope !== scope) throw Error('sync-dataset-bound');
      const existing = await repositoryTx9.fileStore.scopedMeta.get(scope);
      const [base, outbox, pull, uploads] = await Promise.all([
        (await repositoryTx9.fileStore.scopedBase.equals('scope', scope)).length,
        (await repositoryTx9.fileStore.scopedOutbox.equals('scope', scope)).length,
        repositoryTx9.fileStore.scopedPull.get(scope),
        (await repositoryTx9.fileStore.scopedAttachmentUploads.equals('scope', scope)).length,
      ]);
      const trusted = Boolean((existing?.cursor ?? 0) > 0 || base || outbox || pull || uploads);
      if (existing?.keyFingerprint === fingerprint && existing.keyEpoch === keyEpoch) return trusted ? 'trusted' : 'provisional';
      if (trusted || (existing?.keyEpoch && keyEpoch < existing.keyEpoch)) throw Error('sync-key-mismatch');
      await repositoryTx9.fileStore.scopedMeta.put({ id: scope, cursor: 0, keyFingerprint: fingerprint, keyEpoch });
      return 'provisional';
    });
  }

  async scopedBaseFor(scope: string, rowId: string): Promise<ScopedBase | null> {
    return (await this.fileStore.scopedBase.get(scopedKey(scope, rowId))) ?? null;
  }

  async listScopedOutbox(scope: string): Promise<ScopedOutbox[]> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    return this.fileStore.scopedOutbox.equals('scope', scope);
  }

  async getScopedAttachmentUpload(scope: string, attachmentId: string): Promise<ScopedAttachmentUploadPlan | null> {
    assertScope(scope);
    z.uuid().parse(attachmentId);
    await this.requireDatasetScope(scope);
    const stored = await this.fileStore.scopedAttachmentUploads.get(scopedKey(scope, attachmentId));
    return stored ? copyAttachmentPlan(stored) : null;
  }

  async putScopedAttachmentUpload(plan: ScopedAttachmentUploadPlan): Promise<ScopedAttachmentUploadPlan> {
    await this.assertArchiveMergeSyncAllowed();
    if (!plan || !Array.isArray(plan.objects) || plan.objects.some(object => !(object?.bytes instanceof Uint8Array)))
      throw Error('sync-attachment-plan');
    const snapshot = copyAttachmentPlan(plan);
    await validateAttachmentPlan(snapshot);
    const id = scopedKey(snapshot.scope, snapshot.attachmentId);
    await this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedAttachmentUploads, this.fileStore.journal], async (scopeTx10) => {
      const repositoryTx10 = this.withStorage(scopeTx10);

      if (await repositoryTx10.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const binding = await repositoryTx10.fileStore.datasetBinding.get('active');
      if (binding?.scope !== snapshot.scope) throw Error('sync-dataset-bound');
      const existing = await repositoryTx10.fileStore.scopedAttachmentUploads.get(id);
      if (existing) {
        if (!sameAttachmentPlan(existing, snapshot)) throw Error('sync-attachment-plan-conflict');
      } else {
        await repositoryTx10.fileStore.scopedAttachmentUploads.add({ id, ...snapshot });
      }
    });
    return snapshot;
  }

  async deleteScopedAttachmentUpload(scope: string, attachmentId: string): Promise<void> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    z.uuid().parse(attachmentId);
    await this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedAttachmentUploads, this.fileStore.journal], async (scopeTx11) => {
      const repositoryTx11 = this.withStorage(scopeTx11);

      if (await repositoryTx11.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const binding = await repositoryTx11.fileStore.datasetBinding.get('active');
      if (binding?.scope !== scope) throw Error('sync-dataset-bound');
      await repositoryTx11.fileStore.scopedAttachmentUploads.delete(scopedKey(scope, attachmentId));
    });
  }

  async pendingScopedPullRow(scope: string): Promise<RecordRow | null> {
    assertScope(scope);
    await this.requireDatasetScope(scope);
    const pending = await this.fileStore.scopedPull.get(scope);
    return pending ? { ...pending.change.row } : null;
  }

  private async requireDatasetScope(scope: string): Promise<void> {
    const binding = await this.fileStore.datasetBinding.get('active');
    if (binding?.scope !== scope) throw Error('sync-dataset-bound');
  }

  async dirtyScopedRows(scope: string): Promise<RecordRow[]> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    await this.assertDatasetScope(scope);
    const rows = await this.allRecords();
    const dirty: RecordRow[] = [];
    for (const row of rows) {
      const [base, pending] = await Promise.all([
        this.fileStore.scopedBase.get(scopedKey(scope, row.id)),
        this.fileStore.scopedOutbox.get(scopedKey(scope, row.id)),
      ]);
      if (row.payload !== (base?.payload ?? null) && !pending) dirty.push(row);
    }
    return dirty;
  }

  async stageScopedOutbox(scope: string, row: RecordRow, operation: SyncOperation): Promise<ScopedOutbox> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    await this.assertDatasetScope(scope);
    validateRow(row);
    if (operation.id !== row.id || operation.kind !== row.type || operation.expectedVersion !==
      ((await this.scopedBaseFor(scope, row.id))?.version ?? 0) || operation.tombstone !== Boolean(parsedPayload(row).deleted)) throw Error('outbox-context');
    const id = scopedKey(scope, row.id);
    return this.fileStore.transaction('rw', [this.fileStore.archiveMerge, this.fileStore.scopedOutbox,
      this.fileStore.subscriptionSaveJournal, this.fileStore.importJournal, this.fileStore.categoryEditJournal, this.fileStore.journal], async (scopeTx12) => {
      const repositoryTx12 = this.withStorage(scopeTx12);

      if (await repositoryTx12.fileStore.journal.count()) throw Error('restore-recovery-pending');
      if (await repositoryTx12.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
      if (await repositoryTx12.fileStore.subscriptionSaveJournal.count()) throw Error('subscription-relations-pending');
      await assertNoPendingReviewedConfirmations(repositoryTx12.fileStore);
      const pending = await repositoryTx12.fileStore.archiveMerge.get('active');
      if (pending && pending.phase !== 'syncing') throw Error('archive-merge-sync-paused');
      const existing = await repositoryTx12.fileStore.scopedOutbox.get(id);
      if (existing) return existing;
      const current = await repositoryTx12.fileStore.outsideTransaction(() => repositoryTx12.records.get(row.id));
      if (!current || canonical(current).payload !== row.payload) throw Error('outbox-stale');
      const item = { id, scope, row, operation };
      await repositoryTx12.fileStore.scopedOutbox.add(item);
      return item;
    });
  }

  async acknowledgeScopedOutbox(scope: string, operationId: string, version: number, keyEpoch: number): Promise<void> {
    assertScope(scope);
    const item = (await this.listScopedOutbox(scope)).find(entry => entry.operation.operationId === operationId);
    if (!item || version !== item.operation.expectedVersion + 1) throw Error('outbox-ack');
    await this.fileStore.transaction('rw', [this.fileStore.scopedBase, this.fileStore.scopedOutbox, this.fileStore.journal], async (scopeTx13) => {
      const repositoryTx13 = this.withStorage(scopeTx13);

      if (await repositoryTx13.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const current = await repositoryTx13.fileStore.scopedOutbox.get(item.id);
      if (current?.operation.operationId !== operationId) throw Error('outbox-ack');
      await repositoryTx13.fileStore.scopedBase.put({ id: item.id, scope, rowId: item.row.id, payload: item.row.payload,
        row: item.row, version, operationId, keyEpoch, ciphertext: item.operation.ciphertext });
      await repositoryTx13.fileStore.scopedOutbox.delete(item.id);
    });
  }

  async blockScopedOutbox(scope: string, operationId: string): Promise<void> {
    const item = (await this.listScopedOutbox(scope)).find(entry => entry.operation.operationId === operationId);
    if (!item) throw Error('outbox-missing');
    await this.fileStore.transaction('rw', [this.fileStore.scopedOutbox, this.fileStore.journal], async (scopeTx14) => {
      const repositoryTx14 = this.withStorage(scopeTx14);

      if (await repositoryTx14.fileStore.journal.count()) throw Error('restore-recovery-pending');
      await repositoryTx14.fileStore.scopedOutbox.update(item.id, { blocked: true });
    });
  }

  async scopedConflict(scope: string): Promise<ScopedConflict | null> {
    assertScope(scope);
    const journal = await this.fileStore.scopedPull.get(scope);
    if (!journal || journal.decision) return null;
    const base = await this.fileStore.scopedBase.get(scopedKey(scope, journal.change.row.id));
    const current = await this.records.get(journal.change.row.id);
    const localPayload = current ? canonical(current).payload : null;
    if (localPayload === journal.change.row.payload ||
      !isPurgedPayload(journal.change.row.type, localPayload) && localPayload === (base?.payload ?? null)) return null;
    return { rowId: journal.change.row.id, localPayload, remotePayload: journal.change.row.payload,
      basePayload: base?.payload ?? null, remoteVersion: journal.change.version };
  }

  async applyScopedPull(scope: string, change: PulledRow): Promise<'applied' | 'conflict'> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    await this.assertDatasetScope(scope);
    validateRow(change.row);
    const cursor = await this.scopedCursor(scope);
    if (change.sequence !== cursor + 1 || !Number.isSafeInteger(change.version) || change.version < 1) throw Error('pull-sequence');
    const previous = await this.fileStore.scopedPull.get(scope);
    if (previous && (previous.change.sequence !== change.sequence || previous.change.row.payload !== change.row.payload)) throw Error('pull-pending');
    if (!previous) {
      const current = await this.records.get(change.row.id);
      await this.fileStore.transaction('rw', [this.fileStore.archiveMerge, this.fileStore.scopedPull,
        this.fileStore.subscriptionSaveJournal, this.fileStore.importJournal, this.fileStore.categoryEditJournal, this.fileStore.journal], async (scopeTx15) => {
        const repositoryTx15 = this.withStorage(scopeTx15);

        if (await repositoryTx15.fileStore.journal.count()) throw Error('restore-recovery-pending');
        if (await repositoryTx15.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
        if (await repositoryTx15.fileStore.subscriptionSaveJournal.count()) throw Error('subscription-relations-pending');
        await assertNoPendingReviewedConfirmations(repositoryTx15.fileStore);
        const pending = await repositoryTx15.fileStore.archiveMerge.get('active');
        if (pending && pending.phase !== 'syncing') throw Error('archive-merge-sync-paused');
        await repositoryTx15.fileStore.scopedPull.add({ id: scope, scope, cursorStart: cursor, change,
          localPayload: current ? canonical(current).payload : null });
      });
    }
    return replayScopedPull(this.records, this.fileStore, scope);
  }

  async resumeScopedPull(scope: string): Promise<'applied' | 'conflict' | 'none'> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    await this.assertDatasetScope(scope);
    if (!(await this.fileStore.scopedPull.get(scope))) return 'none';
    return replayScopedPull(this.records, this.fileStore, scope);
  }

  async resolveScopedConflict(scope: string, decision: 'local' | 'remote'): Promise<void> {
    await this.assertArchiveMergeSyncAllowed();
    assertScope(scope);
    await this.assertDatasetScope(scope);
    const changed = await this.fileStore.transaction('rw', [this.fileStore.scopedPull, this.fileStore.scopedBase, this.fileStore.journal], async (scopeTx16) => {
      const repositoryTx16 = this.withStorage(scopeTx16);

      if (await repositoryTx16.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const journal = await repositoryTx16.fileStore.scopedPull.get(scope);
      if (!journal) throw Error('conflict-missing');
      const [current] = await repositoryTx16.fileStore.outsideTransaction(() =>
        repositoryTx16.records.getMany([journal.change.row.id], false));
      const payload = current?.payload ?? null;
      const base = await repositoryTx16.fileStore.scopedBase.get(scopedKey(scope, journal.change.row.id));
      const purged = isPurgedPayload(journal.change.row.type, payload) && payload !== journal.change.row.payload;
      if (purged && decision === 'remote') throw Error('trash-purged');
      if (journal.decision || payload === journal.change.row.payload || (!purged && payload === (base?.payload ?? null))) throw Error('conflict-missing');
      if (payload !== journal.localPayload) {
        await repositoryTx16.fileStore.scopedPull.update(scope, { localPayload: payload });
        return true;
      }
      await repositoryTx16.fileStore.scopedPull.update(scope, { decision });
      return false;
    });
    if (changed) throw Error('conflict-local-changed');
    if (await replayScopedPull(this.records, this.fileStore, scope) !== 'applied') throw Error('conflict-unresolved');
  }

  // The cursor is committed only after every decrypted record in the page is durable.
  async applyPulledBatch(changes: PulledRow[], cursorStart: number): Promise<number> {
    await this.assertArchiveMergeSyncAllowed();
    if (await this.fileStore.pullJournal.count()) throw Error('pull-pending');
    if (cursorStart !== await this.syncCursor()) throw Error('cursor-mismatch');
    if (!changes.length || changes.length > 500) throw Error('pull-size');
    for (let index = 0; index < changes.length; index++) {
      const change = changes[index];
      if (change.sequence !== cursorStart + index + 1 || !Number.isSafeInteger(change.version) || change.version < 1) throw Error('pull-sequence');
      validateRow(change.row);
    }
    const id = crypto.randomUUID();
    await this.fileStore.transaction('rw', [this.fileStore.pullJournal, this.fileStore.categoryEditJournal, this.fileStore.journal], async (scopeTx17) => {
      const repositoryTx17 = this.withStorage(scopeTx17);

      if (await repositoryTx17.fileStore.journal.count()) throw Error('restore-recovery-pending');
      if (await repositoryTx17.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
      if (await repositoryTx17.fileStore.pullJournal.count()) throw Error('pull-pending');
      await repositoryTx17.fileStore.pullJournal.put({ id, cursorStart, changes });
    });
    try {
      await replayPullJournal(this.records, this.fileStore, id);
      return cursorStart + changes.length;
    } catch (error) {
      this.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed';
      throw error;
    }
  }

  async deleteAssetIfCurrent(expected: Asset): Promise<RecordRow> {
    const snapshot = entitySchemas.asset.parse(expected);
    if (snapshot.deleted || snapshot.purged) throw Error('asset-stale');
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      await this.settleRenewalJournals();
      return this.saveAssetIfCurrent(snapshot, { ...snapshot, deleted: true, updatedAt: new Date().toISOString() });
    });
  }

  async deleteEntity(type: EntityType, id: string): Promise<RecordRow> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      if (type === 'asset' || type === 'history') await this.settleRenewalJournals();
      const current = await this.get<Record<string, unknown>>(type, id);
      if (!current) throw Error('not-found');
      if (current.deleted) {
        const row = await this.records.get(key(type, id));
        if (!row) throw Error('not-found');
        return canonical(row);
      }
      const tombstone = { ...current, deleted: true, ...(type === 'asset' ? { updatedAt: new Date().toISOString() } : {}) };
      return type === 'asset'
        ? this.saveAssetIfCurrent(current as Asset, tombstone as Asset)
        : this.save(type, tombstone);
    });
  }

  async previewTrashPurge(targets: readonly TrashTarget[]): Promise<TrashPurgePlan> {
    return { targets: targets.map(target => ({ ...target })), rows: trashPurgeRows(await this.allRecords(), targets), at: Date.now() };
  }

  async purgeTrash(plan: TrashPurgePlan): Promise<void> {
    if (!Number.isSafeInteger(plan.at) || plan.at < 0) throw Error('trash-invalid');
    const attachmentIds = new Set<string>();
    await this.fileStore.transaction('rw', restoreRecoveryTables(this.fileStore), async (scopeTx18) => {
      const repositoryTx18 = this.withStorage(scopeTx18);

      await repositoryTx18.fileStore.categoryEditJournal.count();
      await assertRestoreRecoveryGate(repositoryTx18.fileStore);
      // A pending durable write could otherwise put erased contents back after restart.
      for (const table of [repositoryTx18.fileStore.journal, repositoryTx18.fileStore.importJournal, repositoryTx18.fileStore.archiveMerge,
        repositoryTx18.fileStore.renewalJournal, repositoryTx18.fileStore.subscriptionSaveJournal, repositoryTx18.fileStore.categoryEditJournal,
        repositoryTx18.fileStore.pullJournal, repositoryTx18.fileStore.scopedPull]) {
        if (await table.count()) throw Error('trash-recovery-pending');
      }
      await repositoryTx18.fileStore.outsideTransaction(async () => {
        const rows = await repositoryTx18.allRecords();
        const actual = trashPurgeRows(rows, plan.targets, true);
        const expected = new Map(plan.rows.map(row => [row.id, row]));
        if (!expected.size || expected.size !== plan.rows.length || trashPurgeRows(plan.rows, plan.targets).length !== expected.size || actual.some(row => !expected.has(row.id)) ||
          plan.targets.some(target => !expected.has(key(target.type, target.id)))) throw Error('trash-stale');
        const changes = [];
        for (const before of plan.rows) {
          validateRow(before);
          const projectionOnly = before.type === 'history' && plan.targets.some(target => target.type === 'history' && key('history', target.id) === before.id) &&
            !historyReferenceIds(JSON.parse(before.payload) as History).some(id => plan.targets.some(target => target.type === 'asset' && target.id === id));
          const next = redactedTrashRow(before, plan.at, projectionOnly);
          const [raw] = await repositoryTx18.records.getMany([before.id], false);
          if (!raw || raw.type !== before.type || (raw.payload !== before.payload && raw.payload !== next.payload)) throw Error('trash-stale');
          if (before.type === 'asset') for (const id of (JSON.parse(before.payload) as Asset).attachments) attachmentIds.add(id);
          if (raw.payload !== next.payload) changes.push({ previous: raw, next: { ...raw, ...next } });
        }
        if (changes.length) {
          const result = await repositoryTx18.records.compareAndWrite(changes, 'trash-purge');
          if (result.error.length) throw Error(result.error.some(error => error.status === 409) ? 'trash-stale' : 'trash-write');
        }
      });
      const assetIds = new Set(plan.targets.filter(target => target.type === 'asset').map(target => target.id));
      const allReviews = await repositoryTx18.fileStore.intakeReview.toArray();
      const reviews = allReviews.filter(review =>
        assetIds.has(review.asset.id) || !!review.merge && assetIds.has(review.merge.targetId) ||
        !!review.expenseDraft && assetIds.has(review.expenseDraft.assetId));
      const remainingReviews = retainReviewedCsvSources(allReviews, new Set(reviews.map(review => review.id)));
      await repositoryTx18.fileStore.intakeReview.bulkDelete(reviews.map(review => review.id));
      for (const review of remainingReviews) {
        const before = allReviews.find(row => row.id === review.id);
        if (before && !sameReviewedCandidate(before, review)) await repositoryTx18.fileStore.intakeReview.put(review);
      }
    });
    // Reuse reference-aware cleanup; attachments shared by other records or queued sync writes stay protected.
    for (const id of attachmentIds) await this.cleanupUnreferencedFile(id);
  }

  // Explicit undo is the only local path that can revive a tombstone.
  async restoreEntity(type: EntityType, id: string): Promise<RecordRow> {
    if (type === 'task') {
      return withRenewalLock(`keepany-task:${this.records.name}`, () => this.restoreEntityUnlocked(type, id));
    }
    if (type === 'asset' || type === 'history') {
      return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
        await this.settleRenewalJournals();
        return this.restoreEntityUnlocked(type, id);
      });
    }
    return this.restoreEntityUnlocked(type, id);
  }

  async restoreRelationIfCurrent(expected: Relation): Promise<RecordRow> {
    if (!expected.deleted) throw Error('relation-stale');
    return this.restoreEntityUnlocked('relation', expected.id, rowFor('relation', expected).payload);
  }

  private async restoreEntityUnlocked(type: EntityType, id: string, expectedPayload?: string): Promise<RecordRow> {
    return withCategoryMutationGate(this.records, this.fileStore, [{ type, id }], async (scopeGate9) => {
      const repositoryGate9 = this.withStorage(scopeGate9);
return repositoryGate9.restoreEntityRecord(type, id, expectedPayload);
    });
  }

  private async restoreEntityRecord(type: EntityType, id: string, expectedPayload?: string): Promise<RecordRow> {
    const document = await this.records.get(key(type, id));
    if (!document) throw Error('not-in-trash');
    const previous = parsedPayload(canonical(document)) as Record<string, unknown>;
    if (!previous.deleted || previous.purged) throw Error('not-in-trash');
    const assertUniqueAccount = async (value: Record<string, unknown>) => {
      if (type !== 'asset' || value.kind !== 'account') return;
      // Read storage while holding the cross-tab mutation gate; an RxDB query may
      // still cache the state from before another tab re-imported the account.
      const rows = await this.records.list('asset');
      const duplicate = rows.map(row => parsedPayload(row) as Asset).find(asset =>
        !asset.deleted && asset.id !== id && conflictsWithAccountRestore(value as Asset, asset));
      if (duplicate) throw new AccountRestoreConflict(duplicate.id);
    };
    await assertUniqueAccount(previous);
    const assertRestoreTargets = async (value: Record<string, unknown>) => {
      if (type === 'history' && financeActions.includes(value.action as typeof financeActions[number])) await this.assertFinanceTargets(value as unknown as History);
      if (type === 'task') {
        const task = value as unknown as Task;
        const target = task.assetId ? await this.get<Asset>('asset', task.assetId) : null;
        if (target?.purged) throw Error('trash-purged');
        if (task.assetId && (!target || target.deleted)) throw Error('task-target-changed');
        if (!task.done && task.dedupeKey && (await this.list<Task>('task')).some(other => other.id !== task.id && !other.done && other.dedupeKey === task.dedupeKey)) throw Error('task-duplicate');
      }
    };
    await assertRestoreTargets(previous);
    if (type === 'relation') await this.assertRelationEndpoints(previous as { from: string; to: string });
    let next: RecordRow | undefined;
    await this.records.modify(document.id, async (data: RecordRow) => {
      if (expectedPayload !== undefined && data.payload !== expectedPayload) throw Error(type === 'task' ? 'task-stale' : type === 'history' ? 'history-stale' : 'relation-stale');
      const current = parsedPayload(data) as Record<string, unknown>;
      if (!current.deleted || current.purged) throw Error('not-in-trash');
      await assertUniqueAccount(current);
      await assertRestoreTargets(current);
      // The callback sees the latest tombstone after RxDB retries a concurrent write.
      // Check endpoints here too, immediately before this relation is made live.
      if (type === 'relation') await this.assertRelationEndpoints(current as { from: string; to: string });
      next = rowFor(type, { ...current, deleted: false });
      return { ...data, ...next };
    });
    if (!next) throw Error('restore-failed');
    return next;
  }

  // An exact base snapshot prevents silent last-write-wins. Replayed writes are idempotent.
  async applyIncoming(type: EntityType, value: unknown, expectedPayload: string | null): Promise<'applied' | 'duplicate' | 'conflict'> {
    await this.assertArchiveMergeSyncAllowed();
    return this.fileStore.transaction('rw', [this.fileStore.categoryEditJournal, this.fileStore.journal], async (scopeTx19) => {
      const repositoryTx19 = this.withStorage(scopeTx19);

      if (await repositoryTx19.fileStore.journal.count()) throw Error('restore-recovery-pending');
      await assertCategoryMutationAllowed(repositoryTx19.records, repositoryTx19.fileStore, [], true);
      return repositoryTx19.fileStore.outsideTransaction(() => repositoryTx19.applyIncomingUnlocked(type, value, expectedPayload));
    });
  }

  private async applyIncomingUnlocked(type: EntityType, value: unknown, expectedPayload: string | null): Promise<'applied' | 'duplicate' | 'conflict'> {
    const next = rowFor(type, value);
    const existing = await this.records.get(next.id);
    if (existing) {
      const duplicate = Symbol('duplicate');
      const conflict = Symbol('conflict');
      try {
        await this.records.modify(existing.id, (data: RecordRow) => {
          if (data.payload === next.payload) throw duplicate;
          if (isPurgedPayload(type, data.payload)) throw conflict;
          if (parsedPayload(data).deleted && !parsedPayload(next).deleted) throw conflict;
          if (data.payload !== expectedPayload) throw conflict;
          return { ...data, ...next };
        });
        return 'applied';
      } catch (error) {
        if (error === duplicate) return 'duplicate';
        if (error === conflict) return 'conflict';
        throw error;
      }
    }
    if (expectedPayload !== null) return 'conflict';
    try {
      await this.records.insert(next);
      return 'applied';
    } catch (error) {
      if (!(await this.records.get(next.id))) throw error;
      return this.applyIncomingUnlocked(type, value, expectedPayload);
    }
  }

  async putFile(file: File): Promise<string> {
    if (file.name.length > 255) throw Error('file-name');
    if (file.size > 20 * 1024 * 1024) throw Error('file-size');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw Error('file-type');
    const id = crypto.randomUUID();
    await this.fileStore.blobs.add({ id, blob: file, name: file.name });
    return id;
  }

  async readFile(id: string): Promise<{ id: string; name: string; type: string; bytes: Uint8Array } | null> {
    z.uuid().parse(id);
    const file = await this.fileStore.blobs.get(id);
    if (!file) return null;
    return { id, name: file.name, type: file.blob.type, bytes: new Uint8Array(await file.blob.arrayBuffer()) };
  }

  async putSyncedFile(input: { id: string; name: string; type: string; bytes: Uint8Array; sha256: string }): Promise<void> {
    await this.assertArchiveMergeSyncAllowed();
    const { id, name, type, sha256 } = input;
    z.uuid().parse(id);
    if (typeof name !== 'string' || name.length > 255) throw Error('file-name');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw Error('file-type');
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 20 * 1024 * 1024) throw Error('file-size');
    const bytes = new Uint8Array(input.bytes);
    if (!/^[a-f0-9]{64}$/.test(sha256) || await sha(bytes) !== sha256) throw Error('sync-attachment-integrity');
    await this.fileStore.transaction('rw', [this.fileStore.blobs, this.fileStore.journal], async (scopeTx20) => {
      const repositoryTx20 = this.withStorage(scopeTx20);

      if (await repositoryTx20.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const existing = await repositoryTx20.fileStore.blobs.get(id);
      if (existing) {
        if (existing.name !== name || existing.blob.type !== type || existing.blob.size !== bytes.length ||
          !sameBytes(new Uint8Array(await repositoryTx20.fileStore.waitFor(existing.blob.arrayBuffer())), bytes)) throw Error('sync-attachment-conflict');
      } else {
        await repositoryTx20.fileStore.blobs.add({ id, name, blob: new Blob([new Uint8Array(bytes)], { type }) });
      }
    });
  }

  async fileUrl(id: string): Promise<string> {
    const value = await this.fileStore.blobs.get(id);
    return value ? URL.createObjectURL(value.blob) : '';
  }

  // Call after an asset write fails or after removing an image from an asset.
  // Tombstones and durable journals still protect their referenced images.
  async cleanupUnreferencedFile(id: string): Promise<boolean> {
    z.string().uuid().parse(id);
    return this.fileStore.transaction('rw', restoreRecoveryTables(this.fileStore), async (scopeTx21) => {
      const repositoryTx21 = this.withStorage(scopeTx21);

      // Read records and their durable intents after acquiring the same gate
      // used by restore. Otherwise an old record snapshot can pair with an
      // already-cleared restore journal and delete a newly referenced image.
      await repositoryTx21.fileStore.journal.count();
      if ((await repositoryTx21.protectedFileIds()).has(id)) return false;
      if (!(await repositoryTx21.fileStore.blobs.get(id))) return false;
      await repositoryTx21.fileStore.blobs.delete(id);
      return true;
    });
  }

  async collectOrphanFiles(): Promise<number> {
    const protectedIds = await this.protectedFileIds();
    const candidates = (await this.fileStore.blobs.keys())
      .filter(id => !protectedIds.has(id));
    let removed = 0;
    for (const id of candidates) if (await this.cleanupUnreferencedFile(id)) removed++;
    return removed;
  }

  private async protectedFileIds(): Promise<Set<string>> {
    const rows = await this.fileStore.outsideTransaction(() => storedRestoreRows(this.records));
    const [restores, imports, pulls, scopedOutbox, scopedPull, renewals, subscriptionSaves, categoryEdits] = await Promise.all([
      this.fileStore.journal.toArray(), this.fileStore.importJournal.toArray(), this.fileStore.pullJournal.toArray(),
      this.fileStore.scopedOutbox.toArray(), this.fileStore.scopedPull.toArray(), this.fileStore.renewalJournal.toArray(),
      this.fileStore.subscriptionSaveJournal.toArray(),
      this.fileStore.categoryEditJournal.toArray(),
    ]);
    for (const entry of restores) rows.push(...entry.rows);
    for (const entry of imports) rows.push(...entry.rows);
    for (const entry of categoryEdits) for (const change of entry.changes) rows.push(change.before, change.after);
    for (const entry of pulls) rows.push(...entry.changes.map(change => change.row));
    for (const entry of scopedOutbox) rows.push(entry.row);
    for (const entry of scopedPull) rows.push(entry.change.row);
    for (const entry of renewals) rows.push(entry.next);
    for (const entry of subscriptionSaves) rows.push(entry.next);
    const merge = await this.fileStore.archiveMerge.get('active');
    if (merge) for (const change of merge.changes) {
      rows.push(change.after);
      if (change.before) rows.push(change.before);
    }
    return attachmentIdsIn(rows);
  }

  async pendingArchiveMerge(): Promise<PendingArchiveMerge | null> {
    const journal = await this.fileStore.archiveMerge.get('active');
    return journal ? { phase: journal.phase, archiveHash: journal.archiveHash,
      changedRows: journal.changes.length, changedCandidates: journal.intakeReviewChanges?.length ?? 0,
      addedFiles: journal.addedFileIds.length } : null;
  }

  async previewArchiveMerge(bytes: Uint8Array): Promise<ArchiveMergePreview> {
    if (this.intakeReviewMigrationError) await this.retryIntakeReviewMigration();
    await this.retryAllSubscriptionSaves();
    await this.retryReviewedExpenseConfirmations();
    await this.retryAllCategoryEdits();
    if (await this.pendingArchiveMerge()) throw Error('archive-merge-pending');
    const { rows, intakeReview, passwordVault } = await inspectArchive(bytes);
    await assertArchiveMergePasswordVault(this.fileStore, passwordVault);
    const target = await this.allRecords();
    const byId = new Map(target.map(row => [row.id, row]));
    const targetReview = parseReviewedCandidates(await this.fileStore.intakeReview.toArray());
    const reviewById = new Map(targetReview.map(row => [row.id, row]));
    const fingerprint = await targetFingerprint(target, this.fileStore);
    if (reviewFingerprint(parseReviewedCandidates(await this.fileStore.intakeReview.toArray())) !== reviewFingerprint(targetReview) ||
      JSON.stringify((await this.allRecords()).sort((a, b) => a.id.localeCompare(b.id))) !==
      JSON.stringify([...target].sort((a, b) => a.id.localeCompare(b.id)))) throw Error('archive-merge-stale');
    return { targetFingerprint: fingerprint, rows: rows.map(source => {
      const existing = byId.get(source.id);
      return { id: source.id, type: source.type,
        status: !existing ? 'new' : existing.payload === source.payload ? 'same' : 'conflict',
        sourcePayload: source.payload, targetPayload: existing?.payload ?? null };
    }), intakeReview: intakeReview.map(source => {
      const existing = reviewById.get(source.id);
      return { id: `review:${source.id}`, status: !existing ? 'new' : sameReviewedCandidate(source, existing) ? 'same' : 'conflict',
        sourceCandidate: source, targetCandidate: existing ?? null };
    }) };
  }

  async applyArchiveMerge(bytes: Uint8Array, choices: Record<string, ArchiveMergeChoice>,
    expectedFingerprint: string): Promise<{ imported: number; replaced: number; skipped: number;
      review?: { imported: number; replaced: number; skipped: number } }> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      if (this.intakeReviewMigrationError) await this.retryIntakeReviewMigration();
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves();
      await this.settleReviewedExpenseConfirmations();
      await this.settleCategoryEdits();
      if (await this.pendingArchiveMerge()) throw Error('archive-merge-pending');
      if (!(await this.fileStore.datasetBinding.get('active'))) throw Error('archive-merge-unbound');
      if (await this.fileStore.journal.count() || await this.fileStore.importJournal.count() ||
        await this.fileStore.pullJournal.count() || await this.fileStore.scopedPull.count() ||
        await this.fileStore.scopedOutbox.count() || await this.fileStore.scopedAttachmentUploads.count()) {
        throw Error('archive-merge-recovery-pending');
      }
      const { rows, intakeReview, manifest, entries, passwordVault } = await inspectArchive(bytes);
      await assertArchiveMergePasswordVault(this.fileStore, passwordVault);
      const archiveHash = await sha(bytes);
      const target = await this.allRecords();
      const targetVaultRevision = (await this.fileStore.passwordVault.get('local'))?.revision ?? null;
      if (await targetFingerprint(target, this.fileStore) !== expectedFingerprint) throw Error('archive-merge-stale');
      const byId = new Map(target.map(row => [row.id, row]));
      const targetReview = parseReviewedCandidates(await this.fileStore.intakeReview.toArray());
      const reviewById = new Map(targetReview.map(row => [row.id, row]));
      const sourceIds = new Set([...rows.map(row => row.id), ...intakeReview.map(row => `review:${row.id}`)]);
      if (Object.keys(choices).some(id => !sourceIds.has(id) || !['source', 'target'].includes(choices[id]))) {
        throw Error('archive-merge-choice');
      }
      const changes: ArchiveMergeChange[] = [];
      const intakeReviewChanges: ArchiveMergeReviewChange[] = [];
      const review = { imported: 0, replaced: 0, skipped: 0 };
      const finalReview = new Map(reviewById);
      let imported = 0; let replaced = 0; let skipped = 0;
      const finalRows = new Map(byId);
      for (const source of rows) {
        const before = byId.get(source.id) ?? null;
        if (!before) {
          if (choices[source.id]) throw Error('archive-merge-choice');
          changes.push({ before, after: source }); finalRows.set(source.id, source); imported++;
        } else if (before.payload === source.payload) {
          if (choices[source.id]) throw Error('archive-merge-choice');
          skipped++;
        } else {
          if (choices[source.id] !== 'source' && choices[source.id] !== 'target') throw Error('archive-merge-choice');
          if (choices[source.id] === 'source') {
            changes.push({ before, after: source }); finalRows.set(source.id, source); replaced++;
          } else skipped++;
        }
      }
      for (const source of intakeReview) {
        const before = reviewById.get(source.id) ?? null;
        const choice = choices[`review:${source.id}`];
        if (!before) {
          if (choice) throw Error('archive-merge-choice');
          intakeReviewChanges.push({ before, after: source }); finalReview.set(source.id, source); review.imported++;
        } else if (sameReviewedCandidate(before, source)) {
          if (choice) throw Error('archive-merge-choice');
          review.skipped++;
        } else {
          if (choice !== 'source' && choice !== 'target') throw Error('archive-merge-choice');
          if (choice === 'source') {
            intakeReviewChanges.push({ before, after: source }); finalReview.set(source.id, source); review.replaced++;
          } else review.skipped++;
        }
      }
      // The selected result is checked as one data set, including references to
      // target-only records and source tombstones.
      const final = [...finalRows.values()];
      assertReviewedAssetReferences([...finalReview.values()], assetIdsIn(final), historyByIdIn(final));
      const finalFileIds = attachmentIdsIn(final);
      const sourceFiles = new Map(manifest.attachments.map(attachment => [attachment.id, attachment]));
      const existingFiles = await this.fileStore.blobs.toArray();
      const existingById = new Map(existingFiles.map(file => [file.id, file]));
      for (const attachment of manifest.attachments) {
        const existing = existingById.get(attachment.id);
        if (existing && (existing.name !== attachment.name || existing.blob.type !== attachment.type ||
          existing.blob.size !== attachment.size ||
          !sameBytes(new Uint8Array(await existing.blob.arrayBuffer()), entries[`files/${attachment.id}`]))) {
          throw Error('archive-merge-image-conflict');
        }
      }
      for (const id of finalFileIds) if (!existingById.has(id) && !sourceFiles.has(id)) throw Error('archive-attachment-reference');
      validateReferences(final, finalFileIds);
      const addedFileIds = [...finalFileIds].filter(id => !existingById.has(id));
      // Detect a second-tab edit before recording the durable plan. Individual
      // row writes below also use storage CAS, so an edit after this check fails.
      if (await targetFingerprint(await this.allRecords(), this.fileStore) !== expectedFingerprint) throw Error('archive-merge-stale');
      const journal: ArchiveMergeJournal = { id: 'active', phase: 'applying', archiveHash,
        targetFingerprint: expectedFingerprint, changes, intakeReviewChanges, addedFileIds, insertedFileIds: [] };
      await this.fileStore.transaction('rw', [this.fileStore.archiveMerge, this.fileStore.scopedOutbox,
        this.fileStore.scopedPull, this.fileStore.scopedAttachmentUploads, this.fileStore.intakeReview,
        this.fileStore.importJournal, this.fileStore.journal, this.fileStore.categoryEditJournal, this.fileStore.passwordVault], async (scopeTx22) => {
        const repositoryTx22 = this.withStorage(scopeTx22);

          if (await repositoryTx22.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
          if (await repositoryTx22.fileStore.archiveMerge.get('active')) throw Error('archive-merge-pending');
          if (await repositoryTx22.fileStore.importJournal.count() || await repositoryTx22.fileStore.journal.count()) throw Error('archive-merge-recovery-pending');
          if (await repositoryTx22.fileStore.scopedOutbox.count() || await repositoryTx22.fileStore.scopedPull.count() ||
            await repositoryTx22.fileStore.scopedAttachmentUploads.count()) throw Error('archive-merge-recovery-pending');
          if (reviewFingerprint(parseReviewedCandidates(await repositoryTx22.fileStore.intakeReview.toArray())) !==
            reviewFingerprint(targetReview)) throw Error('archive-merge-stale');
          await assertArchiveMergePasswordVault(repositoryTx22.fileStore, passwordVault);
          if (((await repositoryTx22.fileStore.passwordVault.get('local'))?.revision ?? null) !== targetVaultRevision) throw Error('archive-merge-stale');
          await repositoryTx22.fileStore.archiveMerge.add(journal);
      });
      try {
        for (const id of addedFileIds) {
          const attachment = sourceFiles.get(id);
          if (!attachment) throw Error('archive-attachment-reference');
          const content = entries[`files/${id}`];
          await this.fileStore.transaction('rw', [this.fileStore.blobs, this.fileStore.archiveMerge], async (scopeTx23) => {
            const repositoryTx23 = this.withStorage(scopeTx23);

            if (await repositoryTx23.fileStore.blobs.get(id)) throw Error('archive-merge-image-conflict');
            await repositoryTx23.fileStore.blobs.add({ id, name: attachment.name,
              blob: new Blob([content as BlobPart], { type: attachment.type }) });
            const current = await repositoryTx23.fileStore.archiveMerge.get('active');
            if (current?.phase !== 'applying') throw Error('archive-merge-pending');
            await repositoryTx23.fileStore.archiveMerge.update('active', { insertedFileIds: [...current.insertedFileIds, id] });
          });
        }
        for (const change of changes) await writeArchiveMergeRow(this.records, change.before, change.after);
        await this.fileStore.transaction('rw', this.fileStore.intakeReview, async (scopeTx24) => {
          const repositoryTx24 = this.withStorage(scopeTx24);

          for (const change of intakeReviewChanges) await writeArchiveMergeReview(repositoryTx24.fileStore, change.before, change.after);
        });
        const actual = await this.allRecords();
        validateReferences(actual, attachmentIdsIn(actual));
        assertReviewedAssetReferences(parseReviewedCandidates(await this.fileStore.intakeReview.toArray()), assetIdsIn(actual), historyByIdIn(actual));
        for (const id of attachmentIdsIn(actual)) if (!(await this.fileStore.blobs.get(id))) throw Error('archive-attachment-reference');
        await this.fileStore.archiveMerge.update('active', { phase: 'applied' });
        return { imported, replaced, skipped, ...(intakeReview.length ? { review } : {}) };
      } catch (error) {
        await rollbackArchiveMergeJournal(this.records, this.fileStore).catch(() => {});
        throw error;
      }
    });
  }

  async rollbackArchiveMerge(): Promise<void> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      const journal = await this.fileStore.archiveMerge.get('active');
      if (!journal) return;
      if (journal.phase === 'syncing') throw Error('archive-merge-sync-started');
      await rollbackArchiveMergeJournal(this.records, this.fileStore);
    });
  }

  async finalizeArchiveMerge(): Promise<void> {
    await this.fileStore.transaction('rw', this.fileStore.archiveMerge, async (scopeTx25) => {
      const repositoryTx25 = this.withStorage(scopeTx25);

      const journal = await repositoryTx25.fileStore.archiveMerge.get('active');
      if (journal?.phase !== 'applied') throw Error('archive-merge-not-applied');
      await repositoryTx25.fileStore.archiveMerge.update('active', { phase: 'syncing' });
    });
  }

  async completeArchiveMerge(): Promise<void> {
    await this.fileStore.transaction('rw', [this.fileStore.archiveMerge, this.fileStore.scopedOutbox, this.fileStore.scopedPull, this.fileStore.scopedAttachmentUploads], async (scopeTx26) => {
      const repositoryTx26 = this.withStorage(scopeTx26);

        const journal = await repositoryTx26.fileStore.archiveMerge.get('active');
        if (journal?.phase !== 'syncing') throw Error('archive-merge-not-syncing');
        if (await repositoryTx26.fileStore.scopedOutbox.count() || await repositoryTx26.fileStore.scopedPull.count() ||
          await repositoryTx26.fileStore.scopedAttachmentUploads.count()) throw Error('archive-merge-sync-pending');
        await repositoryTx26.fileStore.archiveMerge.delete('active');
    });
  }

  async exportArchive(): Promise<Uint8Array> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      if (this.intakeReviewMigrationError) await this.retryIntakeReviewMigration();
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves();
      await this.settleReviewedExpenseConfirmations();
      await this.settleCategoryEdits();
      const rows = await this.allRecords();
      const passwordVault = await this.readPasswordVault();
      const intakeReview = parseReviewedCandidates(await this.fileStore.intakeReview.toArray());
      assertReviewedAssetReferences(intakeReview, assetIdsIn(rows), historyByIdIn(rows));
      const blobs: StoredFile[] = [];
      for (const id of attachmentIdsIn(rows)) {
        const file = await this.fileStore.blobs.get(id);
        if (!file) throw Error('archive-attachment-reference');
        blobs.push(file);
      }
      validateReferences(rows, new Set(blobs.map(blob => blob.id)));
      const entries: Record<string, Uint8Array> = { 'records.json': strToU8(JSON.stringify(rows)),
        'intake-review.json': strToU8(JSON.stringify(intakeReview)) };
      if (passwordVault) entries['password-vault.kdbx'] = passwordVault.bytes;
      const attachments: AttachmentManifest[] = [];
      for (const item of blobs) {
        const bytes = new Uint8Array(await item.blob.arrayBuffer());
        entries[`files/${item.id}`] = bytes;
        attachments.push({ id: item.id, name: item.name, type: attachmentSchema.shape.type.parse(item.blob.type), size: bytes.length, sha256: await sha(bytes) });
      }
      // A second tab may change records while attachments are read. Fail the
      // export instead of returning a mixed record/image snapshot.
      await this.fileStore.transaction('r', [this.fileStore.intakeReview, this.fileStore.importJournal,
        this.fileStore.categoryEditJournal, this.fileStore.passwordVault, this.fileStore.journal], async (scopeTx27) => {
        const repositoryTx27 = this.withStorage(scopeTx27);

        if ((await repositoryTx27.fileStore.journal.toArray()).some(entry => entry.passwordVault !== undefined)) throw Error('restore-recovery-pending');
        if (await repositoryTx27.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
        await assertNoPendingReviewedConfirmations(repositoryTx27.fileStore);
        const actual = await repositoryTx27.fileStore.outsideTransaction(() => repositoryTx27.allRecords());
        if (JSON.stringify(actual.sort((a, b) => a.id.localeCompare(b.id))) !==
          JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))) throw Error('archive-export-stale');
        if (reviewFingerprint(parseReviewedCandidates(await repositoryTx27.fileStore.intakeReview.toArray())) !==
          reviewFingerprint(intakeReview)) throw Error('archive-export-stale');
        const actualVault = await repositoryTx27.fileStore.passwordVault.get('local');
        if ((actualVault?.revision ?? null) !== (passwordVault?.revision ?? null) ||
          !!actualVault !== !!passwordVault || actualVault && passwordVault && !sameBytes(actualVault.bytes, passwordVault.bytes)) {
          throw Error('archive-export-stale');
        }
      });
      for (const item of blobs) {
        const current = await this.fileStore.blobs.get(item.id);
        const expected = attachments.find(attachment => attachment.id === item.id);
        if (!current || !expected || current.name !== expected.name || current.blob.type !== expected.type ||
          await sha(new Uint8Array(await current.blob.arrayBuffer())) !== expected.sha256) throw Error('archive-export-stale');
      }
      const sourceBinding = await this.getDatasetBinding();
      entries['manifest.json'] = strToU8(JSON.stringify({
        format: 'keepany-backup', version: 1, createdAt: new Date().toISOString(),
        recordCount: rows.length, recordsHash: await sha(entries['records.json']), attachments,
        intakeReviewCount: intakeReview.length, intakeReviewHash: await sha(entries['intake-review.json']),
        ...(passwordVault ? { passwordVault: { revision: passwordVault.revision, updatedAt: passwordVault.updatedAt,
          size: passwordVault.bytes.length, sha256: await sha(passwordVault.bytes) } } : {}),
        ...(sourceBinding ? { sourceBinding } : {}),
      }));
      if (Object.values(entries).reduce((size, entry) => size + entry.length, 0) > 300 * 1024 * 1024) throw Error('archive-size');
      const archive = zipSync(entries, { level: 1 });
      if (archive.length > 100 * 1024 * 1024) throw Error('archive-size');
      return archive;
    });
  }

  async restoreArchive(bytes: Uint8Array): Promise<number> {
    return withRenewalLock(`keepany-renewal:${this.records.name}`, async () => {
      if (this.intakeReviewMigrationError) await this.retryIntakeReviewMigration();
      await this.settleRenewalJournals();
      await this.settleSubscriptionSaves();
      await this.settleReviewedExpenseConfirmations();
      await this.settleCategoryEdits();
      if (await this.pendingArchiveMerge()) throw Error('archive-merge-pending');
      if (await this.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const { rows, intakeReview, manifest, entries, passwordVault } = await inspectArchive(bytes);
      await assertRestoreIdentity(this.fileStore, manifest.sourceBinding);
      assertPasswordVaultRestoreConflict(await this.readPasswordVault(), passwordVault);
      // Validate all conflicts before writing attachments or a journal.
      const currentRows = new Map((await this.records.getMany(rows.map(row => row.id))).map(row => [row.id, row]));
      for (const row of rows) {
        const current = currentRows.get(row.id);
        if (current && canonical(current).payload !== row.payload) throw Error('restore-conflict');
      }
      await assertReviewRestoreConflicts(this.fileStore, intakeReview);
      for (const attachment of manifest.attachments) {
        const current = await this.fileStore.blobs.get(attachment.id);
        if (current && (current.name !== attachment.name || current.blob.type !== attachment.type ||
          current.blob.size !== attachment.size ||
          await sha(new Uint8Array(await current.blob.arrayBuffer())) !== attachment.sha256)) throw Error('restore-conflict');
      }
      const journalId = crypto.randomUUID();
      await this.fileStore.transaction('rw', [this.fileStore.blobs, this.fileStore.journal,
        this.fileStore.intakeReview, this.fileStore.importJournal, this.fileStore.archiveMerge,
        this.fileStore.categoryEditJournal, this.fileStore.datasetBinding, this.fileStore.scopedMeta,
        this.fileStore.scopedBase, this.fileStore.scopedOutbox, this.fileStore.scopedPull,
        this.fileStore.scopedAttachmentUploads, this.fileStore.syncBase, this.fileStore.syncMeta,
        this.fileStore.pullJournal, this.fileStore.passwordVault], async (scopeTx28) => {
        const repositoryTx28 = this.withStorage(scopeTx28);

        if (await repositoryTx28.fileStore.categoryEditJournal.count()) throw Error('category-edit-pending');
        await assertNoPendingReviewedConfirmations(repositoryTx28.fileStore);
        if (await repositoryTx28.fileStore.archiveMerge.count()) throw Error('archive-merge-pending');
        if (await repositoryTx28.fileStore.journal.count()) throw Error('restore-recovery-pending');
        await assertRestoreIdentity(repositoryTx28.fileStore, manifest.sourceBinding);
        assertPasswordVaultRestoreConflict(await repositoryTx28.fileStore.passwordVault.get('local') ?? null, passwordVault);
        // Preserve provenance together with the files and durable restore plan.
        // A clean-browser restore must not silently become a transfer to another owner.
        if (manifest.sourceBinding) await claimDatasetBindingInTransaction(repositoryTx28.fileStore, manifest.sourceBinding);
        await assertReviewRestoreConflicts(repositoryTx28.fileStore, intakeReview);
        for (const attachment of manifest.attachments) {
          const existing = await repositoryTx28.fileStore.blobs.get(attachment.id);
          if (existing) {
            if (existing.name !== attachment.name || existing.blob.type !== attachment.type ||
              existing.blob.size !== attachment.size ||
              !sameBytes(new Uint8Array(await repositoryTx28.fileStore.waitFor(existing.blob.arrayBuffer())), entries[`files/${attachment.id}`])) {
              throw Error('restore-conflict');
            }
          } else {
            await repositoryTx28.fileStore.blobs.add({
              id: attachment.id, name: attachment.name,
              blob: new Blob([entries[`files/${attachment.id}`] as BlobPart], { type: attachment.type }),
            });
          }
        }
        await repositoryTx28.fileStore.journal.put({ id: journalId, rows, intakeReview,
          ...(passwordVault ? { passwordVault } : {}),
          ...(manifest.sourceBinding ? { sourceBinding: manifest.sourceBinding } : {}) });
      });
    try {
      await replayJournal(this.records, this.fileStore, journalId);
      this.restoreRecoveryError = null;
    } catch (error) {
      this.restoreRecoveryError = error instanceof Error ? error.message : 'restore-failed';
      throw error;
    }
    return rows.length;
    });
  }

  async getPendingRestoreRecoveries(): Promise<PendingRestoreRecovery[]> {
    return this.fileStore.transaction('r', restoreRecoveryTables(this.fileStore), async (scopeTx29) => {
      const repositoryTx29 = this.withStorage(scopeTx29);

      const journals = await repositoryTx29.fileStore.journal.toArray();
      if (!journals.length) return [];
      const snapshot = await restoreRecoverySnapshot(repositoryTx29.records, repositoryTx29.fileStore);
      const pending: PendingRestoreRecovery[] = [];
      for (const journal of journals) pending.push(await describeRestoreRecovery(repositoryTx29.records, repositoryTx29.fileStore, journal, snapshot));
      return pending;
    });
  }

  async retryRestoreRecovery(expected: RestoreRecoveryToken): Promise<'completed'> {
    try {
      await replayJournal(this.records, this.fileStore, expected.journalId, expected);
      this.restoreRecoveryError = await this.fileStore.journal.count() ? 'restore-recovery-pending' : null;
      return 'completed';
    } catch (error) {
      if (!(error instanceof Error && error.message === 'restore-recovery-stale'))
        this.restoreRecoveryError = error instanceof Error ? error.message : 'restore-failed';
      throw error;
    }
  }

  async abandonRestoreRecovery(expected: RestoreRecoveryToken): Promise<'kept-current'> {
    await this.fileStore.transaction('rw', restoreRecoveryTables(this.fileStore), async (scopeTx30) => {
      const repositoryTx30 = this.withStorage(scopeTx30);

      const journal = await repositoryTx30.fileStore.journal.get(expected.journalId);
      if (!journal) throw Error('restore-recovery-stale');
      const snapshot = await restoreRecoverySnapshot(repositoryTx30.records, repositoryTx30.fileStore);
      await assertRestoreRecoveryToken(repositoryTx30.records, repositoryTx30.fileStore, journal, snapshot, expected);
      checkedRestoreJournal(journal);
      await assertRestoreRecoverySource(repositoryTx30.fileStore, snapshot.proof, journal.sourceBinding, true);
      await assertRestoreRecoveryGate(repositoryTx30.fileStore);
      assertRestoreRecoveryReferences(snapshot.rows, snapshot.candidates, snapshot.files);
      await assertRestoreRecoveryFilesReadable(repositoryTx30.fileStore, snapshot.rows, snapshot.files);
      // Preserve every current record, candidate, attachment and provenance proof.
      // Only this exact frozen intent is abandoned; no rollback is implied.
      await repositoryTx30.fileStore.journal.delete(journal.id);
    });
    this.restoreRecoveryError = await this.fileStore.journal.count() ? 'restore-recovery-pending' : null;
    return 'kept-current';
  }

  async close(): Promise<void> {
    await this.records.close();
    this.fileStore.close();
  }
}

interface RestoreDatasetProof { binding: DatasetBinding | null; scopes: string[]; legacy: boolean;
  passwordVault?: { revision: string; sha256: string } | null }
interface RestoreRecoverySnapshot {
  proof: RestoreDatasetProof; rows: RecordRow[]; candidates: ReviewedCandidate[]; files: Map<string, StoredFile>;
  passwordVault: VaultRecord | null;
}
function restoreRecoveryTables(store: FileStore) {
  return [store.journal, store.blobs, store.intakeReview, store.categoryEditJournal, store.importJournal,
    store.archiveMerge, store.renewalJournal, store.subscriptionSaveJournal, store.datasetBinding, store.scopedMeta, store.scopedBase, store.scopedOutbox,
    store.scopedPull, store.scopedAttachmentUploads, store.syncBase, store.syncMeta, store.pullJournal, store.passwordVault];
}
async function restoreDatasetProof(store: FileStore): Promise<RestoreDatasetProof> {
  const [stored, meta, base, outbox, pulls, uploads, oldBase, oldMeta, oldPull] = await Promise.all([
    store.datasetBinding.get('active'), store.scopedMeta.keys(),
    store.scopedBase.distinct('scope'), store.scopedOutbox.distinct('scope'),
    store.scopedPull.toArray(), store.scopedAttachmentUploads.distinct('scope'),
    store.syncBase.count(), store.syncMeta.count(), store.pullJournal.count(),
  ]);
  const binding = stored ? { endpoint: stored.endpoint, accountId: stored.accountId,
    workspaceId: stored.workspaceId, scope: stored.scope } : null;
  return { binding, scopes: [...new Set([...meta, ...base, ...outbox, ...uploads,
    ...pulls.flatMap(pull => [pull.id, pull.scope])])].map(String).sort(), legacy: Boolean(oldBase || oldMeta || oldPull) };
}
async function assertRestoreRecoverySource(store: FileStore, proof: RestoreDatasetProof, source: DatasetBinding | undefined,
  requireClaim: boolean): Promise<void> {
  if (proof.binding && (!source || !sameDatasetBinding(proof.binding, source))) throw Error('restore-source-identity');
  if (source) await store.waitFor(validateDatasetBinding(source));
  if (proof.binding) await store.waitFor(validateDatasetBinding(proof.binding));
  if (requireClaim && source && !proof.binding) throw Error('restore-source-identity');
  if (proof.legacy || proof.scopes.length > 1) throw Error('sync-dataset-ambiguous');
  const binding = proof.binding ?? (requireClaim ? null : source);
  if (!binding && proof.scopes.length) throw Error('sync-dataset-ambiguous');
  if (binding && proof.scopes.some(scope => scope !== binding.scope)) throw Error('sync-dataset-bound');
}
async function storedRestoreRows(db: RecordBackend): Promise<RecordRow[]> {
  return (await db.list()).map(canonical);
}
async function restoreRecoverySnapshot(db: RecordBackend, store: FileStore): Promise<RestoreRecoverySnapshot> {
  // FileStore reads stay in the owning transaction. Only RxDB work escapes it;
  // reading a locked FileStore table from ignoreTransaction would self-deadlock.
  const [proof, candidates, files, storedVault] = await Promise.all([
    restoreDatasetProof(store), store.intakeReview.toArray(), store.blobs.toArray(), store.passwordVault.get('local'),
  ]);
  const passwordVault = storedVault ? checkedPasswordVaultRecord(storedVault) : null;
  proof.passwordVault = passwordVault ? { revision: passwordVault.revision,
    sha256: await store.waitFor(sha(passwordVault.bytes)) } : null;
  const rows = await store.outsideTransaction(() => storedRestoreRows(db));
  return { proof, rows, candidates, files: new Map(files.map(file => [file.id, file])), passwordVault };
}
function checkedRestoreJournal(journal: Journal): Journal {
  try {
    if (!journal || typeof journal.id !== 'string' || !journal.id || !Array.isArray(journal.rows) ||
      journal.rows.length > 100000) throw Error('invalid');
    const ids = new Set<string>();
    for (const row of journal.rows) {
      validateRow(row);
      if (ids.has(row.id)) throw Error('invalid');
      ids.add(row.id);
    }
    return { ...journal, intakeReview: parseReviewedCandidates(journal.intakeReview ?? []),
      ...(journal.passwordVault !== undefined ? { passwordVault: checkedPasswordVaultRecord(journal.passwordVault) } : {}) };
  } catch { throw Error('restore-recovery-invalid'); }
}
async function restoreRecoveryToken(db: RecordBackend, store: FileStore, journal: Journal,
  proof: RestoreDatasetProof): Promise<RestoreRecoveryToken> {
  const scopes = [...new Set([...proof.scopes, ...(proof.binding ? [proof.binding.scope] : [])])].sort();
  // Hash the encrypted bytes directly rather than expanding a 16 MiB KDBX
  // into a much larger JSON numeric array just to build an opaque token.
  const tokenPlan = journal.passwordVault?.bytes instanceof Uint8Array ? { ...journal,
    passwordVault: { id: journal.passwordVault.id, revision: journal.passwordVault.revision,
      updatedAt: journal.passwordVault.updatedAt, size: journal.passwordVault.bytes.length,
      sha256: await store.waitFor(sha(journal.passwordVault.bytes)) } } : journal;
  const [planHash, datasetProof] = await store.waitFor(Promise.all([
    sha(strToU8(JSON.stringify(tokenPlan))),
    sha(strToU8(JSON.stringify({ db: db.name, store: store.name, binding: proof.binding, scopes,
      legacy: proof.legacy, passwordVault: proof.passwordVault ?? null }))),
  ]));
  return { journalId: journal.id, planHash, datasetProof };
}
async function assertRestoreRecoveryToken(db: RecordBackend, store: FileStore, journal: Journal,
  snapshot: RestoreRecoverySnapshot, expected: RestoreRecoveryToken): Promise<void> {
  const actual = await restoreRecoveryToken(db, store, journal, snapshot.proof);
  if (!expected || actual.journalId !== expected.journalId || actual.planHash !== expected.planHash ||
    actual.datasetProof !== expected.datasetProof) throw Error('restore-recovery-stale');
}
async function assertRestoreRecoveryGate(store: FileStore): Promise<void> {
  if (await store.categoryEditJournal.count()) throw Error('category-edit-pending');
  if (await store.renewalJournal.count()) throw Error('renewal-recovery-pending');
  if (await store.subscriptionSaveJournal.count()) throw Error('subscription-relations-pending');
  if (await store.archiveMerge.count()) throw Error('archive-merge-pending');
  await assertNoPendingReviewedConfirmations(store);
}
async function assertNoPendingReviewedConfirmations(store: FileStore): Promise<void> {
  const entries = await store.importJournal.toArray();
  if (entries.some(entry => entry.reviewedExpense)) throw Error('review-expense-pending');
  if (entries.some(entry => entry.reviewedAssetMerge)) throw Error('review-merge-pending');
  if (entries.some(entry => entry.reviewedWithdrawal)) throw Error('review-withdraw-pending');
}
async function recoverReviewedAssetMerges(db: RecordBackend, store: FileStore): Promise<void> {
  for (const entry of await store.importJournal.toArray()) {
    if (entry.reviewedAssetMerge) await replayReviewedAssetMerge(db, store, entry.id);
  }
}
function assertRestoreRecoveryReferences(rows: RecordRow[], candidates: ReviewedCandidate[], files: Map<string, StoredFile>): void {
  let parsed: ReviewedCandidate[];
  let normalized: RecordRow[];
  try {
    normalized = rows.map(row => {
      validateRow(row);
      return { ...row, payload: JSON.stringify(parsedPayload(row)) };
    });
    parsed = parseReviewedCandidates(candidates);
  }
  catch { throw Error('restore-recovery-invalid'); }
  validateReferences(normalized, new Set(files.keys()));
  assertReviewedAssetReferences(parsed, assetIdsIn(rows), historyByIdIn(rows));
  for (const id of attachmentIdsIn(rows)) {
    const file = files.get(id);
    if (!file || !(file.blob instanceof Blob) || !attachmentSchema.shape.type.safeParse(file.blob.type).success ||
      !attachmentSchema.shape.name.safeParse(file.name).success || file.blob.size > 20 * 1024 * 1024) throw Error('archive-attachment-reference');
  }
}
async function assertRestoreRecoveryFilesReadable(store: FileStore, rows: RecordRow[], files: Map<string, StoredFile>): Promise<void> {
  for (const id of attachmentIdsIn(rows)) {
    const file = files.get(id);
    if (!file || (await store.waitFor(file.blob.arrayBuffer())).byteLength !== file.blob.size) throw Error('archive-attachment-reference');
  }
}
function plannedRestoreSnapshot(journal: Journal, snapshot: RestoreRecoverySnapshot) {
  assertPasswordVaultRestoreConflict(snapshot.passwordVault, journal.passwordVault ?? null);
  const rows = new Map(snapshot.rows.map(row => [row.id, row]));
  let parsed: ReviewedCandidate[];
  try { parsed = parseReviewedCandidates(snapshot.candidates); }
  catch { throw Error('restore-recovery-invalid'); }
  const candidates = new Map(parsed.map(row => [row.id, row]));
  for (const row of journal.rows) {
    const current = rows.get(row.id);
    if (current && current.payload !== row.payload) throw Error('restore-conflict');
    rows.set(row.id, row);
  }
  for (const candidate of journal.intakeReview ?? []) {
    const current = candidates.get(candidate.id);
    if (current && !sameReviewedCandidate(current, candidate)) throw Error('restore-conflict');
    candidates.set(candidate.id, candidate);
  }
  return { rows: [...rows.values()], candidates: [...candidates.values()] };
}
async function describeRestoreRecovery(db: RecordBackend, store: FileStore, journal: Journal,
  snapshot: RestoreRecoverySnapshot): Promise<PendingRestoreRecovery> {
  const token = await restoreRecoveryToken(db, store, journal, snapshot.proof);
  const current = new Map(snapshot.rows.map(row => [row.id, row]));
  const rows = Array.isArray(journal.rows) ? journal.rows : [];
  let presentEqual = 0, missing = 0, different = 0;
  for (const row of rows) {
    const existing = row && current.get(row.id);
    if (!existing) missing++;
    else if (existing.payload === row.payload) presentEqual++;
    else different++;
  }
  const result: PendingRestoreRecovery = { token, rowCount: rows.length,
    candidateCount: Array.isArray(journal.intakeReview) ? journal.intakeReview.length : 0,
    presentEqual, missing, different, canRetry: false, canAbandon: false, reason: null };
  try {
    const checked = checkedRestoreJournal(journal);
    await assertRestoreRecoverySource(store, snapshot.proof, checked.sourceBinding, true);
    await assertRestoreRecoveryGate(store);
    try {
      const planned = plannedRestoreSnapshot(checked, snapshot);
      assertRestoreRecoveryReferences(planned.rows, planned.candidates, snapshot.files);
      result.canRetry = true;
    } catch (error) { result.reason = error instanceof z.ZodError ? 'restore-recovery-invalid' : error instanceof Error ? error.message : 'restore-failed'; }
    try {
      assertRestoreRecoveryReferences(snapshot.rows, snapshot.candidates, snapshot.files);
      result.canAbandon = true;
    } catch (error) { result.reason ??= error instanceof z.ZodError ? 'restore-recovery-invalid' : error instanceof Error ? error.message : 'restore-failed'; }
  } catch (error) { result.reason = error instanceof z.ZodError ? 'restore-recovery-invalid' : error instanceof Error ? error.message : 'restore-failed'; }
  return result;
}

async function replayJournal(_db: RecordBackend, store: FileStore, id: string, expected?: RestoreRecoveryToken): Promise<void> {
  await store.transaction('rw', restoreRecoveryTables(store), async (store) => {
    const db = store.records;

    const entry = await store.journal.get(id);
    if (!entry) {
      if (expected) throw Error('restore-recovery-stale');
      return;
    }
    const snapshot = await restoreRecoverySnapshot(db, store);
    if (expected) await assertRestoreRecoveryToken(db, store, entry, snapshot, expected);
    const journal = checkedRestoreJournal(entry);
    await assertRestoreRecoverySource(store, snapshot.proof, journal.sourceBinding, true);
    await assertRestoreRecoveryGate(store);
    const planned = plannedRestoreSnapshot(journal, snapshot);
    assertRestoreRecoveryReferences(planned.rows, planned.candidates, snapshot.files);
    await assertRestoreRecoveryFilesReadable(store, planned.rows, snapshot.files);
    const restored = await store.outsideTransaction(async () => {
      if (db.restoreRowsIfIdentical) await db.restoreRowsIfIdentical(journal.rows);
      else for (const row of journal.rows) {
        const [current] = await db.getMany([row.id], false);
        if (current) {
          if (current.payload !== row.payload) throw Error('restore-conflict');
          continue;
        }
        try { await db.insert(row); }
        catch (error) {
          const [raced] = await db.getMany([row.id], false);
          if (!raced) throw error;
          if (raced.payload !== row.payload) throw Error('restore-conflict');
        }
      }
      return storedRestoreRows(db);
    });
    assertRestoreRecoveryReferences(restored, planned.candidates, snapshot.files);
    for (const candidate of journal.intakeReview ?? []) if (!(await store.intakeReview.get(candidate.id))) await store.intakeReview.add(candidate);
    if (journal.passwordVault && !snapshot.passwordVault) await store.passwordVault.add(checkedPasswordVaultRecord(journal.passwordVault));
    await store.journal.delete(id);
  });
}

function assetIdsIn(rows: RecordRow[]): Set<string> {
  return new Set(rows.filter(row => row.type === 'asset').map(row => parsedPayload(row).id));
}
function historyByIdIn(rows: RecordRow[]): Map<string, History> {
  return new Map(rows.filter(row => row.type === 'history').map(row => {
    const history = entitySchemas.history.parse(JSON.parse(row.payload));
    return [history.id, history];
  }));
}

function reviewFingerprint(rows: ReviewedCandidate[]): string {
  return JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
}

async function assertReviewRestoreConflicts(store: FileStore, rows: ReviewedCandidate[]): Promise<void> {
  for (const row of rows) {
    const current = await store.intakeReview.get(row.id);
    if (current && !sameReviewedCandidate(current, row)) throw Error('restore-conflict');
  }
}

async function targetFingerprint(rows: RecordRow[], store: FileStore): Promise<string> {
  const files = await store.blobs.toArray();
  const intakeReview = parseReviewedCandidates(await store.intakeReview.toArray());
  const signatures = await Promise.all(files.map(async file => ({ id: file.id, name: file.name,
    type: file.blob.type, sha256: await sha(new Uint8Array(await file.blob.arrayBuffer())) })));
  const passwordVault = await store.passwordVault.get('local');
  return sha(strToU8(JSON.stringify({ rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
    files: signatures.sort((a, b) => a.id.localeCompare(b.id)), intakeReview: reviewFingerprint(intakeReview),
    passwordVault: passwordVault ? { revision: passwordVault.revision, sha256: await sha(checkedPasswordVaultRecord(passwordVault).bytes) } : null })));
}

function assertPasswordVaultRestoreConflict(current: VaultRecord | null, incoming: VaultRecord | null): void {
  if (current) checkedPasswordVaultRecord(current);
  if (incoming) checkedPasswordVaultRecord(incoming);
  if (current && incoming && !sameBytes(current.bytes, incoming.bytes)) throw Error('restore-vault-conflict');
}
async function assertArchiveMergePasswordVault(store: FileStore, incoming: VaultRecord | null): Promise<void> {
  const current = await store.passwordVault.get('local') ?? null;
  assertPasswordVaultRestoreConflict(current, incoming);
  // A merge only changes ordinary assets. Moving a vault requires a clean
  // restore with its own durable checkpoint; otherwise it could be omitted.
  if (incoming && !current) throw Error('restore-vault-conflict');
}

function sameMergeReview(left: ReviewedCandidate | null, right: ReviewedCandidate | null): boolean {
  return left === right || !!left && !!right && sameReviewedCandidate(left, right);
}

async function writeArchiveMergeReview(store: FileStore, before: ReviewedCandidate | null,
  after: ReviewedCandidate | null): Promise<void> {
  const id = after?.id ?? before?.id;
  if (!id) throw Error('archive-merge-row');
  const current = await store.intakeReview.get(id) ?? null;
  if (!sameMergeReview(current, before)) throw Error('archive-merge-race');
  if (after) await store.intakeReview.put(after);
  else await store.intakeReview.delete(id);
}

function sameMergeRow(left: RecordRow | null, right: RecordRow | null): boolean {
  return left === right || !!left && !!right && left.id === right.id && left.type === right.type &&
    left.payload === right.payload && left.updatedAt === right.updatedAt;
}

async function writeArchiveMergeRow(db: RecordBackend, before: RecordRow | null, after: RecordRow | null): Promise<void> {
  const id = after?.id ?? before?.id;
  if (!id) throw Error('archive-merge-row');
  const [raw] = await db.getMany([id], true);
  const current = raw && !raw.internalDeleted ? raw as RecordRow : null;
  if (!sameMergeRow(current, before)) throw Error('archive-merge-race');
  if (sameMergeRow(before, after)) return;
  const next = after ?? raw;
  if (!next) throw Error('archive-merge-row');
  const result = await db.compareAndWrite([{ previous: raw ?? null, next, internalDeleted: !after }], 'archive-merge');
  if (result.error.length) throw Error(result.error.some(error => error.status === 409) ? 'archive-merge-race' : 'archive-merge-write');
}

async function rollbackArchiveMergeJournal(db: RecordBackend, store: FileStore): Promise<void> {
  const journal = await store.archiveMerge.get('active');
  if (!journal) return;
  if (journal.phase === 'syncing') throw Error('archive-merge-sync-started');
  // Preflight all rows before mutating any. A partially reverted prior attempt
  // is accepted, but a third-party edit leaves the journal intact.
  for (const change of journal.changes) {
    const [raw] = await db.getMany([change.after.id], true);
    const current = raw && !raw.internalDeleted ? raw as RecordRow : null;
    if (!sameMergeRow(current, change.after) && !sameMergeRow(current, change.before)) throw Error('archive-merge-rollback-conflict');
  }
  await store.transaction('rw', store.intakeReview, async (store) => {

    for (const change of journal.intakeReviewChanges ?? []) {
      const current = await store.intakeReview.get(change.after.id) ?? null;
      if (!sameMergeReview(current, change.before) && !sameMergeReview(current, change.after)) {
        throw Error('archive-merge-rollback-conflict');
      }
    }
    // Undo review decisions before removing the assets they may reference.
    for (const change of [...(journal.intakeReviewChanges ?? [])].reverse()) {
      const current = await store.intakeReview.get(change.after.id) ?? null;
      if (!sameMergeReview(current, change.before)) await writeArchiveMergeReview(store, change.after, change.before);
    }
  });
  for (const change of [...journal.changes].reverse()) {
    const [raw] = await db.getMany([change.after.id], true);
    const current = raw && !raw.internalDeleted ? raw as RecordRow : null;
    if (sameMergeRow(current, change.before)) continue;
    await writeArchiveMergeRow(db, change.after, change.before);
  }
  const rows = (await db.list()).map(canonical);
  const referenced = attachmentIdsIn(rows);
  await store.transaction('rw', [store.blobs, store.archiveMerge], async (store) => {

    for (const id of journal.insertedFileIds) {
      if (referenced.has(id)) throw Error('archive-merge-rollback-conflict');
      await store.blobs.delete(id);
    }
    await store.archiveMerge.delete('active');
  });
}

async function rollbackImport(_db: RecordBackend, store: FileStore, id: string): Promise<void> {
  await store.transaction('rw', [store.importJournal, store.categoryEditJournal], async (store) => {
    const db = store.records;

    const journal = await store.importJournal.get(id);
    if (!journal) return;
    await store.outsideTransaction(async () => {
      for (const row of journal.rows) {
        const current = await db.get(row.id);
        if (!current) continue;
        if (canonical(current).payload !== row.payload) throw Error('import-rollback-conflict');
        await db.remove(current.id, current.revision);
      }
    });
    await store.importJournal.delete(id);
  });
}

// A completed storage batch is atomic. If RxDB reports a per-row CAS conflict,
// repair only this journal's own history row; never rewind an unrelated asset update.
async function replayRenewalJournal(db: RecordBackend, store: FileStore, id: string): Promise<'committed' | 'cancelled'> {
  const journal = await store.renewalJournal.get(id);
  if (!journal) return 'cancelled';
  const [asset] = await db.getMany([journal.next.id], false);
  const [history] = await db.getMany([journal.history.id], false);
  const assetPayload = asset ? asset.payload : null;
  const historyPayload = history ? history.payload : null;
  if (historyPayload && historyPayload !== journal.history.payload) throw Error('renewal-recovery-conflict');
  const action = entitySchemas.history.parse(JSON.parse(journal.history.payload)).action;
  const markerField = action === 'renew' ? 'lastRenewalId' : 'lastItemEventId';
  const expectedMarker = entitySchemas.asset.parse(JSON.parse(journal.expectedPayload))[markerField];
  const nextMarker = entitySchemas.asset.parse(JSON.parse(journal.next.payload))[markerField];
  const currentMarker = assetPayload ? entitySchemas.asset.parse(JSON.parse(assetPayload))[markerField] : null;
  // A later ordinary edit can change the payload without changing this operation marker.
  // Old v7 journals have no marker, so keep their exact-payload recovery behavior.
  if (assetPayload === journal.next.payload || (nextMarker && currentMarker === nextMarker)) {
    if (!history) {
      try { await db.insert(journal.history); }
      catch (error) {
        const raced = await db.get(journal.history.id);
        if (!raced || canonical(raced).payload !== journal.history.payload) throw error;
      }
    }
    await store.renewalJournal.delete(id);
    return 'committed';
  }
  const cannotCancel = nextMarker
    ? currentMarker !== expectedMarker
    : assetPayload !== journal.expectedPayload;
  if (cannotCancel) {
    throw Error('renewal-recovery-conflict');
  }
  if (history) {
    const document = await db.get(journal.history.id);
    if (!document) throw Error('renewal-recovery-conflict');
    await db.remove(document.id, document.revision);
  }
  await store.renewalJournal.delete(id);
  return 'cancelled';
}

function validateRow(row: RecordRow): void {
  if (!Object.hasOwn(entitySchemas, row.type) || typeof row.payload !== 'string' ||
    !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('pull-record');
  const entity = parsedPayload(row);
  if (row.id !== key(row.type, entity.id)) throw Error('pull-record');
}

async function assertRowAttachmentsAvailable(store: FileStore, row: RecordRow): Promise<void> {
  if (row.type !== 'asset') return;
  const asset = parsedPayload(row) as unknown as { attachments: string[] };
  for (const id of asset.attachments) {
    if (!(await store.blobs.get(id))) throw Error('attachment-missing');
  }
}

async function replayPullJournal(_db: RecordBackend, store: FileStore, id: string): Promise<void> {
  return store.transaction('rw', [store.pullJournal, store.syncMeta, store.syncBase,
    store.journal, store.categoryEditJournal], async (store) => {
    const db = store.records;

    if (await store.journal.count()) throw Error('restore-recovery-pending');
    if (await store.categoryEditJournal.count()) throw Error('category-edit-pending');
  const journal = await store.pullJournal.get(id);
  if (!journal) return;
  if (((await store.syncMeta.get('cursor'))?.cursor ?? 0) !== journal.cursorStart) throw Error('cursor-mismatch');
  for (const change of journal.changes) {
    validateRow(change.row);
    const current = await store.outsideTransaction(() => db.get(change.row.id));
    const base = await store.syncBase.get(change.row.id);
    const currentPayload = current ? canonical(current).payload : null;
    if (currentPayload !== change.row.payload) {
      if (currentPayload !== (base?.payload ?? null)) throw Error('sync-conflict');
      if (current) {
        const conflict = Symbol('sync-conflict');
        try {
          await store.outsideTransaction(() => db.modify(current.id, (data: RecordRow) => {
            if (data.payload !== (base?.payload ?? null) || isPurgedPayload(change.row.type, data.payload)) throw conflict;
            return { ...data, ...change.row };
          }));
        } catch (error) {
          if (error === conflict) throw Error('sync-conflict');
          throw error;
        }
      } else {
        try { await store.outsideTransaction(() => db.insert(change.row)); }
        catch (error) {
          const raced = await store.outsideTransaction(() => db.get(change.row.id));
          if (!raced || canonical(raced).payload !== change.row.payload) throw error;
        }
      }
    }
    await store.syncBase.put({ id: change.row.id, payload: change.row.payload, version: change.version });
  }
    await store.syncMeta.put({ id: 'cursor', cursor: journal.cursorStart + journal.changes.length });
    await store.pullJournal.delete(id);
  });
}

function assertScope(scope: string): void {
  if (!/^[a-f0-9]{64}:[a-f0-9-]{36}$/.test(scope)) throw Error('sync-scope');
}
function scopedKey(scope: string, rowId: string): string { assertScope(scope); return `${scope}|${rowId}`; }

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function copyAttachmentPlan(plan: ScopedAttachmentUploadPlan): ScopedAttachmentUploadPlan {
  return { scope: plan.scope, attachmentId: plan.attachmentId, sourceSha256: plan.sourceSha256,
    keyEpoch: plan.keyEpoch, objects: plan.objects.map(object => ({ ...object, bytes: new Uint8Array(object.bytes) })) };
}

function sameAttachmentPlan(left: ScopedAttachmentUploadPlan, right: ScopedAttachmentUploadPlan): boolean {
  return left.scope === right.scope && left.attachmentId === right.attachmentId &&
    left.sourceSha256 === right.sourceSha256 && left.keyEpoch === right.keyEpoch &&
    left.objects.length === right.objects.length && left.objects.every((object, index) => {
      const other = right.objects[index];
      return object.id === other.id && object.sha256 === other.sha256 && sameBytes(object.bytes, other.bytes);
    });
}

async function validateAttachmentPlan(plan: ScopedAttachmentUploadPlan): Promise<void> {
  assertScope(plan.scope);
  if (!z.uuid().safeParse(plan.attachmentId).success || !/^[a-f0-9]{64}$/.test(plan.sourceSha256) ||
    !Number.isSafeInteger(plan.keyEpoch) || plan.keyEpoch < 1 || !Array.isArray(plan.objects) ||
    plan.objects.length < 1 || plan.objects.length > 32 ||
    plan.objects.at(-1)?.id !== plan.attachmentId) throw Error('sync-attachment-plan');
  const seen = new Set<string>();
  for (const object of plan.objects) {
    if (!z.uuid().safeParse(object.id).success || seen.has(object.id) ||
      !/^[a-f0-9]{64}$/.test(object.sha256) || !(object.bytes instanceof Uint8Array) ||
      object.bytes.length < 1 || object.bytes.length > 4 * 1024 * 1024 ||
      await sha(object.bytes) !== object.sha256) throw Error('sync-attachment-plan');
    seen.add(object.id);
  }
}

function sameDatasetBinding(a: DatasetBinding, b: DatasetBinding): boolean {
  return a.endpoint === b.endpoint && a.accountId === b.accountId &&
    a.workspaceId === b.workspaceId && a.scope === b.scope;
}

async function assertRestoreIdentity(store: FileStore, source?: DatasetBinding): Promise<void> {
  await assertRestoreRecoverySource(store, await restoreDatasetProof(store), source, false);
}

// Caller validates the identity and includes every table below in one Dexie transaction.
async function claimDatasetBindingInTransaction(store: FileStore, binding: DatasetBinding): Promise<void> {
  const existing = await store.datasetBinding.get('active');
  if (existing && !sameDatasetBinding(existing, binding)) throw Error('sync-dataset-bound');
  const [meta, base, outbox, pulls, uploads, oldBaseCount, oldMetaCount, oldPullCount] = await Promise.all([
    store.scopedMeta.keys(),
    store.scopedBase.distinct('scope'),
    store.scopedOutbox.distinct('scope'),
    store.scopedPull.keys(),
    store.scopedAttachmentUploads.distinct('scope'),
    store.syncBase.count(), store.syncMeta.count(), store.pullJournal.count(),
  ]);
  // The pre-scoped prototype has no remote identity, so its provenance cannot be inferred.
  if (oldBaseCount || oldMetaCount || oldPullCount) throw Error('sync-dataset-ambiguous');
  const legacyScopes = new Set([...meta, ...base, ...outbox, ...pulls, ...uploads]);
  if (legacyScopes.size > 1) throw Error('sync-dataset-ambiguous');
  if (legacyScopes.size === 1 && !legacyScopes.has(binding.scope)) throw Error('sync-dataset-bound');
  if (!existing) await store.datasetBinding.add({ id: 'active', ...binding });
}

async function validateDatasetBinding(binding: DatasetBinding): Promise<void> {
  let url: URL;
  try { url = new URL(binding.endpoint); }
  catch { throw Error('sync-dataset-identity'); }
  if (url.origin !== binding.endpoint || url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash || (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !binding.accountId || binding.accountId.trim() !== binding.accountId || binding.accountId.length > 256 ||
    !z.uuid().safeParse(binding.workspaceId).success || binding.workspaceId !== binding.workspaceId.toLowerCase()) {
    throw Error('sync-dataset-identity');
  }
  assertScope(binding.scope);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([binding.endpoint, binding.accountId]))));
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  if (binding.scope !== `${digest}:${binding.workspaceId}`) throw Error('sync-dataset-identity');
}

async function replayScopedPull(_db: RecordBackend, store: FileStore, scope: string): Promise<'applied' | 'conflict'> {
  return store.transaction('rw', [store.scopedPull, store.scopedMeta, store.scopedBase,
    store.scopedOutbox, store.journal, store.categoryEditJournal, store.blobs], async (store) => {
    const db = store.records;

  if (await store.journal.count()) throw Error('restore-recovery-pending');
  if (await store.categoryEditJournal.count()) throw Error('category-edit-pending');
  const journal = await store.scopedPull.get(scope);
  if (!journal) return 'applied';
  if (((await store.scopedMeta.get(scope))?.cursor ?? 0) !== journal.cursorStart) throw Error('cursor-mismatch');
  const { row, version } = journal.change;
  validateRow(row);
  await assertRowAttachmentsAvailable(store, row);
  const id = scopedKey(scope, row.id);
  const current = await store.outsideTransaction(() => db.get(row.id));
  const currentPayload = current ? canonical(current).payload : null;
  const base = await store.scopedBase.get(id);
  const basePayload = base?.payload ?? null;
  if (base?.version === version && base.operationId === journal.change.operationId &&
      base.ciphertext === journal.change.ciphertext && row.payload === base.payload) {
      const meta = await store.scopedMeta.get(scope);
      await store.scopedMeta.put({ ...meta, id: scope, cursor: journal.cursorStart + 1 });
      await store.scopedPull.delete(scope);
    return 'applied';
  }
  if (isPurgedPayload(row.type, currentPayload) && currentPayload !== row.payload && journal.decision !== 'local') return 'conflict';
  if (!journal.decision && currentPayload !== row.payload && currentPayload !== basePayload) return 'conflict';
  if (journal.decision === 'remote' && currentPayload !== journal.localPayload && currentPayload !== row.payload) {
    await store.scopedPull.update(scope, { decision: undefined, localPayload: currentPayload });
    return 'conflict';
  }
  if (journal.decision !== 'local' && currentPayload !== row.payload) {
    if (journal.decision !== 'remote' && currentPayload !== basePayload) return 'conflict';
    if (current) {
      await store.outsideTransaction(() => db.modify(current.id, (data: RecordRow) => {
        if (data.payload !== currentPayload) throw Error('pull-race');
        return { ...data, ...row };
      }));
    } else {
      try { await store.outsideTransaction(() => db.insert(row)); }
      catch (error) {
        const raced = await store.outsideTransaction(() => db.get(row.id));
        if (!raced || canonical(raced).payload !== row.payload) throw error;
      }
    }
  }
    await store.scopedBase.put({ id, scope, rowId: row.id, payload: row.payload, version,
      row, operationId: journal.change.operationId, keyEpoch: journal.change.keyEpoch, ciphertext: journal.change.ciphertext });
    const pending = await store.scopedOutbox.get(id);
    if (journal.decision || currentPayload === row.payload || pending?.blocked) await store.scopedOutbox.delete(id);
    const meta = await store.scopedMeta.get(scope);
    await store.scopedMeta.put({ ...meta, id: scope, cursor: journal.cursorStart + 1 });
    await store.scopedPull.delete(scope);
  return 'applied';
  });
}

export async function openRepositoryFromBackend(openedDb: RecordBackend, store: FileStore, legacyReview = false): Promise<LocalRepository> {
  const name = openedDb.name;
    // Another tab may still own an active batch; only recover its journal after the shared lock is released.
    await withRenewalLock(`keepany-batch:${name}`, async () => {
      for (const entry of await store.importJournal.toArray()) if (!entry.reviewedExpense && !entry.reviewedAssetMerge && !entry.reviewedWithdrawal) await rollbackImport(openedDb, store, entry.id);
    });
    const repository = new LocalRepository(openedDb, store);
    if (legacyReview && name === 'keepany-v1') {
      try { await repository.retryIntakeReviewMigration(); }
      catch { /* Keep local assets readable and preserve the legacy review database. */ }
    }
    await withRenewalLock(`keepany-renewal:${name}`, async () => {
      for (const entry of await store.renewalJournal.toArray()) {
        try { await replayRenewalJournal(openedDb, store, entry.id); }
        catch (error) {
          repository.renewalRecoveryError = error instanceof Error ? error.message : 'renewal-recovery-pending';
          break;
        }
      }
      for (const entry of await store.subscriptionSaveJournal.toArray()) {
        try { await replaySubscriptionSave(openedDb, store, entry.id); }
        catch (error) {
          repository.subscriptionRecoveryError = error instanceof Error ? error.message : 'subscription-relations-pending';
          break;
        }
      }
    });
    try { await repository.retryReviewedExpenseConfirmations(); }
    catch { /* Keep the frozen receipt intent visible without blocking unrelated local CRUD. */ }
    try { await recoverReviewedAssetMerges(openedDb, store); }
    catch { /* Preserve the merge intent and any newer target edit for explicit review. */ }
    try { await repository.retryAllCategoryEdits(); }
    catch { /* Preserve conflicting category intents while keeping local data readable. */ }
    if ((await store.archiveMerge.get('active'))?.phase === 'applying') {
      try { await rollbackArchiveMergeJournal(openedDb, store); }
      catch { /* Keep the durable journal and expose it through pendingArchiveMerge. */ }
    }
    for (const entry of await store.journal.toArray()) {
      try { await replayJournal(openedDb, store, entry.id); }
      catch (error) {
        // Keep an interrupted journal for manual recovery without locking users out of local data.
        repository.restoreRecoveryError = error instanceof Error ? error.message : 'restore-failed';
        break;
      }
    }
    for (const entry of await store.pullJournal.toArray()) {
      try { await replayPullJournal(openedDb, store, entry.id); }
      catch (error) { repository.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed'; break; }
    }
    const pendingScopedPulls = await store.scopedPull.toArray();
    if (pendingScopedPulls.length) {
      const binding = await store.datasetBinding.get('active');
      const [meta, base, outbox, uploads] = await Promise.all([
        store.scopedMeta.keys(), store.scopedBase.distinct('scope'),
        store.scopedOutbox.distinct('scope'), store.scopedAttachmentUploads.distinct('scope'),
      ]);
      const scopes = new Set([...meta, ...base, ...outbox, ...uploads, ...pendingScopedPulls.map(entry => entry.scope)]);
      if (scopes.size > 1) repository.syncRecoveryError = 'sync-dataset-ambiguous';
      else if (binding && scopes.size && !scopes.has(binding.scope)) repository.syncRecoveryError = 'sync-dataset-bound';
      else {
        for (const entry of pendingScopedPulls) {
          try { await replayScopedPull(openedDb, store, entry.scope); }
          catch (error) { repository.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed'; break; }
        }
      }
    }
    return repository;
}

export async function openLocalRepository(name: string): Promise<LocalRepository> {
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(name)) throw Error('database-name');
  const store = name === 'keepany-v1' ? defaultFiles() : new WebFileStore(name);
  let db: RxDatabase | undefined;
  try {
    db = await createRxDatabase({ name, storage: getRxStorageDexie(), multiInstance: true });
    await db.addCollections({ records: { schema: recordSchema } });
    const openedDb = new WebRecordBackend(db);
    store.bindRecords(openedDb);
    return await openRepositoryFromBackend(openedDb, store, name === 'keepany-v1');
  } catch (error) {
    await db?.close();
    if (store !== defaultState.fileStore) store.close();
    throw error;
  }
}

let singleton: Promise<LocalRepository> | undefined;
/** Install before any page starts reading. Native failures never open the Web default. */
export function registerRepositoryFactory(factory: () => Promise<LocalRepository>): void {
  if (singleton || defaultState.resources) throw Error('repository-already-started');
  defaultState.factory = factory;
}

function defaultRepository(): Promise<LocalRepository> {
  if (!singleton && defaultState.factory) {
    singleton = defaultState.factory().catch(error => { singleton = undefined; throw error; });
  }
  if (!singleton) {
    if (!defaultState.resources) {
      defaultState.resources = openLocalRepository('keepany-v1')
        .then(repository => ({ db: repository.db, records: repository.records, fileStore: repository.fileStore,
          recoveryState: repository.recoveryState }))
        .catch(error => { defaultState.resources = undefined; throw error; });
    }
    const resources = defaultState.resources;
    singleton = resources.then(async resource => {
      // An older HMR module kept only handles. Preserve a visible pending state for its journals.
      if (!resource.recoveryState) {
        resource.recoveryState = {
          restoreError: await resource.fileStore.journal.count() ? 'restore-recovery-pending' : null,
          syncError: await resource.fileStore.pullJournal.count() || await resource.fileStore.scopedPull.count()
            ? 'sync-recovery-pending' : null,
          renewalError: await resource.fileStore.renewalJournal.count() ? 'renewal-recovery-pending' : null,
          subscriptionError: await resource.fileStore.subscriptionSaveJournal.count() ? 'subscription-relations-pending' : null,
          intakeError: null,
          intakeExpenseError: null,
          categoryEditError: null,
        };
      }
      if (resource.recoveryState.renewalError === undefined) resource.recoveryState.renewalError = null;
      if (resource.recoveryState.subscriptionError === undefined) resource.recoveryState.subscriptionError = null;
      if (resource.recoveryState.intakeError === undefined) resource.recoveryState.intakeError = null;
      if (resource.recoveryState.intakeExpenseError === undefined) resource.recoveryState.intakeExpenseError = null;
      if (resource.recoveryState.categoryEditError === undefined) resource.recoveryState.categoryEditError = null;
      const repository = new LocalRepository(resource.records, resource.fileStore, resource.recoveryState);
      try { await repository.retryIntakeReviewMigration(); }
      catch { /* The shared migration error stays visible while local CRUD remains usable. */ }
      await withRenewalLock(`keepany-renewal:${resource.records.name}`, async () => {
        for (const entry of await resource.fileStore.renewalJournal.toArray()) {
          try { await replayRenewalJournal(resource.records, resource.fileStore, entry.id); }
          catch (error) {
            repository.renewalRecoveryError = error instanceof Error ? error.message : 'renewal-recovery-pending';
            break;
          }
        }
        for (const entry of await resource.fileStore.subscriptionSaveJournal.toArray()) {
          try { await replaySubscriptionSave(resource.records, resource.fileStore, entry.id); }
          catch (error) {
            repository.subscriptionRecoveryError = error instanceof Error ? error.message : 'subscription-relations-pending';
            break;
          }
        }
        if (!(await resource.fileStore.subscriptionSaveJournal.count())) repository.subscriptionRecoveryError = null;
        if ((await resource.fileStore.archiveMerge.get('active'))?.phase === 'applying') {
          try { await rollbackArchiveMergeJournal(resource.records, resource.fileStore); }
          catch { /* Pending state remains visible for explicit recovery. */ }
        }
      });
      try { await repository.retryReviewedExpenseConfirmations(); }
      catch { /* Pending confirmation stays frozen and can be retried explicitly. */ }
      try { await recoverReviewedAssetMerges(resource.records, resource.fileStore); }
      catch { /* Pending merge stays visible through its durable candidate intent. */ }
      try { await repository.retryAllCategoryEdits(); }
      catch { /* The persisted direction and conflict remain available for recovery. */ }
      for (const entry of await resource.fileStore.journal.toArray()) {
        try { await replayJournal(resource.records, resource.fileStore, entry.id); }
        catch (error) {
          repository.restoreRecoveryError = error instanceof Error ? error.message : 'restore-failed';
          break;
        }
      }
      if (!(await resource.fileStore.journal.count())) repository.restoreRecoveryError = null;
      return repository;
    })
      .catch(error => { singleton = undefined; throw error; });
  }
  return singleton;
}
export async function database(): Promise<RxDatabase> { return (await defaultRepository()).db; }
export async function localRepository(): Promise<LocalRepository> { return defaultRepository(); }
export async function save(type: EntityType, value: unknown) { return (await defaultRepository()).save(type, value); }
export async function createCategory(kind: AssetKind, name: string, order: number) {
  return (await defaultRepository()).createCategory(kind, name, order);
}
export async function editCustomCategory(input: EditCustomCategoryInput) {
  return (await defaultRepository()).editCustomCategory(input);
}
export async function deleteCustomCategory(input: DeleteCustomCategoryInput) {
  return (await defaultRepository()).deleteCustomCategory(input);
}
export async function getPendingCategoryEdit(kind: AssetKind) { return (await defaultRepository()).getPendingCategoryEdit(kind); }
export async function retryCategoryEdit(kind: AssetKind, expectedOperationId?: string) { return (await defaultRepository()).retryCategoryEdit(kind, expectedOperationId); }
export async function cancelCategoryEdit(kind: AssetKind, expectedOperationId?: string) { return (await defaultRepository()).cancelCategoryEdit(kind, expectedOperationId); }
export async function saveAssetIfCurrent(expected: Asset, next: Asset) { return (await defaultRepository()).saveAssetIfCurrent(expected, next); }
export async function saveRelationIfCurrent(expected: Relation, next: Relation) { return (await defaultRepository()).saveRelationIfCurrent(expected, next); }
export async function saveSubscription(expected: Asset | null, next: Asset, links: ReadonlyArray<SubscriptionLink>) { return (await defaultRepository()).saveSubscription(expected, next, links); }
export async function getPendingSubscriptionSave(assetId: string) { return (await defaultRepository()).getPendingSubscriptionSave(assetId); }
export async function retrySubscriptionSave(assetId: string) { return (await defaultRepository()).retrySubscriptionSave(assetId); }
export async function abandonSubscriptionSave(assetId: string) { return (await defaultRepository()).abandonSubscriptionSave(assetId); }
export async function saveTaskIfCurrent(expected: Task, next: Task) { return (await defaultRepository()).saveTaskIfCurrent(expected, next); }
export async function saveManualTaskIfCurrent(expected: Task | null, next: Task) { return (await defaultRepository()).saveManualTaskIfCurrent(expected, next); }
export async function deleteTaskIfCurrent(expected: Task) { return (await defaultRepository()).deleteTaskIfCurrent(expected); }
export async function restoreTaskIfCurrent(expected: Task) { return (await defaultRepository()).restoreTaskIfCurrent(expected); }
export async function restoreSubmissionIfCurrent(expected: Submission) { return (await defaultRepository()).restoreSubmissionIfCurrent(expected); }
export async function saveSubmissionIfCurrent(expected: Submission, next: Submission) { return (await defaultRepository()).saveSubmissionIfCurrent(expected, next); }
export async function deleteSubmissionIfCurrent(expected: Submission) { return (await defaultRepository()).deleteSubmissionIfCurrent(expected); }
export async function createFinanceEntry(value: History) { return (await defaultRepository()).createFinanceEntry(value); }
export async function saveFinanceEntryIfCurrent(expected: History, next: History) { return (await defaultRepository()).saveFinanceEntryIfCurrent(expected, next); }
export async function restoreFinanceEntryIfCurrent(expected: History) { return (await defaultRepository()).restoreFinanceEntryIfCurrent(expected); }
export async function archiveProjectIfWorkflowComplete(expectedProject: Asset, expectedRoundId: string) {
  return (await defaultRepository()).archiveProjectIfWorkflowComplete(expectedProject, expectedRoundId);
}
export async function savePreferenceIfCurrent(expected: { id: string; value: unknown } | null, next: { id: string; value: unknown }) { return (await defaultRepository()).savePreferenceIfCurrent(expected, next); }
export async function saveBatch(items: ReadonlyArray<{ type: EntityType; value: unknown }>) { return (await defaultRepository()).saveBatch(items); }
export async function recordRenewal(expectedAsset: Asset, nextAsset: Asset, history: History) {
  return (await defaultRepository()).recordRenewal(expectedAsset, nextAsset, history);
}
export async function recordItemAction(expectedAsset: Asset, nextAsset: Asset, history: History) {
  return (await defaultRepository()).recordItemAction(expectedAsset, nextAsset, history);
}
export async function setTaskDone(id: string, expectedDone: boolean, expectedReminderAt?: string, expectedTask?: Task) {
  return (await defaultRepository()).setTaskDone(id, expectedDone, expectedReminderAt, expectedTask);
}
export async function setItemArchived(id: string, expectedStatus: 'active' | 'archived') {
  return (await defaultRepository()).setItemArchived(id, expectedStatus);
}
export async function applyPulledBatch(changes: PulledRow[], cursorStart: number) { return (await defaultRepository()).applyPulledBatch(changes, cursorStart); }
export async function syncCursor() { return (await defaultRepository()).syncCursor(); }
export async function previewTrashPurge(targets: readonly TrashTarget[]) { return (await defaultRepository()).previewTrashPurge(targets); }
export async function purgeTrash(plan: TrashPurgePlan) { return (await defaultRepository()).purgeTrash(plan); }
export async function allRecords() { return (await defaultRepository()).allRecords(); }
export async function deleteEntity(type: EntityType, id: string) { return (await defaultRepository()).deleteEntity(type, id); }
export async function deleteAssetIfCurrent(expected: Asset) { return (await defaultRepository()).deleteAssetIfCurrent(expected); }
export async function restoreEntity(type: EntityType, id: string) { return (await defaultRepository()).restoreEntity(type, id); }
export async function putFile(file: File) { return (await defaultRepository()).putFile(file); }
export async function fileUrl(id: string) { return (await defaultRepository()).fileUrl(id); }
export async function cleanupUnreferencedFile(id: string) { return (await defaultRepository()).cleanupUnreferencedFile(id); }
export async function collectOrphanFiles() { return (await defaultRepository()).collectOrphanFiles(); }
export async function readPasswordVault() { return (await defaultRepository()).readPasswordVault(); }
export async function savePasswordVault(bytes: Uint8Array, expectedRevision: string | null) {
  return (await defaultRepository()).savePasswordVault(bytes, expectedRevision);
}
export async function exportArchive() { return (await defaultRepository()).exportArchive(); }
export async function restoreArchive(bytes: Uint8Array) { return (await defaultRepository()).restoreArchive(bytes); }
export async function getPendingRestoreRecoveries() { return (await defaultRepository()).getPendingRestoreRecoveries(); }
export async function retryRestoreRecovery(expected: RestoreRecoveryToken) { return (await defaultRepository()).retryRestoreRecovery(expected); }
export async function abandonRestoreRecovery(expected: RestoreRecoveryToken) { return (await defaultRepository()).abandonRestoreRecovery(expected); }
export async function previewArchiveMerge(bytes: Uint8Array) { return (await defaultRepository()).previewArchiveMerge(bytes); }
export async function applyArchiveMerge(bytes: Uint8Array, choices: Record<string, ArchiveMergeChoice>, expectedFingerprint: string) {
  return (await defaultRepository()).applyArchiveMerge(bytes, choices, expectedFingerprint);
}
export async function pendingArchiveMerge() { return (await defaultRepository()).pendingArchiveMerge(); }
export async function rollbackArchiveMerge() { return (await defaultRepository()).rollbackArchiveMerge(); }
export async function finalizeArchiveMerge() { return (await defaultRepository()).finalizeArchiveMerge(); }
export async function completeArchiveMerge() { return (await defaultRepository()).completeArchiveMerge(); }

const attachmentSchema = z.object({
  id: z.string().uuid(), name: z.string().max(255),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  size: z.number().int().nonnegative().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type AttachmentManifest = z.infer<typeof attachmentSchema>;
const manifestSchema = z.object({
  format: z.literal('keepany-backup'), version: z.literal(1),
  createdAt: z.string().datetime(), recordCount: z.number().int().nonnegative().max(100000),
  recordsHash: z.string().regex(/^[0-9a-f]{64}$/), attachments: z.array(attachmentSchema).max(10000),
  intakeReviewCount: z.number().int().nonnegative().max(100000).optional(),
  intakeReviewHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  passwordVault: z.object({ revision: z.uuid(), updatedAt: z.string().datetime(),
    size: z.number().int().min(12).max(PASSWORD_VAULT_LIMIT), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).optional(),
  sourceBinding: z.object({ endpoint: z.string(), accountId: z.string(), workspaceId: z.string(), scope: z.string() }).optional(),
});
async function sha(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function inspectArchive(bytes: Uint8Array) {
  const entries = unzipArchive(bytes);
  if (!entries['manifest.json'] || !entries['records.json']) throw Error('archive-missing');
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(entries['manifest.json'])));
  if (manifest.sourceBinding) await validateDatasetBinding(manifest.sourceBinding);
  if (await sha(entries['records.json']) !== manifest.recordsHash) throw Error('archive-hash');
  const rawRows: unknown = JSON.parse(strFromU8(entries['records.json']));
  if (!Array.isArray(rawRows) || rawRows.length !== manifest.recordCount) throw Error('archive-records');
  const rows: RecordRow[] = [];
  const ids = new Set<string>();
  for (const value of rawRows) {
    if (!value || typeof value !== 'object') throw Error('archive-records');
    const row = value as RecordRow;
    if (!Object.hasOwn(entitySchemas, row.type) || typeof row.payload !== 'string' ||
      !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('archive-records');
    const parsed = parsedPayload(row);
    if (row.id !== key(row.type, parsed.id) || ids.has(row.id)) throw Error('archive-id');
    ids.add(row.id);
    rows.push({ id: row.id, type: row.type, payload: JSON.stringify(parsed), updatedAt: row.updatedAt });
  }
  const allowed = new Set(['manifest.json', 'records.json']);
  let passwordVault: VaultRecord | null = null;
  if (manifest.passwordVault) {
    const content = entries['password-vault.kdbx'];
    if (!content || content.length !== manifest.passwordVault.size || await sha(content) !== manifest.passwordVault.sha256) throw Error('archive-hash');
    allowed.add('password-vault.kdbx');
    passwordVault = checkedPasswordVaultRecord({ id: 'local', revision: manifest.passwordVault.revision,
      updatedAt: manifest.passwordVault.updatedAt, bytes: content });
  }
  let intakeReview: ReviewedCandidate[] = [];
  if (manifest.intakeReviewCount !== undefined || manifest.intakeReviewHash !== undefined) {
    if (manifest.intakeReviewCount === undefined || !manifest.intakeReviewHash || !entries['intake-review.json']) {
      throw Error('archive-review-missing');
    }
    allowed.add('intake-review.json');
    if (await sha(entries['intake-review.json']) !== manifest.intakeReviewHash) throw Error('archive-hash');
    intakeReview = parseReviewedCandidates(JSON.parse(strFromU8(entries['intake-review.json'])));
    if (intakeReview.length !== manifest.intakeReviewCount) throw Error('archive-review-count');
    assertReviewedAssetReferences(intakeReview, assetIdsIn(rows), historyByIdIn(rows));
  }
  const attachmentIds = new Set<string>();
  for (const attachment of manifest.attachments) {
    if (attachmentIds.has(attachment.id)) throw Error('archive-id');
    attachmentIds.add(attachment.id);
    const path = `files/${attachment.id}`;
    allowed.add(path);
    const content = entries[path];
    if (!content || content.length !== attachment.size || await sha(content) !== attachment.sha256) throw Error('archive-hash');
  }
  if (Object.keys(entries).some(path => !allowed.has(path))) throw Error('archive-entry');
  validateReferences(rows, attachmentIds);
  return { rows, intakeReview, manifest, entries, passwordVault };
}

function validateReferences(rows: RecordRow[], attachmentIds: Set<string>): void {
  const assetIds = new Set(rows.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload).id as string));
  for (const row of rows) {
    const value = JSON.parse(row.payload) as Record<string, unknown>;
    if (row.type === 'asset' && (value.attachments as string[]).some(id => !attachmentIds.has(id))) throw Error('archive-attachment-reference');
    if (row.type === 'relation' && (!assetIds.has(value.from as string) || !assetIds.has(value.to as string))) throw Error('archive-relation-reference');
    if (row.type === 'task' && value.assetId && !assetIds.has(value.assetId as string)) throw Error('archive-task-reference');
    if ((row.type === 'submission' || row.type === 'history') && !assetIds.has(value.assetId as string)) {
      throw Error(`archive-${row.type}-reference`);
    }
    if (row.type === 'history' && historyReferenceIds(value as unknown as History).some(id => !assetIds.has(id))) throw Error('archive-history-reference');
  }
}

function attachmentIdsIn(rows: RecordRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'asset') continue;
    const asset = parsedPayload(row) as unknown as { attachments: string[] };
    for (const id of asset.attachments) ids.add(id);
  }
  return ids;
}
