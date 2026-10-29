import { describe, expect, it } from "vitest";
import { historySchema, newAsset, type Asset, type History, type ProjectDomain } from "../../../packages/domain/src";
import { buildAssetExpenses } from "./asset-expenses";

const today = "2026-10-29";
const asset = (kind: Asset["kind"], patch: Partial<Asset> = {}) => ({ ...newAsset(kind), ...patch });
const bill = (owner: Asset, patch: Partial<History> = {}) => historySchema.parse({
	id: crypto.randomUUID(), assetId: owner.id, action: "expense", title: "Synthetic expense",
	note: "", eventDate: today, amount: 1200, currency: "CNY", createdAt: `${today}T12:00:00Z`, ...patch,
});
const domain = (patch: Partial<ProjectDomain> = {}): ProjectDomain => ({
	id: crypto.randomUUID(), name: "synthetic.example", registrar: "", accountId: "",
	expiryDate: "2026-11-28", annualAmount: 8800, currency: "CNY", autoRenew: "unknown", ...patch,
});
const calculate = (assets: Asset[], history: History[] = [], month = "2026-10", asOf = today) =>
	buildAssetExpenses({ assets, history, today: asOf, month });

describe("asset expense dashboard: actual bills and estimates stay separate", () => {
	it("has meaningful empty totals without inventing a currency or a zero-cost renewal", () => {
		const result = calculate([]);
		for (const key of ["month", "year", "monthly", "upcoming", "purchases", "monthOnline", "monthPhysical", "monthShared"] as const)
			expect(result[key].size).toBe(0);
		expect(result.records).toEqual([]);
		expect(result.monthRecords).toEqual([]);
		expect(result.upcomingRows).toEqual([]);
		expect(result.upcomingUnknownCount).toBe(0);
	});

	it("deduplicates shared bills and keeps exact currencies without double-allocating the distribution", () => {
		const project = asset("project"), subscription = asset("subscription"), item = asset("item");
		const online = bill(subscription, { amount: 300, assetIds: [subscription.id, project.id] });
		const shared = bill(project, { amount: 200, assetIds: [project.id, subscription.id, item.id] });
		const physical = bill(item, { amount: 100 });
		const yen = bill(project, { amount: Number.MAX_SAFE_INTEGER, currency: "JPY" });
		const yen2 = bill(item, { amount: Number.MAX_SAFE_INTEGER, currency: "JPY" });
		const result = calculate([project, subscription, item], [online, online, shared, shared, physical, yen, yen2]);
		expect(result.month).toEqual(new Map([["CNY", 600n], ["JPY", BigInt(Number.MAX_SAFE_INTEGER) * 2n]]));
		expect(result.monthOnline).toEqual(new Map([["CNY", 300n], ["JPY", BigInt(Number.MAX_SAFE_INTEGER)]]));
		expect(result.monthPhysical).toEqual(new Map([["CNY", 100n], ["JPY", BigInt(Number.MAX_SAFE_INTEGER)]]));
		expect(result.monthShared).toEqual(new Map([["CNY", 200n]]));
		for (const [currency, total] of result.month) expect(
			(result.monthOnline.get(currency) ?? 0n) + (result.monthPhysical.get(currency) ?? 0n) + (result.monthShared.get(currency) ?? 0n),
		).toBe(total);
		expect(result.monthRecords).toHaveLength(5);
	});

	it("uses corrected renewal dates, amount, currency and owners without changing the stored renewal fact", () => {
		const subscription = asset("subscription"), item = asset("item");
		const original = bill(subscription, { action: "renew", eventDate: undefined, billDate: "2026-09-20", amount: 999,
			financeCorrection: { title: "Corrected synthetic", note: "Correction", eventDate: "2026-10-01", amount: 2400,
				currency: "USD", hidden: false, assetIds: [item.id] } });
		const before = JSON.stringify(original);
		const result = calculate([subscription, item], [original]);
		expect(result.month).toEqual(new Map([["USD", 2400n]]));
		expect(result.monthOnline.size).toBe(0);
		expect(result.monthPhysical).toEqual(result.month);
		expect(result.records[0]).toMatchObject({ title: "Corrected synthetic", eventDate: "2026-10-01", amount: 2400, currency: "USD" });
		expect(JSON.stringify(original)).toBe(before);
		const hidden = { ...original, financeCorrection: { ...original.financeCorrection!, hidden: true } };
		expect(calculate([subscription, item], [hidden]).month.size).toBe(0);
	});

	it("excludes refund, top-up, balance, deleted bills, invalid values, secret/account-only and orphan bills", () => {
		const project = asset("project"), account = asset("account"), vault = asset("vault");
		const expense = bill(project);
		const ignored = [
			...(["refund", "topup", "balance", "maintenance", "loan", "return"] as const).map((action) => bill(project, { action })),
			bill(project, { deleted: true }), bill(account), bill(vault), bill(project, { assetId: "not-found" }),
			{ ...expense, id: "negative", amount: -1 }, { ...expense, id: "fraction", amount: 1.5 },
			{ ...expense, id: "unsafe", amount: Number.MAX_SAFE_INTEGER + 1 }, { ...expense, id: "missing", amount: undefined },
			{ ...expense, id: "no-currency", currency: undefined }, { ...expense, id: "invalid-date", eventDate: "2026-02-30" },
		];
		const result = calculate([project, account, vault], ignored);
		expect(result.records).toEqual([]);
		expect(result.month.size).toBe(0);
		expect(result.year.size).toBe(0);
	});

	it("preserves occurred expenses for soft-deleted assets while excluding them from plans and purchase totals", () => {
		const removed = asset("item", { deleted: true, amount: 9999, itemPurchasePriceKnown: true });
		const removedSub = asset("subscription", { deleted: true, amount: 888, dueDate: today });
		const result = calculate([removed, removedSub], [bill(removed), bill(removedSub)]);
		expect(result.month.get("CNY")).toBe(2400n);
		expect(result.purchases.size).toBe(0);
		expect(result.monthly.size).toBe(0);
		expect(result.upcomingRows).toEqual([]);
	});

	it("cuts off future records, uses the selected year and month boundaries, and sorts effective date-only values", () => {
		const project = asset("project");
		const records = ["2025-01-01", "2025-12-31", "2026-01-01", "2026-09-30", "2026-10-01", today, "2026-10-30", "2026-11-01"]
			.map((eventDate) => bill(project, { eventDate, amount: 100 }));
		const result = calculate([project], records);
		expect(result.month.get("CNY")).toBe(200n);
		expect(result.year.get("CNY")).toBe(400n);
		expect(result.records.map((entry) => entry.eventDate)).toEqual([today, "2026-10-01", "2026-09-30", "2026-01-01", "2025-12-31", "2025-01-01"]);
		const historic = calculate([project], records, "2025-12");
		expect(historic.month.get("CNY")).toBe(100n);
		expect(historic.year.get("CNY")).toBe(200n);
		const future = calculate([project], records, "2027-01");
		expect(future.month.size).toBe(0);
		expect(future.year.size).toBe(0);
		const leap = calculate([project], [bill(project, { eventDate: "2024-02-29" }), bill(project, { eventDate: "2024-03-01" })], "2024-02", "2024-02-29");
		expect(leap.monthRecords.map((entry) => entry.eventDate)).toEqual(["2024-02-29"]);
		expect(() => calculate([], [], "2026-13")).toThrow("invalid-month");
		expect(() => calculate([], [], "2026-10", "2026-02-30")).toThrow("invalid-date");
	});

	it("normalizes a legacy renewal date from billDate or its creation day, never from displayed asset prices", () => {
		const subscription = asset("subscription", { amount: 999999 });
		const legacy = bill(subscription, { action: "renew", eventDate: undefined, billDate: "2026-10-02", amount: 100 });
		const undated = bill(subscription, { action: "renew", eventDate: undefined, billDate: undefined, amount: 200 });
		const zero = bill(subscription, { action: "renew", eventDate: undefined, billDate: today, amount: 0 });
		const result = calculate([subscription], [legacy, undated, zero]);
		expect(result.month.get("CNY")).toBe(300n);
		expect(result.monthRecords).toHaveLength(3);
		expect(result.monthRecords.find((entry) => entry.id === legacy.id)?.eventDate).toBe("2026-10-02");
		expect(result.monthRecords.find((entry) => entry.id === undated.id)?.eventDate).toBe(today);
	});

	it("counts only active subscription plans and estimates their next due amount including trials and discounts", () => {
		const normal = asset("subscription", { amount: 1200, currency: "USD", interval: 2, dueDate: today });
		const discounted = asset("subscription", { amount: 10000, cycle: "year", discountAmount: 1000, discountUntil: "2026-11-01", dueDate: "2026-11-01" });
		const trial = asset("subscription", { amount: 3000, dueDate: "2026-11-02", trialEndsAt: "2026-11-03" });
		const paused = asset("subscription", { amount: 999999, status: "paused", dueDate: today });
		const cancelled = asset("subscription", { amount: 999999, status: "cancelled", dueDate: today });
		const result = calculate([normal, discounted, trial, paused, cancelled]);
		expect(result.monthly).toEqual(new Map([["USD", 600n], ["CNY", 3833n]]));
		expect(result.upcoming).toEqual(new Map([["USD", 1200n], ["CNY", 9000n]]));
		expect(result.upcomingRows.map((row) => [row.assetId, row.amount])).toEqual([[normal.id, 1200], [discounted.id, 9000], [trial.id, 0]]);
		expect(result.month.size).toBe(0);
		expect(result.upcomingUnknownCount).toBe(0);
	});

	it("includes exactly today through day 30, keeps unknown domain fees visible, and omits missing or overdue dates", () => {
		const unknown = domain({ annualAmount: null });
		const todayDomain = domain({ expiryDate: today, annualAmount: 300, currency: "JPY" });
		const tooLate = domain({ expiryDate: "2026-11-29", annualAmount: 9000 });
		const noDate = domain({ expiryDate: "" });
		const project = asset("project", { projectDomains: [unknown, unknown, todayDomain, tooLate, noDate] });
		const lastDay = asset("subscription", { dueDate: "2026-11-28", amount: 500 });
		const late = asset("subscription", { dueDate: "2026-11-29", amount: 9999 });
		const overdue = asset("subscription", { dueDate: "2026-10-28", amount: 9999 });
		const noDue = asset("subscription", { dueDate: "", amount: 9999 });
		const result = calculate([project, lastDay, late, overdue, noDue]);
		expect(result.upcomingRows).toHaveLength(3);
		expect(result.upcomingRows.find((row) => row.domainId === unknown.id)).toMatchObject({ kind: "domain", assetId: project.id, amount: null, remainingDays: 30 });
		expect(result.upcomingRows.map((row) => row.remainingDays)).toEqual([0, 30, 30]);
		expect(result.upcomingUnknownCount).toBe(1);
		expect(result.upcoming).toEqual(new Map([["JPY", 300n], ["CNY", 500n]]));
		const legacy = asset("project");
		Reflect.deleteProperty(legacy, "projectDomains");
		expect(calculate([legacy]).upcomingRows).toEqual([]);
	});

	it("keeps recorded purchase prices separate, ignores unknown and future purchases, and does not mutate inputs", () => {
		const item = asset("item", { amount: 899900, itemPurchasePriceKnown: true, purchaseDate: "2026-10-01" });
		const yen = asset("item", { amount: 5000, currency: "JPY", itemPurchasePriceKnown: true, purchaseDate: "" });
		const unknown = asset("item", { amount: 9999, itemPurchasePriceKnown: false });
		const future = asset("item", { amount: 9999, itemPurchasePriceKnown: true, purchaseDate: "2026-10-30" });
		const assets = [item, yen, unknown, future];
		const history = [bill(item, { amount: 1200 })];
		const before = JSON.stringify({ assets, history });
		const result = calculate(assets, history);
		expect(result.purchases).toEqual(new Map([["CNY", 899900n], ["JPY", 5000n]]));
		expect(result.month).toEqual(new Map([["CNY", 1200n]]));
		expect(JSON.stringify({ assets, history })).toBe(before);
	});
});
