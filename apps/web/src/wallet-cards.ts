import { assetSchema, newAsset, type Asset } from '../../../packages/domain/src';
import { localRepository, type LocalRepository } from '../../../packages/local-db/src';

export const walletTypes = ['storedValue', 'membership', 'countPass', 'gift'] as const;
export const walletSamplesId = 'wallet-samples-v1';
export function newWalletCard(): Asset {
 return { ...newAsset('project'), name: '', walletCard: { type: 'storedValue', issuer: '', lastFour: '', balanceMinor: null, remainingUses: null } };
}
export function buildWalletSamples(t: (key: string) => string, now = new Date()): Asset[] {
 const expiry = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
 const day = `${expiry.getFullYear()}-${String(expiry.getMonth()+1).padStart(2,'0')}-${String(expiry.getDate()).padStart(2,'0')}`;
 return [
  { key: 'transit', type: 'storedValue', balanceMinor: 8600, remainingUses: null, lastFour: '0826', expiry: '' },
  { key: 'gym', type: 'membership', balanceMinor: null, remainingUses: 12, lastFour: '1038', expiry: day },
  { key: 'bookstore', type: 'gift', balanceMinor: 12000, remainingUses: null, lastFour: '6208', expiry: day },
  { key: 'coffee', type: 'countPass', balanceMinor: null, remainingUses: 3, lastFour: '', expiry: '' },
 ].map(value => assetSchema.parse({ ...newWalletCard(), id: `wallet-example-v1-${value.key}`, name: `${t('samplePrefix')} | ${t(`walletSample_${value.key}`)}`, createdAt: now.toISOString(), updatedAt: now.toISOString(), dueDate: value.expiry, walletCard: { type: value.type, issuer: t(`walletIssuer_${value.key}`), lastFour: value.lastFour, balanceMinor: value.balanceMinor, remainingUses: value.remainingUses } }));
}
/** Explicit, idempotent addition. Never changes an existing card, including a deleted sample. */
export async function addWalletSamples(t: (key: string) => string, injected?: LocalRepository) {
 const run = async () => {
  const repository = injected ?? await localRepository();
  if (await repository.get('preference', walletSamplesId)) return false;
  const samples = buildWalletSamples(t);
  const rows: {type: 'asset' | 'preference'; value: unknown}[] = [];
  for (const asset of samples) if (!await repository.get('asset', asset.id)) rows.push({ type: 'asset', value: asset });
  rows.push({ type: 'preference', value: { id: walletSamplesId, value: { assetIds: samples.map(asset => asset.id) } } });
  await repository.saveBatch(rows);
  return true;
 };
 return globalThis.navigator?.locks ? navigator.locks.request(walletSamplesId, run) : run();
}
