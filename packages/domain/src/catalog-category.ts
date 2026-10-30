import { normalizeCategoryName } from "./index";

// Both supported UI languages reserve the four fixed pages and unclassified view.
export const catalogReservedNames = [
	"all",
	"全部",
	"items",
	"item",
	"实物",
	"subscriptions",
	"subscription",
	"订阅",
	"ledger",
	"费用账本",
	"账本",
	"unclassified",
	"未分类",
];
export function assertCatalogCategoryName(name: string) {
	const normalized = normalizeCategoryName(name);
	if (!normalized || name.trim().length > 60) throw Error("category-name");
	if (
		catalogReservedNames.some(
			(value) => normalizeCategoryName(value) === normalized,
		)
	)
		throw Error("category-reserved");
}
