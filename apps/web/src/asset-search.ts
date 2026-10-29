import type { Asset } from "../../../packages/domain/src";

const additionalPublicTextFields = [
	"location",
	"category",
	"description",
	"contact",
	"borrower",
	"accountProvider",
	"subscriptionPaymentMethod",
	"longDescription",
] as const satisfies readonly (keyof Asset)[];

/** Search displayable asset text, excluding private notes, IDs and operation markers. */
export function matchesAssetSearch(asset: Asset, query: string): boolean {
	if (asset.deleted || asset.kind === "vault") return false;
	const term = query.trim().toLocaleLowerCase();
	if (!term) return true;
	const text = [
		asset.name,
		asset.tags.join(" "),
		asset.url,
		asset.username,
		...additionalPublicTextFields.map((field) => field === "longDescription" && asset.kind === "project" ? "" : asset[field]),
		...(asset.projectDomains ?? []).flatMap((domain) => [
			domain.name,
			domain.registrar,
		]),
	].join(" ");
	return text.toLocaleLowerCase().includes(term);
}
