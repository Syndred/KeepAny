import { calendarDayDistance, monthlyMinorUnits, type Asset, type History, type Relation, type Task } from "../../../packages/domain/src";
import type { VaultEntrySummary } from "../../../packages/password-vault/src";

export type MoneyTotals = Map<string, bigint>;
export type AssetSummary = {
	ownedDays: number | null;
	remainingDays: number | null;
	tasks: { done: number; total: number };
	spending: MoneyTotals;
	monthly: MoneyTotals;
	annual: MoneyTotals;
};

export function daysBetween(from: string, to: string): number | null {
	if (!from || !to) return null;
	try { return calendarDayDistance(from, to); } catch { return null; }
}

function add(totals: MoneyTotals, currency: string, amount: bigint) {
	totals.set(currency, (totals.get(currency) ?? 0n) + amount);
}

export function buildWorkspaceSummary(input: {
	assets: readonly Asset[]; tasks: readonly Task[]; history: readonly History[];
	relations: readonly Relation[]; today: string;
}) {
	const assets = input.assets.filter((asset) => !asset.deleted && !asset.purged);
	const byId = new Map(assets.map((asset) => [asset.id, asset]));
	const spendingByAsset = new Map<string, MoneyTotals>();
	const spending: MoneyTotals = new Map();
	const purchases: MoneyTotals = new Map();
	const monthly: MoneyTotals = new Map();
	const seenHistory = new Set<string>();
	for (const entry of input.history) {
		const asset = byId.get(entry.assetId);
		if (!asset || asset.kind === "vault" || entry.deleted || seenHistory.has(entry.id) ||
			(entry.action !== "expense" && entry.action !== "renew") ||
			entry.amount === undefined || !Number.isSafeInteger(entry.amount) || entry.amount < 0 || !entry.currency) continue;
		seenHistory.add(entry.id);
		const totals = spendingByAsset.get(entry.assetId) ?? new Map<string, bigint>();
		add(totals, entry.currency, BigInt(entry.amount));
		spendingByAsset.set(entry.assetId, totals);
		add(spending, entry.currency, BigInt(entry.amount));
	}
	const tasksByAsset = new Map<string, { done: number; total: number }>();
	for (const task of input.tasks) {
		if (task.deleted || task.impactSnapshot || !task.assetId) continue;
		const counts = tasksByAsset.get(task.assetId) ?? { done: 0, total: 0 };
		counts.total += 1;
		if (task.done) counts.done += 1;
		tasksByAsset.set(task.assetId, counts);
	}
	const subscriptionsByProject = new Map<string, Set<string>>();
	for (const relation of input.relations) {
		if (relation.deleted) continue;
		const from = byId.get(relation.from), to = byId.get(relation.to);
		const project = from?.kind === "project" ? from : to?.kind === "project" ? to : null;
		const subscription = from?.kind === "subscription" ? from : to?.kind === "subscription" ? to : null;
		if (!project || !subscription) continue;
		const linked = subscriptionsByProject.get(project.id) ?? new Set<string>();
		linked.add(subscription.id);
		subscriptionsByProject.set(project.id, linked);
	}
	let upcoming = 0;
	const domains = assets.filter((asset) => asset.kind === "project")
		.flatMap((project) => (project.projectDomains ?? []).map((domain) => ({ project, domain, remainingDays: daysBetween(input.today, domain.expiryDate) })));
	for (const row of domains) if (row.remainingDays !== null && row.remainingDays >= 0 && row.remainingDays <= 30) upcoming += 1;
	const summaries = new Map<string, AssetSummary>();
	for (const asset of assets) {
		const remainingDays = daysBetween(input.today, asset.dueDate);
		const ownedDays = daysBetween(asset.purchaseDate, input.today);
		const row: AssetSummary = {
			ownedDays: ownedDays !== null && ownedDays >= 0 ? ownedDays : null,
			remainingDays,
			tasks: tasksByAsset.get(asset.id) ?? { done: 0, total: 0 },
			spending: new Map(spendingByAsset.get(asset.id)), monthly: new Map(), annual: new Map(),
		};
		if (asset.kind === "item" && asset.itemPurchasePriceKnown) add(purchases, asset.currency, BigInt(asset.amount));
		if (asset.kind === "subscription" && asset.status === "active") {
			add(row.monthly, asset.currency, monthlyMinorUnits(asset));
			add(monthly, asset.currency, monthlyMinorUnits(asset));
			if (remainingDays !== null && remainingDays >= 0 && remainingDays <= 30) upcoming += 1;
		}
		if (asset.kind === "project") {
			for (const subscriptionId of subscriptionsByProject.get(asset.id) ?? []) {
				const subscription = byId.get(subscriptionId);
				if (!subscription) continue;
				if (subscription.status === "active") add(row.monthly, subscription.currency, monthlyMinorUnits(subscription));
				for (const [currency, amount] of spendingByAsset.get(subscriptionId) ?? []) add(row.spending, currency, amount);
			}
			for (const [currency, amount] of row.monthly) add(row.annual, currency, amount * 12n);
			for (const domain of asset.projectDomains ?? []) if (domain.annualAmount !== null) add(row.annual, domain.currency, BigInt(domain.annualAmount));
		}
		summaries.set(asset.id, row);
	}
	return { summaries, domains, purchases, spending, monthly, upcoming };
}

export function partitionAccountPasswords(entries: readonly VaultEntrySummary[], assets: readonly Asset[]) {
	const liveIds = new Set(assets.filter((asset) => !asset.deleted && asset.kind === "account").map((asset) => asset.id));
	const linked = new Map<string, VaultEntrySummary[]>();
	const unlinked: VaultEntrySummary[] = [];
	for (const entry of entries) {
		const ids = [...new Set(entry.linkedAssetIds)].filter((id) => liveIds.has(id));
		if (!ids.length) unlinked.push(entry);
		for (const id of ids) linked.set(id, [...(linked.get(id) ?? []), entry]);
	}
	return { linked, unlinked };
}
