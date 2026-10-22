import type { Asset } from "../../../packages/domain/src";

/** Present legacy supplemental fields once; preserve the original text verbatim. */
export function assetNotes(
	asset: Pick<Asset, "longDescription" | "notes">,
): string {
	const { longDescription, notes } = asset;
	if (!longDescription.trim()) return notes;
	if (!notes.trim()) return longDescription;
	if (longDescription.trim() === notes.trim()) return notes;
	return `${longDescription}\n\n${notes}`;
}

/** An unchanged editor must not rewrite legacy fields or their visibility. */
export function editAssetNotes(asset: Asset, value: string): Asset {
	if (value === assetNotes(asset)) return asset;
	// Notes are excluded from search and AI. Never copy private notes into public descriptions.
	return { ...asset, longDescription: "", notes: value };
}
