import { normalizeCategoryName } from "../../../packages/domain/src";

export const COLLECTIONS_PREFERENCE_ID = "assetCollectionsV1";
export type AssetCollection = { id: string; name: string; assetIds: string[]; deleted?: true; deletedAt?: string };

// Invalid preference entries are ignored so imported or older data cannot break navigation.
export function readCollections(value: unknown, includeDeleted = false): AssetCollection[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	const names = new Set<string>();
	const result: AssetCollection[] = [];
	let liveCount = 0;
	for (const candidate of value) {
		if (!candidate || typeof candidate !== "object") continue;
		const item = candidate as Record<string, unknown>;
		if (typeof item.id !== "string" || !item.id || item.id.length > 96 ||
			typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 20 ||
			!Array.isArray(item.assetIds)) continue;
		const deleted = item.deleted === true;
		if (deleted && !includeDeleted) continue;
		const normalizedName = normalizeCategoryName(item.name);
		if (ids.has(item.id) || !deleted && (names.has(normalizedName) || liveCount >= 8)) continue;
		ids.add(item.id);
		if (!deleted) { names.add(normalizedName); liveCount++; }
		result.push({
			id: item.id,
			name: item.name.trim(),
			assetIds: [...new Set(item.assetIds.filter((id): id is string => typeof id === "string" && !!id && id.length <= 96))],
			...(deleted ? { deleted: true, ...(typeof item.deletedAt === "string" ? { deletedAt: item.deletedAt } : {}) } : {}),
		});
	}
	return result;
}
