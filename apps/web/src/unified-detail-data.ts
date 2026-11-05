import { effectiveFinanceEntry, historyAssetIds, type Asset, type History } from "../../../packages/domain/src";

/** Renewal history on its original subscription is immutable; bill corrections belong to the ledger projection. */
export function detailHistoryRows(history: readonly History[], assetId: string): History[] {
 return history.filter(row => !row.deleted).flatMap(row => {
  if (row.action === "renew" && row.assetId === assetId) return [row];
  const effective = effectiveFinanceEntry(row);
  return !effective.deleted && historyAssetIds(effective).includes(assetId) ? [effective] : [];
 }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Retain role references when gallery images are replaced, and clear them only for explicit removals. */
export function withDetailImages(asset: Asset, ids: string[], replace = "", replacement = ""): Asset {
 const next = (id: string) => replace && id === replace ? replacement : ids.includes(id) ? id : "";
 return { ...asset, attachments: ids, projectMedia: { ...asset.projectMedia,
  logoId: next(asset.projectMedia.logoId), homeScreenshotId: next(asset.projectMedia.homeScreenshotId), promoCoverId: next(asset.projectMedia.promoCoverId),
  productScreenshotIds: asset.projectMedia.productScreenshotIds.map(next).filter(Boolean),
 } };
}
