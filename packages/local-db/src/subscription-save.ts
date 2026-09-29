import Dexie, { type Table } from 'dexie';
import type { RxDatabase } from 'rxdb';
import { entitySchemas, type Asset, type Relation } from '../../domain/src';
import type { RecordRow } from './index';

export interface SubscriptionSaveJournal {
  id: string;
  assetId: string;
  expectedMarker: string;
  next: RecordRow;
  relations: Array<{ row: RecordRow; targetKind: 'project' | 'account' }>;
}

export interface SubscriptionSaveStore {
  subscriptionSaveJournal: Table<SubscriptionSaveJournal, string>;
  transaction: Dexie['transaction'];
}

export interface SubscriptionLink {
  id: string;
  kind: 'project' | 'account';
  label: string;
}

export interface PendingSubscriptionSave {
  operationId: string;
  assetId: string;
  assetSaved: boolean;
  relationCount: number;
}

async function storedAsset(db: RxDatabase, id: string): Promise<Asset | null> {
  const [row] = await db.records.storageInstance.findDocumentsById([`asset:${id}`], false);
  return row ? entitySchemas.asset.parse(JSON.parse((row as RecordRow).payload)) : null;
}

async function checkEndpoint(db: RxDatabase, journal: SubscriptionSaveJournal,
  relation: Relation, kind: 'project' | 'account'): Promise<void> {
  const [subscription, target] = await Promise.all([
    storedAsset(db, journal.assetId), storedAsset(db, relation.to),
  ]);
  if (!subscription || subscription.deleted || subscription.kind !== 'subscription' ||
    subscription.lastSubscriptionSaveId !== journal.id || !target || target.deleted || target.kind !== kind) {
    throw Error('subscription-relation-unavailable');
  }
}

// The marker is committed with the asset. Replay adds only the promised relations;
// a later rename, schedule edit or renewal is never overwritten by the old journal.
export async function replaySubscriptionSave(db: RxDatabase, store: SubscriptionSaveStore,
  id: string): Promise<'committed' | 'cancelled'> {
  // IndexedDB serializes this table across tabs even when Web Locks are absent.
  // The durable intent predates the transaction, so a crash still leaves it intact.
  return store.transaction('rw', store.subscriptionSaveJournal, async () => {
    const journal = await store.subscriptionSaveJournal.get(id);
    if (!journal) return 'cancelled';
    const outcome = await Dexie.waitFor(Dexie.ignoreTransaction(() => replaySubscriptionSaveUnlocked(db, journal)));
    await store.subscriptionSaveJournal.delete(id);
    return outcome;
  });
}

async function replaySubscriptionSaveUnlocked(db: RxDatabase,
  journal: SubscriptionSaveJournal): Promise<'committed' | 'cancelled'> {
  const id = journal.id;
  const asset = await storedAsset(db, journal.assetId);
  if (asset?.lastSubscriptionSaveId !== id) {
    if ((asset?.lastSubscriptionSaveId ?? '') !== journal.expectedMarker) {
      throw Error('subscription-recovery-conflict');
    }
    // No relation is written before the asset CAS. An interrupted, uncommitted
    // intent can be cancelled without changing the newer local asset.
    return 'cancelled';
  }
  for (const planned of journal.relations) {
    const relation = entitySchemas.relation.parse(JSON.parse(planned.row.payload));
    if (relation.deleted || relation.from !== journal.assetId || relation.from === relation.to ||
      planned.row.id !== `relation:${relation.id}`) throw Error('subscription-recovery-conflict');
    await checkEndpoint(db, journal, relation, planned.targetKind);
    const [own] = await db.records.storageInstance.findDocumentsById([planned.row.id], false);
    if (own) {
      const current = entitySchemas.relation.parse(JSON.parse((own as RecordRow).payload));
      // A user may have edited or removed a relation after partial submission.
      // Keep those choices; deleted records must be restored explicitly.
      if (current.deleted || current.from !== relation.from || current.to !== relation.to) {
        throw Error('subscription-relation-unavailable');
      }
      continue;
    }
    const documents = await db.records.find({ selector: { type: 'relation' } }).exec();
    const connected = documents.some(doc => {
      const current = entitySchemas.relation.parse(JSON.parse((doc.toJSON() as RecordRow).payload));
      return !current.deleted && ((current.from === relation.from && current.to === relation.to) ||
        (current.from === relation.to && current.to === relation.from));
    });
    if (connected) continue;
    try { await db.records.insert(planned.row); }
    catch (error) {
      const [raced] = await db.records.storageInstance.findDocumentsById([planned.row.id], false);
      if (!raced) throw error;
      const current = entitySchemas.relation.parse(JSON.parse((raced as RecordRow).payload));
      if (current.deleted || current.from !== relation.from || current.to !== relation.to) {
        throw Error('subscription-relation-unavailable');
      }
    }
    await checkEndpoint(db, journal, relation, planned.targetKind);
  }
  return 'committed';
}

export async function pendingSubscriptionSave(db: RxDatabase, store: SubscriptionSaveStore,
  assetId: string): Promise<PendingSubscriptionSave | null> {
  const journal = await store.subscriptionSaveJournal.where('assetId').equals(assetId).first();
  if (!journal) return null;
  const asset = await storedAsset(db, assetId);
  return { operationId: journal.id, assetId, assetSaved: asset?.lastSubscriptionSaveId === journal.id,
    relationCount: journal.relations.length };
}

// Another tab may finish and remove the same journal while this caller waits.
// Recognize that outcome through durable records without recreating an abandoned intent.
export async function subscriptionSaveComplete(db: RxDatabase, journal: SubscriptionSaveJournal): Promise<boolean> {
  const asset = await storedAsset(db, journal.assetId);
  if (!asset || asset.deleted || asset.lastSubscriptionSaveId !== journal.id) return false;
  const documents = await db.records.find({ selector: { type: 'relation' } }).exec();
  const relations = documents.map(doc => entitySchemas.relation.parse(JSON.parse((doc.toJSON() as RecordRow).payload)));
  for (const planned of journal.relations) {
    const relation = entitySchemas.relation.parse(JSON.parse(planned.row.payload));
    try { await checkEndpoint(db, journal, relation, planned.targetKind); }
    catch { return false; }
    const own = relations.find(current => current.id === relation.id);
    if (own?.deleted || (own && (own.from !== relation.from || own.to !== relation.to))) return false;
    if (!relations.some(current => !current.deleted && ((current.from === relation.from && current.to === relation.to) ||
      (current.from === relation.to && current.to === relation.from)))) return false;
  }
  return true;
}
