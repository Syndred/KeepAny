import {
	newAsset,
	type Asset,
	type Category,
	type ProjectDomain,
} from "../../../packages/domain/src";

export function catalogCategoryLabel(
	category: Category,
	t: (key: string) => string,
) {
	const suffix =
		category.source &&
		new RegExp(`^${category.source}( \\(\\d+\\))?$`).exec(category.name);
	return suffix
		? t(category.source === "domains" ? "workspaceDomains" : "project") +
				(suffix[1] ?? "")
		: category.name;
}
export function catalogCategories(
	categories: readonly Category[],
	order: unknown = [],
) {
	const ids = Array.isArray(order)
		? order.filter((id): id is string => typeof id === "string")
		: [];
	const rank = (category: Category) =>
		ids.includes(category.id)
			? ids.indexOf(category.id)
			: ids.length + category.order;
	return categories
		.filter(
			(category) =>
				(category.scope === "catalog" ||
					(category.kind === "project" && !category.scope)) &&
				!category.deleted,
		)
		.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}
export type CatalogRecord = {
	id: string;
	asset: Asset;
	owner: Asset;
	domain?: ProjectDomain;
	categoryId: string;
};
export function catalogRecords(
	assets: readonly Asset[],
	categories: readonly Category[],
): CatalogRecord[] {
	const groups = catalogCategories(categories);
	const resolve = (id: string | undefined, source: "project" | "domains") => {
		const value =
			id ?? groups.find((category) => category.source === source)?.id;
		return groups.some((category) => category.id === value) ? value! : "";
	};
	return assets
		.filter((asset) => asset.kind === "project" && !asset.deleted)
		.flatMap((owner) => [
			{
				id: `asset:${owner.id}`,
				asset: owner,
				owner,
				categoryId: resolve(
					owner.catalogCategoryId ??
						categories.find(
							(category) =>
								category.kind === "project" &&
								(category.scope === "catalog"
									? category.legacyName
									: category.name) === owner.category,
						)?.id,
					"project",
				),
			},
			...owner.projectDomains
				.filter((domain) => !domain.catalog?.deleted)
				.map((domain) => ({
					id: `domain:${owner.id}:${domain.id}`,
					owner,
					domain,
					categoryId: resolve(domain.catalog?.categoryId, "domains"),
					asset: {
						...owner,
						id: domain.id,
						name: domain.catalog?.name ?? domain.name,
						url: domain.catalog?.url ?? `https://${domain.name}`,
						tags: domain.catalog?.tags ?? [],
						status: domain.catalog?.status ?? owner.status,
						dueDate: domain.expiryDate,
						notes: domain.catalog?.notes ?? "",
						longDescription: "",
						description: "",
						attachments: domain.catalog?.attachments ?? [],
						projectDomains: [],
						projectMedia: {
							logoId: "",
							homeScreenshotId: "",
							productScreenshotIds: [],
							promoCoverId: "",
						},
					},
				})),
		]);
}
export function newCatalogAsset(categoryId: string) {
	return {
		...newAsset("project"),
		name: "",
		category: "",
		catalogCategoryId: categoryId,
	};
}
export function applyCatalogEdit(
	record: CatalogRecord,
	draft: Asset,
	categoryId: string,
): Asset {
	if (!record.domain)
		return { ...draft, id: record.owner.id, catalogCategoryId: categoryId };
	return {
		...record.owner,
		updatedAt: draft.updatedAt,
		attachments: [
			...new Set([...record.owner.attachments, ...draft.attachments]),
		],
		projectDomains: record.owner.projectDomains.map((domain) =>
			domain.id !== record.domain!.id
				? domain
				: {
						...domain,
						expiryDate: draft.dueDate,
						catalog: {
							categoryId,
							name: draft.name,
							url: draft.url,
							tags: draft.tags,
							status: draft.status === "loaned" ? "active" : draft.status,
							notes: draft.notes,
							attachments: draft.attachments,
							deleted: false,
						},
					},
		),
	};
}
