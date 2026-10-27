import type { Asset, AssetKind } from '../../../packages/domain/src';

type Target = Pick<Asset, 'id' | 'name' | 'kind' | 'username' | 'url'>;

function publicHost(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname : '';
  } catch { return ''; }
}

/** Only ordinary visible identity fields; never notes, descriptions or KDBX data. */
export function relationTargetLabels<T extends Target>(assets: readonly T[], kindLabel: (kind: AssetKind) => string): Array<{ asset: T; label: string }> {
  const names = new Map<string, number>();
  for (const asset of assets) names.set(asset.name, (names.get(asset.name) ?? 0) + 1);
  const entries = assets.map(asset => {
    if ((names.get(asset.name) ?? 0) < 2) return { asset, label: asset.name };
    const identity = asset.kind === 'account' ? asset.username.trim() : publicHost(asset.url);
    const label = [...new Set([asset.name, identity, kindLabel(asset.kind)].filter(Boolean))].join(' · ');
    return { asset, label };
  });
  const counts = new Map<string, number>(), prefixes = new Map<string, number>();
  for (const { asset, label } of entries) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
    const key = `${label}\0${asset.id.slice(0, 8)}`;
    prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
  }
  return entries.map(({ asset, label }) => {
    if ((counts.get(label) ?? 0) < 2) return { asset, label };
    const prefix = asset.id.slice(0, 8), key = `${label}\0${prefix}`;
    return { asset, label: `${label} · #${(prefixes.get(key) ?? 0) > 1 ? asset.id : prefix}` };
  });
}
