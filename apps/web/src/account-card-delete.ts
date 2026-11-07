import { assetSchema, type Asset } from '../../../packages/domain/src';
import { localRepository } from '../../../packages/local-db/src';
import type { VaultSession } from '../../../packages/password-vault/src';

type AccountDeleteRepository = Pick<Awaited<ReturnType<typeof localRepository>>, 'get' | 'list' | 'trashEmptyAccountIfCurrent'>;
export type AccountCardDeleteTarget = Readonly<
 { kind: 'ordinary'; asset: Asset; contentRevision: string } |
 { kind: 'private'; entryId: string; contentRevision: string }
>;
export type AccountCardDeleteProgress = { targetKey?: string; vaultDone?: boolean; vaultRevision?: string; publicDone?: boolean };

/** Freeze only the reviewed card and encrypted revision; never put passwords into UI state. */
export function prepareAccountCardDelete(session: VaultSession, input: { asset?: Asset; entryId?: string }): AccountCardDeleteTarget {
 const snapshot = session.getSnapshot();
 if (snapshot.status !== 'unlocked' || !snapshot.contentRevision) throw Error('vault-locked');
 if (input.asset) {
  if (input.asset.kind !== 'account' || input.asset.deleted || input.asset.purged) throw Error('asset-stale');
  return Object.freeze({ kind: 'ordinary', asset: structuredClone(input.asset), contentRevision: snapshot.contentRevision });
 }
 const entry = snapshot.entries.find(value => value.id === input.entryId);
 if (!entry || entry.isAiKey) throw Error('vault-stale');
 return Object.freeze({ kind: 'private', entryId: entry.id, contentRevision: snapshot.contentRevision });
}

/** Keep progress for the same confirmation so a failed public write can retry without re-trashing secrets. */
export async function recycleAccountCard(session: VaultSession, target: AccountCardDeleteTarget, progress: AccountCardDeleteProgress, repository?: AccountDeleteRepository): Promise<void> {
 if (session.getSnapshot().status !== 'unlocked') throw Error('vault-locked');
 const key = `${target.kind === 'ordinary' ? `asset:${target.asset.id}` : `entry:${target.entryId}`}:${target.contentRevision}`;
 if (progress.targetKey && progress.targetKey !== key) throw Error('asset-stale');
 progress.targetKey = key;
 const repo = repository ?? await localRepository();
 if (!progress.vaultDone) {
  if (target.kind === 'ordinary') {
   const current = await repo.get<Asset>('asset', target.asset.id);
   if (!current || JSON.stringify(assetSchema.parse(current)) !== JSON.stringify(assetSchema.parse(target.asset))) throw Error('asset-stale');
  }
  if (target.kind === 'ordinary') {
   const liveAccountIds = (await repo.list<Asset>('asset')).filter(asset => asset.kind === 'account' && !asset.deleted && !asset.purged).map(asset => asset.id);
   await session.trashAccountEntries(target.asset.id, target.contentRevision, liveAccountIds);
  }
  else {
   const entry = session.getSnapshot().entries.find(value => value.id === target.entryId);
   const liveAccountIds = new Set((await repo.list<Asset>('asset')).filter(asset => asset.kind === 'account' && !asset.deleted && !asset.purged).map(asset => asset.id));
   if (!entry || entry.isAiKey || entry.linkedAssetIds.some(id => liveAccountIds.has(id))) throw Error('vault-stale');
   await session.trashEntryIfCurrent(target.entryId, target.contentRevision);
  }
  progress.vaultDone = true;
  progress.vaultRevision = session.getSnapshot().revision ?? undefined;
 }
 if (target.kind === 'private' || progress.publicDone) return;
 const snapshot = session.getSnapshot();
 if (snapshot.status !== 'unlocked' || !snapshot.revision || snapshot.entries.some(entry => entry.linkedAssetIds.includes(target.asset.id))) throw Error('vault-stale');
 const current = await repo.get<Asset>('asset', target.asset.id);
 // A lost acknowledgement of our tombstone is safe to finish idempotently.
 if (current?.deleted) {
  if (JSON.stringify(assetSchema.parse({ ...current, deleted: target.asset.deleted, updatedAt: target.asset.updatedAt })) !== JSON.stringify(assetSchema.parse(target.asset))) throw Error('asset-stale');
 } else {
  await repo.trashEmptyAccountIfCurrent(target.asset, snapshot.revision);
 }
 progress.vaultRevision = snapshot.revision;
 progress.publicDone = true;
}
