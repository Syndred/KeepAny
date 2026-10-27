import { describe, expect, it } from "vitest";
import { historySchema, newAsset, relationSchema, taskSchema } from "../../../packages/domain/src";
import type { VaultEntrySummary } from "../../../packages/password-vault/src";
import { buildWorkspaceSummary, daysBetween, partitionAccountPasswords } from "./workspace-summary";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetMetrics } from "./components/AssetMetrics";
import i18n from "./i18n";

describe("asset workspace summaries", () => {
	it("uses the correct day count in English while preserving Chinese date copy", () => {
		// Regression: T02-ISSUE-001 — one day was rendered as "1 days".
		// Found by /qa on 2026-10-27.
		// Report: docs/qa/2026-10-27/scopes/T02.md
		const english = i18n.getFixedT("en");
		const chinese = i18n.getFixedT("zh-CN");
		for (const count of [0, 1, 2]) {
			const unit = count === 1 ? "day" : "days";
			expect(english("workspaceOwnedDays", { count })).toBe(`Owned for ${count} ${unit}`);
			expect(english("workspaceRemainingDays", { count })).toBe(`${count} ${unit} left`);
			expect(english("workspaceOverdueDays", { count })).toBe(`${count} ${unit} overdue`);
			expect(chinese("workspaceOwnedDays", { count })).toBe(`已购买 ${count} 天`);
			expect(chinese("workspaceRemainingDays", { count })).toBe(`剩余 ${count} 天`);
			expect(chinese("workspaceOverdueDays", { count })).toBe(`已过期 ${count} 天`);
		}
	});
	it("renders legacy project records that predate optional domain metadata", () => {
		const project = newAsset("project");
		Reflect.deleteProperty(project, "projectDomains");
		const summary = buildWorkspaceSummary({ assets: [project], tasks: [], history: [], relations: [], today: "2026-10-27" });
		expect(summary.domains).toEqual([]);
		expect(() => renderToStaticMarkup(createElement(AssetMetrics, { asset: project, summary: summary.summaries.get(project.id) }))).not.toThrow();
	});
	it("counts date-only days without DST, month-end, leap-year or host-timezone drift", () => {
		expect(daysBetween("2026-08-14", "2026-10-27")).toBe(74);
		expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
		expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
		expect(daysBetween("2011-12-29", "2011-12-31")).toBe(2);
		expect(daysBetween("2026-10-27", "2026-10-26")).toBe(-1);
		for (const date of ["", "2026-02-30", "not-a-date"]) expect(daysBetween(date, "2026-10-27")).toBeNull();
	});

	it("deduplicates relation and history IDs, preserves exact currencies and keeps projected costs separate", () => {
		const project = { ...newAsset("project"), name: "Project", projectDomains: [{ id: crypto.randomUUID(), name: "project.example", registrar: "", accountId: "", expiryDate: "2026-11-18", annualAmount: 1200, currency: "USD" as const, autoRenew: "unknown" as const }] };
		const subscription = { ...newAsset("subscription"), amount: 1299, currency: "USD" as const, dueDate: "2026-11-05" };
		const item = { ...newAsset("item"), amount: 799900, itemPurchasePriceKnown: true, purchaseDate: "2026-08-14" };
		const unknownItem = { ...newAsset("item"), amount: 900, itemPurchasePriceKnown: false };
		const deleted = { ...newAsset("subscription"), deleted: true, amount: 999999 };
		const relation = relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: subscription.id, label: "uses", createdAt: project.createdAt });
		const renewal = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: "renew", note: "", amount: Number.MAX_SAFE_INTEGER, currency: "USD", billDate: "2026-10-01", createdAt: project.createdAt });
		const expense = historySchema.parse({ id: crypto.randomUUID(), assetId: project.id, action: "expense", title: "Hosting", note: "", amount: 1800, currency: "JPY", eventDate: "2026-10-01", createdAt: project.createdAt });
		const refund = historySchema.parse({ ...expense, id: crypto.randomUUID(), action: "refund", amount: 500 });
		const ignored = historySchema.parse({ ...renewal, id: crypto.randomUUID(), assetId: deleted.id });
		const tasks = [false, true, true].map((done) => taskSchema.parse({ id: crypto.randomUUID(), name: "Milestone", assetId: project.id, done, createdAt: project.createdAt }));
		const summary = buildWorkspaceSummary({ assets: [project, subscription, item, unknownItem, deleted], relations: [relation, { ...relation, id: crypto.randomUUID() }], tasks: [...tasks, { ...tasks[0], deleted: true }], history: [renewal, renewal, expense, refund, ignored], today: "2026-10-27" });
		expect(summary.summaries.get(project.id)?.tasks).toEqual({ done: 2, total: 3 });
		expect(summary.summaries.get(item.id)?.ownedDays).toBe(74);
		expect(summary.summaries.get(unknownItem.id)?.ownedDays).toBeNull();
		expect(summary.summaries.get(subscription.id)?.remainingDays).toBe(9);
		expect(summary.domains[0].remainingDays).toBe(22);
		expect(summary.purchases).toEqual(new Map([["CNY", 799900n]]));
		expect(summary.monthly).toEqual(new Map([["USD", 1299n]]));
		expect(summary.spending).toEqual(new Map([["USD", BigInt(Number.MAX_SAFE_INTEGER)], ["JPY", 1800n]]));
		expect(summary.summaries.get(project.id)?.spending).toEqual(new Map([["JPY", 1800n], ["USD", BigInt(Number.MAX_SAFE_INTEGER)]]));
		expect(summary.summaries.get(project.id)?.annual).toEqual(new Map([["USD", 1299n * 12n + 1200n]]));
		expect(summary.upcoming).toBe(2);
	});

	it("keeps cancelled subscriptions out of renewal totals and preserves unknown or future dates", () => {
		const cancelled = { ...newAsset("subscription"), status: "cancelled" as const, dueDate: "2026-11-01", amount: 1000 };
		const futureItem = { ...newAsset("item"), purchaseDate: "2026-12-01" };
		const expired = { ...newAsset("subscription"), dueDate: "2026-10-20" };
		const summary = buildWorkspaceSummary({ assets: [cancelled, futureItem, expired], tasks: [], relations: [], history: [], today: "2026-10-27" });
		expect(summary.upcoming).toBe(0);
		expect(summary.summaries.get(cancelled.id)?.monthly.size).toBe(0);
		expect(summary.summaries.get(futureItem.id)?.ownedDays).toBeNull();
		expect(summary.summaries.get(expired.id)?.remainingDays).toBe(-7);
	});
});

