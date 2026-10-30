import type { Asset, ProjectDomain } from "../../../packages/domain/src";
export type CatalogScope = "managed" | "all" | "archived";
export type CatalogSort = "updated" | "due";
export type CatalogRow = { type: "asset"; asset: Asset } | { type: "domain"; project: Asset; domain: ProjectDomain; remainingDays: number | null };
export function sortCatalogRows(rows: CatalogRow[], sort: CatalogSort): CatalogRow[] {
  const owner = (row: CatalogRow) => row.type === "asset" ? row.asset : row.project;
  const name = (row: CatalogRow) => row.type === "asset" ? row.asset.name : row.domain.name;
  const due = (row: CatalogRow) => row.type === "domain" ? row.domain.expiryDate || "9999" : row.asset.dueDate || row.asset.warrantyDate || "9999";
  return [...rows].sort((a, b) => (sort === "due" ? due(a).localeCompare(due(b)) : owner(b).updatedAt.localeCompare(owner(a).updatedAt)) || name(a).localeCompare(name(b)));
}
export function isManagedAsset(asset: Asset) {
  return !["archived", "cancelled", "paused"].includes(asset.status);
}
export function catalogAssets(assets: Asset[], scope: CatalogScope, sort: CatalogSort) {
  return assets.filter(asset => !asset.deleted && (scope === "all" || isManagedAsset(asset) === (scope === "managed")))
    .sort((a, b) => (sort === "due" ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999") : b.updatedAt.localeCompare(a.updatedAt)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
