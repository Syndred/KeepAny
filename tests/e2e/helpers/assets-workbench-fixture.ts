import { resolve } from "node:path";
import { assetSchema, historySchema, newAsset, relationSchema, taskSchema, type Asset } from "../../../packages/domain/src";
import { prepareCompletionArchive } from "./completion-archive";

export const assetFixturePassword = "Synthetic-assets-acceptance-only-2026";
export const assetFixtureToday = "2026-10-29";
export const assetFixtureTime = "2026-10-29T04:00:00.000Z";

/** Synthetic Node preparation. Consumption always uses the candidate's visible KA1 restore UI. */
export async function prepareAssetWorkbenchFixture(directory: string) {
	const fixture = await prepareCompletionArchive(directory, assetFixturePassword, async (db) => {
		const asset = (kind: Asset["kind"], fields: Partial<Asset>) => assetSchema.parse({ ...newAsset(kind), createdAt: assetFixtureTime, updatedAt: assetFixtureTime, ...fields });
		const project = asset("project", { name: "AS Pine project", url: "https://pine.example", category: "website", tags: ["Studio"], description: "Synthetic project with domain and account relations", projectDomains: [
			{ id: crypto.randomUUID(), name: "pine.example", registrar: "Synthetic registrar", expiryDate: "2026-11-08", annualAmount: 8800, currency: "CNY", accountId: "", autoRenew: "unknown" },
			{ id: crypto.randomUUID(), name: "missing-date.example", registrar: "", expiryDate: "", annualAmount: null, currency: "USD", accountId: "", autoRenew: "unknown" },
		] });
		const longProject = asset("project", { name: `AS Long project ${"VeryLongReadableName ".repeat(7)}`.slice(0, 160), category: "tool", description: "Long text ".repeat(180), url: `https://long.example/${"long-path/".repeat(60)}` });
		const software = asset("subscription", { name: "AS Paper software", category: "software", tags: ["Studio"], description: "Synthetic software plan", amount: 1200, currency: "CNY", dueDate: "2026-11-05", billingAnchor: "2026-11-05", cycle: "month", interval: 1 });
		const service = asset("subscription", { name: "AS Cloud service", category: "service", amount: 900, currency: "USD", cycle: "year", interval: 1, dueDate: "", accountProvider: "Synthetic provider" });
		const item = asset("item", { name: "AS Work monitor", category: "device", location: "Studio", purchaseDate: "2026-10-16", itemPurchasePriceKnown: true, amount: 109000, itemLifecycleStatus: "inUse", itemWarrantyStatus: "inWarranty", warrantyDate: "2027-10-16", tags: ["Studio"] });
		const appliance = asset("item", { name: "AS Air purifier", category: "appliance", location: "Living room", itemLifecycleStatus: "inUse", itemWarrantyStatus: "inWarranty", warrantyDate: "2027-01-01" });
		const furniture = asset("item", { name: "AS Reading chair", category: "furniture", location: "Library", itemLifecycleStatus: "inUse", itemWarrantyStatus: "notApplicable" });
		const loaned = asset("item", { name: "AS Loaned camera", category: "other", location: "Studio", itemLifecycleStatus: "inUse" });
		const account = asset("account", { name: "AS Workspace account", username: "synthetic@example.test", category: "email" });
		const neighborAccount = asset("account", { name: "AS Neighbor account", username: "neighbor@example.test", category: "email" });
		const assets = [project, longProject, software, service, item, appliance, furniture, loaned, account, neighborAccount];
		const entry = (fields: Record<string, unknown>) => historySchema.parse({ id: crypto.randomUUID(), assetId: software.id, action: "expense", title: "Synthetic expense", amount: 1000, currency: "CNY", eventDate: "2026-10-20", note: "Synthetic acceptance only", createdAt: assetFixtureTime, ...fields });
		const onlineCost = entry({ title: "AS October online expense" });
		const dollarCost = entry({ assetId: service.id, title: "AS USD expense", amount: 300, currency: "USD" });
		const physicalCost = entry({ assetId: item.id, title: "AS Physical maintenance expense", amount: 500 });
		const sharedCost = entry({ assetId: project.id, assetIds: [project.id, item.id], title: "AS Shared expense counted once", amount: 200 });
		const renewal = entry({ action: "renew", title: "AS Corrected renewal", amount: 400, billDate: "2026-10-20", financeCorrection: { title: "AS Corrected renewal", amount: 200, currency: "CNY", eventDate: "2026-10-20", source: "Synthetic statement", note: "Correction preserved", assetIds: [software.id], hidden: false } });
		const refund = entry({ action: "refund", title: "AS Preserved refund", amount: 700 });
		const balance = entry({ action: "balance", title: "AS Preserved balance", amount: 90000 });
		const future = entry({ title: "AS Future expense excluded from actual spending", amount: 50000, eventDate: "2026-10-30" });
		const prior = entry({ title: "AS Prior year expense", amount: 99900, eventDate: "2025-12-31" });
		const hidden = entry({ title: "AS Deleted expense", amount: 99900, deleted: true });
		const history = [onlineCost, dollarCost, physicalCost, sharedCost, renewal, refund, balance, future, prior, hidden];
		const task = taskSchema.parse({ id: crypto.randomUUID(), assetId: appliance.id, name: "AS Replace purifier filter", dueDate: "2026-11-10", createdAt: assetFixtureTime,
			maintenancePlan: { active: true, records: [], deferredUntil: "", schedule: { rule: { mode: "once" }, dueDate: "2026-11-10", anchorDate: "2026-11-10", occurrence: 0, leadDays: 7, plannedAmountMinor: 1000, currency: "CNY" } } });
		const relation = relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: account.id, label: "uses", createdAt: assetFixtureTime });
		await db.saveBatch([
			...assets.map(value => ({ type: "asset" as const, value })),
			...history.map(value => ({ type: "history" as const, value })),
			{ type: "task", value: task }, { type: "relation", value: relation },
		]);
		const idleEvent = historySchema.parse({ id: crypto.randomUUID(), assetId: furniture.id, action: "itemStatus", itemStatusBefore: "inUse", itemStatusAfter: "idle", eventDate: assetFixtureToday, note: "Synthetic idle preparation", createdAt: assetFixtureTime });
		const idleFurniture = { ...furniture, itemLifecycleStatus: "idle" as const, itemStatusDate: assetFixtureToday, lastItemEventId: idleEvent.id };
		await db.recordItemAction(furniture, idleFurniture, idleEvent);
		const loanEvent = historySchema.parse({ id: crypto.randomUUID(), assetId: loaned.id, action: "loan", borrower: "Synthetic friend", expectedReturnDate: "2026-11-05", eventDate: assetFixtureToday, note: "Synthetic loan preparation", createdAt: assetFixtureTime });
		const loanedCamera = { ...loaned, status: "loaned" as const, borrower: "Synthetic friend", itemExpectedReturnDate: "2026-11-05", lastItemEventId: loanEvent.id };
		await db.recordItemAction(loaned, loanedCamera, loanEvent);
		return { project, longProject, software, service, item, appliance, furniture: idleFurniture, loaned: loanedCamera, account, neighborAccount, onlineCost, dollarCost, physicalCost, sharedCost, renewal, refund, balance, future, prior, task };
	});
	return { ...fixture, archive: resolve(directory, "fixture.ka1") };
}

export type AssetWorkbenchFixture = Awaited<ReturnType<typeof prepareAssetWorkbenchFixture>>;
