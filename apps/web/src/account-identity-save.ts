import { assetSchema, type Asset } from "../../../packages/domain/src";
import {
	type LocalRepository,
	localRepository,
} from "../../../packages/local-db/src";
import type { Relation } from "../../../packages/domain/src";
import { publishedLoginIdentifier } from "./account-identities";
import {
	accountLinkRelationChanges,
	buildAccountLinkRows,
	buildAccountLinkSavePlan,
	existingAccountLinkRows,
	normalizeLoginIdentifier,
	reviewableAccountLinkSuggestions,
	type AccountLinkLabel,
} from "./vault-account-links";

export class AccountIdentitySavePending extends Error {
	constructor(readonly savedAccount: Asset) {
		super("account-relations-pending");
	}
}

/** Reuse the reviewed identity plan for ordinary account saves, without opening KDBX. */
export async function saveAccountWithIdentityLinks(
	expected: Asset | null,
	proposed: Asset,
	label: AccountLinkLabel,
	repository?: LocalRepository,
): Promise<Asset> {
	const repo = repository ?? (await localRepository()),
		next = assetSchema.parse(proposed);
	if (
		next.kind !== "account" ||
		next.deleted ||
		next.purged ||
		(expected && (expected.id !== next.id || expected.kind !== "account"))
	)
		throw Error("asset-stale");
	const assets = await repo.list<Asset>("asset", true),
		relations = await repo.list<Relation>("relation", true);
	const current = assets.find((asset) => asset.id === next.id);
	if (
		expected
			? !current ||
				JSON.stringify(assetSchema.parse(current)) !==
					JSON.stringify(assetSchema.parse(expected))
			: !!current
	)
		throw Error("asset-stale");
	const virtual = [...assets.filter((asset) => asset.id !== next.id), next];
	const username =
		next.username.trim() ||
		(["email", "phone"].includes(next.category) ? next.name : "");
	const [row] = await buildAccountLinkRows(
		[
			{
				id: next.id,
				title: next.name,
				username,
				usernameAliases: [],
				linkedAssetIds: [next.id],
				url: next.url,
				modifiedAt: next.updatedAt,
				historyCount: 0,
			},
		],
		virtual,
		new Map(),
		relations,
	);
	row.account = next;
	row.originalAccount = expected;
	row.isNew = !expected;
	row.suggestedCategory = next.category;
	// Extra identifiers already published from KDBX remain intact when editing ordinary fields.
	const previous = normalizeLoginIdentifier(expected?.username ?? ""),
		primary = normalizeLoginIdentifier(next.username);
	const primaryChanged = !!expected && previous !== primary;
	const retained = relations
		.filter((line) => line.from === next.id)
		.map((line) => publishedLoginIdentifier(line, assets))
		.filter((key) => key && (key !== previous || previous === primary));
	row.identifiers = [...new Set([...row.identifiers, ...retained])];
	// Creating an identity joins its existing services; an ordinary service reuses identities already present.
	row.identityAccounts = row.identityAccounts.filter(
		(identity) =>
			!identity.isNew ||
			((next.category === identity.kind ||
				row.suggestedCategory === identity.kind) &&
				normalizeLoginIdentifier(next.username || next.name) ===
					`${identity.kind}:${identity.identifier}`),
	);
	const rows = [row, ...existingAccountLinkRows([row], assets, [], relations)];
	const offered = await reviewableAccountLinkSuggestions(
		rows.map((item) => ({
			...item,
			contextOnly: item.contextOnly || !primaryChanged,
		})),
		relations,
	);
	const changes = await accountLinkRelationChanges(offered, relations, label);
	const deleted = new Set(
		changes.deletedRelations.map((item) => item.suggestion),
	);
	const restored = changes.deletedRelations.filter(
		({ suggestion }) =>
			primaryChanged &&
			suggestion.from === next.id &&
			`${suggestion.identifierKind}:${suggestion.evidence}` === primary,
	);
	const restoreChoices = new Set(restored.map((item) => item.suggestion));
	const chosen = offered.filter(
		(suggestion) => !deleted.has(suggestion) || restoreChoices.has(suggestion),
	);
	const plan = await buildAccountLinkSavePlan(
		rows,
		chosen,
		assets,
		relations,
		label,
		restored.map((item) => item.relation),
	);
	const items = [
		...plan.newAssets.map((value) => ({ type: "asset" as const, value })),
		...plan.newRelations.map((value) => ({ type: "relation" as const, value })),
	];
	if (items.length > 1000) throw Error("account-link-batch-limit");
	let persisted: Asset | undefined;
	try {
		for (const update of plan.accountUpdates) {
			await repo.saveAssetIfCurrent(update.expected, update.next);
			persisted = update.next;
		}
		if (items.length) {
			await repo.saveBatchIfAssetsCurrent(items, plan.expectedAssets);
			persisted =
				plan.newAssets.find((asset) => asset.id === next.id) ??
				persisted ??
				current;
		}
		for (const update of plan.replacedRelations) {
			await repo.saveRelationIfCurrent(update.expected, update.next);
			persisted ??= current;
		}
		for (const relation of plan.restoredRelations) {
			await repo.restoreRelationIfCurrent(relation);
			persisted ??= current;
		}
		return (await repo.get<Asset>("asset", next.id)) ?? next;
	} catch (error) {
		if (persisted) throw new AccountIdentitySavePending(persisted);
		throw error;
	}
}
