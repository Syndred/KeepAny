import {
	actualCharge,
	calendarDayDistance,
	effectiveFinanceEntry,
	historyAssetIds,
	monthlyMinorUnits,
	type Asset,
	type History,
} from "../../../packages/domain/src";

export type MoneyTotals = Map<string, bigint>;
export type AssetExpenseRecord = History & { amount: number; currency: string; eventDate: string };
export type UpcomingExpense = {
	id: string;
	assetId: string;
	kind: "subscription" | "domain";
	domainId?: string;
	name: string;
	dueDate: string;
	currency: string;
	amount: number | null;
	remainingDays: number;
};

function add(totals: MoneyTotals, currency: string, amount: number | bigint) {
	totals.set(currency, (totals.get(currency) ?? 0n) + BigInt(amount));
}

function validAmount(amount: number | undefined | null): amount is number {
	return amount !== undefined && amount !== null && Number.isSafeInteger(amount) && amount >= 0;
}

function dayDistance(from: string, to: string): number | null {
	try { return calendarDayDistance(from, to); } catch { return null; }
}

function isAssetKind(asset: Asset) {
	return asset.kind === "project" || asset.kind === "subscription" || asset.kind === "item";
}

/**
 * One bill is one expense, even when several assets own it. Plans, purchase
 * prices and due-date estimates are separate facts and never become bills.
 * Soft-deleting an asset does not erase its already recorded expenditure.
 */
export function buildAssetExpenses(input: {
	assets: readonly Asset[];
	history: readonly History[];
	today: string;
	month: string;
}) {
	calendarDayDistance(input.today, input.today);
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw Error("invalid-month");
	const yearPrefix = input.month.slice(0, 4);
	const byId = new Map(input.assets.filter(isAssetKind).map((asset) => [asset.id, asset]));
	const live = [...byId.values()].filter((asset) => !asset.deleted && !asset.purged);
	const month: MoneyTotals = new Map();
	const year: MoneyTotals = new Map();
	const monthly: MoneyTotals = new Map();
	const upcoming: MoneyTotals = new Map();
	const purchases: MoneyTotals = new Map();
	const monthOnline: MoneyTotals = new Map();
	const monthPhysical: MoneyTotals = new Map();
	const monthShared: MoneyTotals = new Map();
	const records: AssetExpenseRecord[] = [];
	const seenHistory = new Set<string>();
	for (const original of input.history) {
		if (seenHistory.has(original.id)) continue;
		seenHistory.add(original.id);
		const entry = effectiveFinanceEntry(original);
		if (entry.deleted || entry.purged || (entry.action !== "expense" && entry.action !== "renew") ||
			!validAmount(entry.amount) || !entry.currency) continue;
		const owners = historyAssetIds(entry).map((id) => byId.get(id)).filter((asset): asset is Asset => !!asset);
		if (!owners.length) continue;
		const eventDate = entry.eventDate || entry.billDate || entry.createdAt.slice(0, 10);
		if (dayDistance(eventDate, input.today) === null || eventDate > input.today) continue;
		const record = { ...entry, amount: entry.amount, currency: entry.currency, eventDate };
		records.push(record);
		if (eventDate.startsWith(yearPrefix + "-")) add(year, entry.currency, entry.amount);
		if (!eventDate.startsWith(input.month + "-")) continue;
		add(month, entry.currency, entry.amount);
		const physical = owners.some((asset) => asset.kind === "item");
		const online = owners.some((asset) => asset.kind !== "item");
		add(physical && online ? monthShared : physical ? monthPhysical : monthOnline, entry.currency, entry.amount);
	}
	records.sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
	const monthRecords = records.filter((entry) => entry.eventDate.startsWith(input.month + "-"));
	const upcomingRows: UpcomingExpense[] = [];
	for (const asset of live) {
		if (asset.kind === "item" && asset.itemPurchasePriceKnown && validAmount(asset.amount) &&
			(!asset.purchaseDate || (dayDistance(asset.purchaseDate, input.today) !== null && asset.purchaseDate <= input.today))) {
			add(purchases, asset.currency, asset.amount);
		}
		if (asset.kind === "subscription" && asset.status === "active" && validAmount(asset.amount) &&
			Number.isSafeInteger(asset.interval) && asset.interval > 0) {
			add(monthly, asset.currency, monthlyMinorUnits(asset));
			const remainingDays = dayDistance(input.today, asset.dueDate);
			if (remainingDays !== null && remainingDays >= 0 && remainingDays <= 30) {
				upcomingRows.push({ id: `subscription:${asset.id}`, assetId: asset.id, kind: "subscription",
					name: asset.name, dueDate: asset.dueDate, currency: asset.currency,
					amount: actualCharge(asset, asset.dueDate), remainingDays });
			}
		}
		if (asset.kind === "project") {
			const seenDomains = new Set<string>();
			for (const domain of asset.projectDomains ?? []) {
				if (seenDomains.has(domain.id)) continue;
				seenDomains.add(domain.id);
				const remainingDays = dayDistance(input.today, domain.expiryDate);
				if (remainingDays === null || remainingDays < 0 || remainingDays > 30) continue;
				upcomingRows.push({ id: `domain:${asset.id}:${domain.id}`, assetId: asset.id, domainId: domain.id, kind: "domain",
					name: domain.name, dueDate: domain.expiryDate, currency: domain.currency,
					amount: validAmount(domain.annualAmount) ? domain.annualAmount : null, remainingDays });
			}
		}
	}
	upcomingRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
	for (const row of upcomingRows) if (row.amount !== null) add(upcoming, row.currency, row.amount);
	return { month, year, monthly, upcoming, purchases, monthOnline, monthPhysical, monthShared, records, monthRecords,
		upcomingRows, upcomingUnknownCount: upcomingRows.filter((row) => row.amount === null).length };
}