describe("multi-owner corrected bills", () => {
	it("counts each bill once globally and once per project across direct and subscription ownership", () => {
		const project = newAsset("project"), subscription = newAsset("subscription"), item = newAsset("item");
		const relation = relationSchema.parse({ id: "linked", from: project.id, to: subscription.id, label: "uses", createdAt: project.createdAt });
		const bill = historySchema.parse({ id: "bill", assetId: subscription.id, assetIds: [subscription.id, project.id, item.id], action: "expense", title: "Bill", amount: 200, currency: "CNY", eventDate: "2026-10-27", createdAt: project.createdAt, note: "" });
		const summary = buildWorkspaceSummary({ assets: [project, subscription, item], relations: [relation], history: [bill, bill], tasks: [], today: "2026-10-27" });
		expect(summary.spending.get("CNY")).toBe(200n);
		for (const owner of [project, subscription, item]) expect(summary.summaries.get(owner.id)?.spending.get("CNY")).toBe(200n);
		const correction = { amount: 350, currency: "USD" as const, eventDate: "2026-10-28", title: "Corrected", source: "", note: "", hidden: false, assetIds: [item.id] };
		const renewal = historySchema.parse({ ...bill, assetIds: undefined, action: "renew", billDate: "2026-10-27", financeCorrection: correction });
		const corrected = buildWorkspaceSummary({ assets: [project, subscription, item], relations: [relation], history: [renewal], tasks: [], today: "2026-10-27" });
		expect(corrected.spending).toEqual(new Map([["USD", 350n]]));
		expect(corrected.summaries.get(subscription.id)?.spending.size).toBe(0);
		expect(corrected.summaries.get(item.id)?.spending.get("USD")).toBe(350n);
		const removed = buildWorkspaceSummary({ assets: [project, subscription, item], relations: [relation], history: [{ ...renewal, financeCorrection: { ...correction, hidden: true } }], tasks: [], today: "2026-10-27" });
		expect(removed.spending.size).toBe(0);
		expect(renewal.amount).toBe(200);
	});
});

describe("one account view across ordinary metadata and unlocked vault summaries", () => {
	it("uses explicit live account IDs, keeps shared entries and does not create ordinary assets", () => {
		const first = newAsset("account"), second = newAsset("account");
		const project = newAsset("project"), deleted = { ...newAsset("account"), deleted: true };
		const entry = (id: string, ids: string[]): VaultEntrySummary => ({ id, title: id, username: "same@example.test", url: "", linkedAssetIds: ids, modifiedAt: first.updatedAt, historyCount: 0 });
		const entries = [entry("shared", [first.id, first.id, second.id]), entry("project-only", [project.id]), entry("deleted-account", [deleted.id]), entry("unlinked", [])];
		const assets = [first, second, project, deleted];
		const before = JSON.stringify({ assets, entries });
		const groups = partitionAccountPasswords(entries, assets);
		expect(groups.linked.get(first.id)?.map((row) => row.id)).toEqual(["shared"]);
		expect(groups.linked.get(second.id)?.map((row) => row.id)).toEqual(["shared"]);
		expect(groups.unlinked.map((row) => row.id)).toEqual(["project-only", "deleted-account", "unlinked"]);
		expect(partitionAccountPasswords([], assets).unlinked).toEqual([]);
		expect(JSON.stringify({ assets, entries })).toBe(before);
	});
});
