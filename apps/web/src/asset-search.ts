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
	"projectTitle",
	"projectPromoUrl",
	"projectMediumDescription",
	"projectFeatures",
	"projectPricing",
	"projectPricingType",
	"projectEmail",
] as const satisfies readonly (keyof Asset)[];

/** Search displayable asset text, excluding private notes, IDs and operation markers. */
export function matchesAssetSearch(asset: Asset, query: string): boolean {
	if (asset.deleted) return false;
	const term = query.trim().toLocaleLowerCase();
	if (!term) return true;
	const text = [
		asset.name,
		asset.tags.join(" "),
		asset.url,
		asset.username,
		...additionalPublicTextFields.map((field) => asset[field]),
		...(asset.projectDomains ?? []).flatMap((domain) => [
			domain.name,
			domain.registrar,
		]),
	].join(" ");
	return text.toLocaleLowerCase().includes(term);
}
