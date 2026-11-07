import { assetSchema, type Asset } from '../../../packages/domain/src';
import { localRepository } from '../../../packages/local-db/src';
import type { VaultSession } from '../../../packages/password-vault/src';

type AccountDeleteRepository = Pick<Awaited<ReturnType<typeof localRepository>>, 'get' | 'list' | 'trashEmptyAccountIfCurrent'>;
export type AccountCardDeleteTarget = Readonly<
 { kind: 'ordinary'; asset: Asset; contentRevision: string } |
 { kind: 'private'; entryId: string; contentRevision: string }
>;
export type AccountCardDeleteProgress = { targetKey?: string; vaultDone?: boolean; vaultRevision?: string; vaultContentRevision?: string; publicDone?: boolean };
type AccountCardDeleteInput = { asset?: Asset; entryId?: string };

function targetId(target: AccountCardDeleteTarget): string {
 return target.kind === 'ordinary' ? `asset:${target.asset.id}` : `entry:${target.entryId}`;
}

function assertCurrentAsset(current: Asset | null | undefined, expected: Asset) {
 if (!current || JSON.stringify(assetSchema.parse(current)) !== JSON.stringify(assetSchema.parse(expected))) throw Error('asset-stale');
}

/** Freeze only the reviewed card and encrypted revision; never put passwords into UI state. */
export function prepareAccountCardDelete(session: VaultSession, input: AccountCardDeleteInput): AccountCardDeleteTarget {
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
 const key = `${targetId(target)}:${target.contentRevision}`;
 if (progress.targetKey && progress.targetKey !== key) throw Error('asset-stale');
 progress.targetKey = key;
 const repo = repository ?? await localRepository();
 if (!progress.vaultDone) {
  const accounts = (await repo.list<Asset>('asset')).filter(asset => asset.kind === 'account' && !asset.deleted && !asset.purged);
  if (target.kind === 'ordinary') {
   assertCurrentAsset(accounts.find(asset => asset.id === target.asset.id), target.asset);
   progress.vaultContentRevision = await session.trashAccountEntries(target.asset.id, target.contentRevision, accounts.map(asset => asset.id));
  } else {
   const entry = session.getSnapshot().entries.find(value => value.id === target.entryId);
   const liveAccountIds = new Set(accounts.map(asset => asset.id));
   if (!entry || entry.isAiKey || entry.linkedAssetIds.some(id => liveAccountIds.has(id))) throw Error('vault-stale');
   progress.vaultContentRevision = await session.trashEntryIfCurrent(target.entryId, target.contentRevision);
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

export type AccountCardBatchDeleteTarget = Readonly<{ targets: readonly AccountCardDeleteTarget[]; contentRevision: string }>;
export type AccountCardBatchDeleteProgress = {
 completed?: number;
 partial?: boolean;
 target?: AccountCardBatchDeleteTarget;
 contentRevision?: string;
 current?: AccountCardDeleteProgress;
 running?: boolean;
};

/** Prepare only the explicitly selected account records, including private-only entries. */
export function prepareAccountCardBatchDelete(session: VaultSession, inputs: readonly AccountCardDeleteInput[]): AccountCardBatchDeleteTarget {
 const targets = inputs.map(input => prepareAccountCardDelete(session, input));
 if (!targets.length || new Set(targets.map(targetId)).size !== targets.length) throw Error('asset-stale');
 return Object.freeze({ targets: Object.freeze(targets), contentRevision: targets[0].contentRevision });
}

function assertVaultContent(session: VaultSession, contentRevision: string) {
 const snapshot = session.getSnapshot();
 if (snapshot.status !== 'unlocked') throw Error('vault-locked');
 if (snapshot.contentRevision !== contentRevision) throw Error('vault-stale');
 return snapshot;
}

/** Advance only across our own encrypted writes. Resume the unfinished item first on retry. */
export async function recycleAccountCardBatch(
 session: VaultSession,
 target: AccountCardBatchDeleteTarget,
 progress: AccountCardBatchDeleteProgress,
 repository?: AccountDeleteRepository,
 onProgress?: (completed: number) => void,
): Promise<void> {
 if (progress.target && progress.target !== target) throw Error('asset-stale');
 if (progress.running) throw Error('account-delete-busy');
 progress.target = target;
 if (progress.completed === target.targets.length) return;
 progress.running = true;
 try {
  let contentRevision = progress.contentRevision ?? target.contentRevision;
  const repo = repository ?? await localRepository();
  if (!progress.completed && !progress.current?.vaultDone) {
   // Catch already stale cards before moving anything, while still checking
   // each item again against current storage just before it is written.
   const accounts = new Map((await repo.list<Asset>('asset')).filter(asset => asset.kind === 'account').map(asset => [asset.id, asset]));
   const snapshot = assertVaultContent(session, contentRevision);
   const protectedAccountIds = new Set(snapshot.entries.filter(entry => entry.isAiKey).flatMap(entry => entry.linkedAssetIds));
   const entries = new Map(snapshot.entries.map(entry => [entry.id, entry]));
   for (const item of target.targets) {
    if (item.kind === 'ordinary') {
     assertCurrentAsset(accounts.get(item.asset.id), item.asset);
     if (protectedAccountIds.has(item.asset.id)) throw Error('vault-invalid');
    } else {
     const entry = entries.get(item.entryId);
     if (!entry || entry.isAiKey || entry.linkedAssetIds.some(id => accounts.has(id))) throw Error('vault-stale');
    }
   }
  }
  for (let index = progress.completed ?? 0; index < target.targets.length; index++) {
   const current = progress.current ??= {};
   assertVaultContent(session, current.vaultContentRevision ?? contentRevision);
   await recycleAccountCard(session, { ...target.targets[index], contentRevision }, current, repo);
   contentRevision = current.vaultContentRevision ?? contentRevision;
   progress.contentRevision = contentRevision;
   progress.completed = index + 1;
   progress.current = undefined;
   progress.partial = false;
   onProgress?.(progress.completed);
  }
 } finally {
  progress.partial = Boolean(progress.current?.vaultDone && !progress.current.publicDone);
  progress.running = false;
 }
}
