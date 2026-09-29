import { normalizeCategoryName } from "../../../packages/domain/src";

export const COLLECTIONS_PREFERENCE_ID = "assetCollectionsV1";
export type AssetCollection = { id: string; name: string; assetIds: string[] };

// Invalid preference entries are ignored so imported or older data cannot break navigation.
export function readCollections(value: unknown): AssetCollection[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	const names = new Set<string>();
	const result: AssetCollection[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== "object") continue;
		const item = candidate as Record<string, unknown>;
		if (typeof item.id !== "string" || !item.id || item.id.length > 96 ||
			typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 20 ||
			!Array.isArray(item.assetIds)) continue;
		const normalizedName = normalizeCategoryName(item.name);
		if (ids.has(item.id) || names.has(normalizedName)) continue;
		ids.add(item.id);
		names.add(normalizedName);
		result.push({
			id: item.id,
			name: item.name.trim(),
			assetIds: [...new Set(item.assetIds.filter((id): id is string => typeof id === "string" && !!id && id.length <= 96))],
		});
		if (result.length === 8) break;
	}
	return result;
}
