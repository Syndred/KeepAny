import { describe, expect, it } from "vitest";
import {
	historySchema,
	newAsset,
	taskSchema,
	type Asset,
	type History,
	type Task,
} from "../../../packages/domain/src";
import {
	buildGlobalSearchIndex,
	projectGlobalSearchCandidate,
	searchGlobalIndex,
	type GlobalSearchCandidate,
	type GlobalSearchInput,
	type GlobalSearchLabels,
} from "./global-search";
import type { ReviewedCandidate } from "../../../packages/local-db/src/intake-review";

const labels: GlobalSearchLabels = {
	assetKinds: { project: "Project", account: "Account", subscription: "Subscription", item: "Item", vault: "Vault" },
	financeActions: { expense: "Expense", topup: "Top-up", refund: "Refund", balance: "Balance", renew: "Recorded renewal" },
	sources: { asset: "Asset", finance: "Finance", intake: "Intake", task: "Task" },
	taskStates: { pending: "Pending", done: "Done" },
	intakeAccepted: "Accepted",
};
const zhLabels: GlobalSearchLabels = {
	assetKinds: { project: "项目", account: "账号", subscription: "订阅", item: "实物", vault: "密码管理器" },
	financeActions: { expense: "支出", topup: "充值", refund: "退款", balance: "余额", renew: "已记录续费" },
	sources: { asset: "资料", finance: "财务", intake: "收录", task: "待办" },
	taskStates: { pending: "待完成", done: "已完成" },
	intakeAccepted: "已确认",
};
const createdAt = "2026-09-30T00:00:00.000Z";

function asset(kind: Asset["kind"], values: Partial<Asset> = {}): Asset {
	return { ...newAsset(kind), name: "Visible asset", createdAt, updatedAt: createdAt, ...values };
}

function history(assetId: string, values: Partial<History> = {}): History {
	return historySchema.parse({
		id: "history-operation-id", assetId, action: "expense", title: "Hosting bill",
		note: "", amount: 12345, currency: "USD", eventDate: "2026-09-29", source: "Receipt desk", createdAt,
		...values,
	});
}

function candidate(current: Asset, values: Partial<GlobalSearchCandidate> = {}): GlobalSearchCandidate {
	return {
		id: `csv-${"a".repeat(64)}-2`, fileName: "Portfolio.csv", rowNumber: 2, status: "accepted",
		asset: { id: current.id, kind: current.kind, name: current.name, url: current.url }, ...values,
	};
}

function task(values: Partial<Task> = {}): Task {
	return taskSchema.parse({ id: "task-operation-id", name: "Check bill", createdAt, dueDate: "2026-10-01", ...values });
}

function index(values: Partial<GlobalSearchInput> = {}) {
	return buildGlobalSearchIndex({
		assets: [], history: [], reviewedCandidates: [], reviewedCandidatesLoaded: true,
		tasks: [], locale: "en", labels, ...values,
	});
}

describe("global search public projection", () => {
	it("finds project and item bills by either explicit owner while keeping one navigation result per bill", () => {
		const project = asset("project", { name: "Ledger studio" }), item = asset("item", { name: "Ledger camera" });
		const shared = history(project.id, { assetIds: [project.id, item.id], title: "Shared equipment invoice" });
		const entries = index({ assets: [project,item], history: [shared] });
		for (const query of ["Shared equipment invoice", "Ledger studio", "Ledger camera"])
			expect(searchGlobalIndex(entries, query).filter(row => row.source === "finance").map(row => row.target), query)
				.toEqual([{ type: "finance", historyId: shared.id }]);
	});

	it("rejects vault or missing bill sources even when they also claim an ordinary account owner", () => {
		const account = asset("account"), vault = asset("vault");
		const rows = [history(vault.id, { title: "Synthetic vault source bill", assetIds: [vault.id,account.id] }),
			history("missing-source", { id: "missing-source-bill", assetIds: ["missing-source",account.id] })];
		expect(index({ assets: [account,vault], history: rows }).filter(row => row.source === "finance")).toEqual([]);
	});
	it("uses corrected renewal bill fields and hides deleted bills without indexing the original fact or private notes", () => {
		const subscription = asset("subscription", { name: "Original renewal source" }), project = asset("project", { name: "Effective owner" });
		const original = history(subscription.id, { action: "renew", title: "Original invoice title", amount: 12345, billDate: "2026-09-29" });
		const corrected = historySchema.parse({ ...original, financeCorrection: { title: "Corrected invoice title", source: "Corrected statement",
			note: "sensitive-correction-note", eventDate: "2026-10-25", amount: 22001, currency: "JPY", assetIds: [project.id] } });
		const entries = index({ assets: [subscription,project], history: [corrected] });
		for (const query of ["Corrected invoice title", "Corrected statement", "22001", "2026-10-25", "Effective owner"])
			expect(searchGlobalIndex(entries, query).filter(row => row.source === "finance")).toHaveLength(1);
		for (const query of ["Original invoice title", "Receipt desk", "123.45", "sensitive-correction-note", "2026-09-29", "Original renewal source"])
			expect(searchGlobalIndex(entries, query).filter(row => row.source === "finance")).toEqual([]);
		const hidden = { ...corrected, financeCorrection: { ...corrected.financeCorrection, hidden: true } } as History;
		expect(index({ assets: [subscription,project], history: [hidden] }).filter(row => row.source === "finance")).toEqual([]);
		expect(corrected).toMatchObject(original);
	});
	it("indexes all four approved sources with object-specific navigation targets", () => {
		const current = asset("account", { id: "visible-account", name: "Shared name" });
		const receipt = candidate(current, { asset: { ...candidate(current).asset, name: "Shared intake" } });
		const entries = index({
			assets: [current], history: [history(current.id, { title: "Shared bill" })],
			reviewedCandidates: [receipt], tasks: [task({ name: "Shared task" })],
		});
		const results = searchGlobalIndex(entries, "  SHARED  ");
		expect(results.map((row) => row.target)).toEqual([
			{ type: "asset", kind: "account", assetId: current.id },
			{ type: "finance", historyId: "history-operation-id" },
			{ type: "intake", candidateId: receipt.id },
			{ type: "task", taskId: "task-operation-id" },
		]);
		expect(new Set(results.map((row) => row.key)).size).toBe(4);
		expect(results.every((row) => !("searchText" in row))).toBe(true);
		expect(searchGlobalIndex(entries, "unmatched phrase")).toEqual([]);
	});

	it("returns a deterministic initial list and caps every query at 15", () => {
		const assets = Array.from({ length: 20 }, (_, count) => asset("project", { id: `project-${count}`, name: `Project ${String(count).padStart(2, "0")}` }));
		const forward = index({ assets }), reverse = index({ assets: [...assets].reverse() });
		for (const query of ["", "  ", "PROJECT"]) {
			expect(searchGlobalIndex(forward, query)).toHaveLength(15);
			expect(searchGlobalIndex(reverse, query)).toEqual(searchGlobalIndex(forward, query));
			expect(searchGlobalIndex(forward, query, { limit: 200 })).toHaveLength(15);
		}
		expect(searchGlobalIndex(forward, "", { limit: 3.9 })).toHaveLength(3);
		expect(searchGlobalIndex(forward, "", { limit: 0 })).toEqual([]);
		expect(searchGlobalIndex(forward, "", { limit: -1 })).toEqual([]);
		expect(searchGlobalIndex(forward, "", { limit: Number.NaN })).toHaveLength(15);
	});

	it("orders asset kinds like the frozen view, then finance, receipts and ordinary tasks", () => {
		const account = asset("account", { id: "a", name: "Alpha" });
		const all = [asset("vault", { id: "v" }), asset("item", { id: "i" }),
			asset("subscription", { id: "s" }), account, asset("project", { id: "p" })];
		const entries = index({ assets: all, history: [history(account.id)], reviewedCandidates: [candidate(account)], tasks: [task()] });
		expect(entries.map((row) => row.target.type === "asset" ? row.target.kind : row.source))
			.toEqual(["project", "account", "item", "subscription", "vault", "finance", "intake", "task"]);
	});

	it("keeps financial date, receipt filename/row and task due-date ordering deterministic", () => {
		const current = asset("account", { id: "account" });
		const rows = [history(current.id, { id: "older", eventDate: "2026-09-28" }), history(current.id, { id: "newer", eventDate: "2026-09-30" })];
		const receipts = [candidate(current, { id: "receipt-z", fileName: "Z.csv" }), candidate(current, { id: "receipt-a3", fileName: "A.csv", rowNumber: 3 }),
			candidate(current, { id: "receipt-a2", fileName: "A.csv", rowNumber: 2 })];
		const tasks = [task({ id: "task-later", dueDate: "2026-10-02" }), task({ id: "task-first", dueDate: "2026-10-01" }), task({ id: "task-undated", dueDate: "" })];
		const first = index({ assets: [current], history: rows, reviewedCandidates: receipts, tasks });
		const reversed = index({ assets: [current], history: [...rows].reverse(), reviewedCandidates: [...receipts].reverse(), tasks: [...tasks].reverse() });
		expect(searchGlobalIndex(first, "")).toEqual(searchGlobalIndex(reversed, ""));
		expect(first.filter((row) => row.source !== "asset").map((row) => row.key)).toEqual([
			"finance:newer", "finance:older", "intake:receipt-a2", "intake:receipt-a3", "intake:receipt-z", "task:task-first", "task:task-later", "task:task-undated",
		]);
		const tied = [asset("project", { id: "SameID" }), asset("project", { id: "sameid" })];
		expect(searchGlobalIndex(index({ assets: tied }), "")).toEqual(searchGlobalIndex(index({ assets: [...tied].reverse() }), ""));
	});

	it("retains public profile, account, location, payment and project-domain fields", () => {
		const current = asset("project", {
			name: "Camera toolkit", tags: ["Travel gear"], username: "owner@example.test", location: "书房 → 抽屉",
			category: "Studio equipment", description: "Compact camera", longDescription: "Public long profile",
			contact: "Contact desk", borrower: "Loan recipient", accountProvider: "Identity provider",
			subscriptionPaymentMethod: "Visa ending 4242", projectTitle: "Toolkit title", projectPromoUrl: "https://promo.example/Guide",
			projectMediumDescription: "Medium profile", projectFeatures: "Useful features", projectPricing: "Public pricing",
			projectPricingType: "Pay once", projectEmail: "support@toolkit.test", url: "https://toolkit.test/Home",
			projectDomains: [{ id: "domain-private-id", name: "tools.example", registrar: "Domain desk", accountId: "domain-private-account",
				expiryDate: "", annualAmount: null, currency: "CNY", autoRenew: "unknown" }],
		});
		const entries = index({ assets: [current] });
		for (const query of ["camera", "TRAVEL GEAR", "owner@", " 抽屉 ", "equipment", "compact camera", "long profile", "contact desk",
			"loan recipient", "identity provider", "4242", "toolkit title", "promo.example/guide", "medium profile", "useful features",
			"public pricing", "pay once", "support@", "toolkit.test/home", "tools.example", "domain desk"])
			expect(searchGlobalIndex(entries, query), query).toHaveLength(1);
		for (const query of ["domain-private-id", "domain-private-account"])
			expect(searchGlobalIndex(entries, query)).toEqual([]);
	});

	it("does not read private fields or leak IDs through labels and searchable text", () => {
		const hidden = "private-metadata-needle";
		const current = Object.assign(asset("account", {
			id: hidden, notes: hidden, attachments: [hidden], lastRenewalId: hidden, lastSubscriptionSaveId: hidden, lastItemEventId: hidden,
			projectMedia: { logoId: hidden, homeScreenshotId: hidden, productScreenshotIds: [hidden], promoCoverId: hidden },
			itemMedia: { coverId: hidden, detailIds: [hidden], receiptIds: [hidden] },
		}), { password: hidden, recoveryCode: hidden, secret: hidden, localRefs: [hidden] });
		Object.defineProperty(current, "legacyPassword", { get: () => { throw Error("private field read"); } });
		const entries = index({ assets: [current] });
		expect(searchGlobalIndex(entries, hidden)).toEqual([]);
		const result = searchGlobalIndex(entries, "visible")[0];
		expect(`${result.title} ${result.secondary}`).not.toContain(hidden);
		expect(result.target).toEqual({ type: "asset", kind: "account", assetId: hidden });
	});

	it("projects URL fields to protocol, host and path, excluding credentials, query and fragment", () => {
		const current = asset("project", {
			url: "https://credential-user:credential-pass@example.test:8443/Public?password=query-secret#fragment-secret",
			projectPromoUrl: "https://promo-user:promo-pass@promo.test/Promo?token=promo-secret#promo-fragment",
			description: "See https://inline-user:inline-pass@inline.test/Profile?token=inline-secret#inline-fragment",
		});
		const entries = index({ assets: [current] });
		for (const query of ["example.test:8443/public", "promo.test/promo", "inline.test/profile"])
			expect(searchGlobalIndex(entries, query)).toHaveLength(1);
		for (const query of ["credential-user", "credential-pass", "query-secret", "fragment-secret", "promo-user", "promo-pass", "promo-secret", "promo-fragment",
			"inline-user", "inline-pass", "inline-secret", "inline-fragment"])
			expect(searchGlobalIndex(entries, query), query).toEqual([]);
		const result = searchGlobalIndex(entries, "example.test")[0];
		expect(result.secondary).toContain("https://example.test:8443/Public");
		expect(result.secondary).not.toContain("credential");
		expect(result.secondary).not.toContain("query-secret");
	});

	it.each(["bitwarden://vault-entry-secret", "onepassword://vault-entry-secret", "1password://vault-entry-secret", "custom+private://vault-entry-secret"])("excludes vault deep links: %s", (url) => {
		const current = asset("vault", { url, username: "Public account name", description: `Open ${url}` });
		const entries = index({ assets: [current] });
		expect(searchGlobalIndex(entries, "vault-entry-secret")).toEqual([]);
		expect(searchGlobalIndex(entries, "public account name")).toHaveLength(1);
		expect(entries[0].secondary).not.toContain(url);
	});

	it("removes 1password and other non-HTTP URI material from titles and contact text", () => {
		const entries = index({ assets: [asset("vault", {
			name: "Account 1password://title-private-ref", contact: "Desk custom+private://contact-private-ref",
		})] });
		for (const query of ["title-private-ref", "contact-private-ref", "1password://", "custom+private://"])
			expect(searchGlobalIndex(entries, query)).toEqual([]);
		const result = searchGlobalIndex(entries, "account")[0];
		expect(result.title).toBe("Account");
		expect(result.secondary).not.toContain("private-ref");
	});

	it("excludes malformed URL fields instead of retaining potentially sensitive raw input", () => {
		const entries = index({ assets: [asset("project", { url: "https://broken%credential-secret", projectPromoUrl: "javascript:promo-secret" })] });
		expect(searchGlobalIndex(entries, "credential-secret")).toEqual([]);
		expect(searchGlobalIndex(entries, "promo-secret")).toEqual([]);
	});

	it("excludes PDF candidate text and descriptions, including accepted assets by receipt reference", () => {
		const current = asset("item", { id: "receipt-reference", description: "pdf-original-secret", longDescription: "pdf-original-secret" });
		const receipt = candidate(current, { source: "pdf", fileName: "Camera.pdf", id: "pdf-review-reference" });
		Object.defineProperty(receipt, "sourceText", { get: () => { throw Error("PDF text read"); } });
		Object.defineProperty(receipt.asset, "description", { get: () => { throw Error("PDF draft description read"); } });
		const entries = index({ assets: [current], reviewedCandidates: [receipt] });
		expect(searchGlobalIndex(entries, "pdf-original-secret")).toEqual([]);
		expect(searchGlobalIndex(entries, "camera.pdf")[0].target).toEqual({ type: "intake", candidateId: receipt.id });
	});

	it("excludes a reviewed PDF merge description while retaining the target's ordinary unselected long description", () => {
		const current = asset("project", { description: "merged-pdf-original-secret", longDescription: "Ordinary unselected long profile" });
		const draft = asset("project", { id: `pdf-${"c".repeat(48)}`, name: "PDF candidate" });
		const receipt = Object.assign(candidate(draft, { source: "pdf", fileName: "Review.pdf" }), { mergeTargetId: current.id });
		const entries = index({ assets: [current], reviewedCandidates: [receipt] });
		expect(searchGlobalIndex(entries, "merged-pdf-original-secret")).toEqual([]);
		expect(searchGlobalIndex(entries, "Ordinary unselected long profile").map(row => row.target))
			.toEqual([{ type: "asset", kind: current.kind, assetId: current.id }]);
		const nameOnly = candidate(draft, { source: "pdf", fileName: "Name-only.pdf" });
		expect(searchGlobalIndex(index({ assets: [current], reviewedCandidates: [nameOnly] }), "merged-pdf-original-secret")).toHaveLength(1);
	});

	it("projects only a PDF description target ID and never reads source text, merge snapshots or unselected private fields", () => {
		const draft = asset("project"), target = asset("project");
		const merged = { ...candidate(draft, { source: "pdf" }), merge: { targetId: target.id, fields: ["description"],
			get before() { throw Error("private before read"); }, get after() { throw Error("private after read"); } },
			get sourceText() { throw Error("private source read"); } } as unknown as ReviewedCandidate;
		Object.defineProperty(merged.asset, "description", { get() { throw Error("private draft description read"); } });
		const publicRow = projectGlobalSearchCandidate(merged);
		expect(publicRow.mergeTargetId).toBe(target.id);
		for (const key of ["sourceText", "merge", "before", "after"]) expect(publicRow).not.toHaveProperty(key);
		expect(publicRow.asset).not.toHaveProperty("description");
		for (const patch of [{ source: undefined }, { merge: { targetId: target.id, fields: ["name"] } }]) {
			const changed = Object.assign(Object.create(merged) as ReviewedCandidate, patch);
			expect(projectGlobalSearchCandidate(changed).mergeTargetId).toBeUndefined();
		}
	});

	it("excludes descriptions of deterministic PDF assets when an old backup has no receipts", () => {
		const current = asset("item", { id: `pdf-${"b".repeat(48)}`, description: "legacy-pdf-secret" });
		expect(searchGlobalIndex(index({ assets: [current] }), "legacy-pdf-secret")).toEqual([]);
	});

	it("defers all descriptions while review provenance is loading, retaining public identifiers", () => {
		const current = asset("account", { description: "maybe-pdf-secret", longDescription: "maybe-pdf-secret", username: "visible@email.test" });
		const loading = index({ assets: [current], reviewedCandidatesLoaded: false });
		expect(searchGlobalIndex(loading, "maybe-pdf-secret")).toEqual([]);
		expect(searchGlobalIndex(loading, "visible@email.test")).toHaveLength(1);
		expect(searchGlobalIndex(index({ assets: [current] }), "maybe-pdf-secret")).toHaveLength(1);
	});

	it("does not index deleted assets even for empty queries", () => {
		const entries = index({ assets: [asset("item", { name: "Deleted camera", deleted: true })] });
		expect(searchGlobalIndex(entries, "")).toEqual([]);
		expect(searchGlobalIndex(entries, "camera")).toEqual([]);
	});

	it("uses the same financial actions and asset-kind eligibility as the real ledger", () => {
		const account = asset("account", { id: "account" }), subscription = asset("subscription", { id: "subscription" }), project = asset("project", { id: "project" });
		const rows = [history(account.id), history(account.id, { id: "renew-account", action: "renew" }),
			history(subscription.id, { id: "renew-subscription", action: "renew" }), history(project.id, { id: "project-expense" }),
			history("missing-asset", { id: "missing-expense" }), history(account.id, { id: "deleted-expense", deleted: true }),
			history(account.id, { id: "loan-event", action: "loan" })];
		const entries = index({ assets: [account, subscription, project], history: rows });
		expect(entries.filter((row) => row.source === "finance").map((row) => row.target))
			.toEqual([{ type: "finance", historyId: "history-operation-id" }, { type: "finance", historyId: "project-expense" }, { type: "finance", historyId: "renew-subscription" }]);
	});

	it("retains real ledger rows for soft-deleted assets without a broken asset target", () => {
		const current = asset("account", { id: "deleted-account", name: "Past account", deleted: true });
		const entries = index({ assets: [current], history: [history(current.id, { title: "Archived invoice" })] });
		expect(searchGlobalIndex(entries, "past account").map((row) => row.target))
			.toEqual([{ type: "finance", historyId: "history-operation-id" }]);
		expect(entries.some((row) => row.source === "asset")).toBe(false);
	});

	it("matches financial title, source, dates and exact display money without notes or operation IDs", () => {
		const current = asset("subscription", { id: "subscription-private-id" });
		const bill = history(current.id, { id: "financial-private-id", note: "private-note-needle", source: "Invoice desk", billDate: "2026-09-28" });
		const entries = index({ assets: [current], history: [bill] });
		for (const query of ["hosting bill", "invoice desk", "2026-09-29", "2026-09-28", "2026-09-30", "123.45", "USD", "EXPENSE"])
			expect(searchGlobalIndex(entries, query).some((row) => row.source === "finance"), query).toBe(true);
		for (const query of ["private-note-needle", "financial-private-id", "subscription-private-id"])
			expect(searchGlobalIndex(entries, query)).toEqual([]);
	});

	it.each([
		["USD", Number.MAX_SAFE_INTEGER, "90071992547409.91"],
		["JPY", 899, "899"],
	] as const)("keeps %s amounts exact in financial and accepted expense results", (currency, amount, query) => {
		const current = asset("account", { id: "account" });
		const receipt = candidate(current, { source: "pdf", reviewMode: "expense", historyId: "receipt-history", expenseDraft: {
			assetId: current.id, title: "Confirmed expense", amount: query, currency, eventDate: "2026-09-28", source: "Receipt source",
		} });
		const entries = index({ assets: [current], history: [history(current.id, { amount, currency })], reviewedCandidates: [receipt] });
		expect(searchGlobalIndex(entries, query).map((row) => row.source)).toEqual(["finance", "intake"]);
	});

	it("sanitizes URLs appearing in financial and receipt source text", () => {
		const current = asset("account");
		const source = "https://source-user:source-pass@invoice.test/Bill?token=source-token#source-fragment";
		const receipt = candidate(current, { source: "pdf", reviewMode: "expense", expenseDraft: {
			assetId: current.id, title: "Invoice", amount: "123.45", currency: "USD", eventDate: "2026-09-28", source,
		} });
		const entries = index({ assets: [current], history: [history(current.id, { source })], reviewedCandidates: [receipt] });
		expect(searchGlobalIndex(entries, "invoice.test/bill").map((row) => row.source)).toEqual(["finance", "intake"]);
		for (const query of ["source-user", "source-pass", "source-token", "source-fragment"])
			expect(searchGlobalIndex(entries, query)).toEqual([]);
	});

	it("indexes only accepted receipts and preserves both asset and expense receipt targets", () => {
		const current = asset("project", { name: "Collected project", url: "https://collected.test/Guide" });
		const rows = [candidate(current), candidate(current, { id: "pending-reference", status: "pending", fileName: "Pending.csv" }),
			candidate(current, { id: "ignored-reference", status: "ignored", fileName: "Ignored.csv" })];
		const entries = index({ reviewedCandidates: rows });
		expect(searchGlobalIndex(entries, "collected.test/guide")[0].target).toEqual({ type: "intake", candidateId: rows[0].id });
		expect(searchGlobalIndex(entries, "pending.csv")).toEqual([]);
		expect(searchGlobalIndex(entries, "ignored.csv")).toEqual([]);
		expect(searchGlobalIndex(entries, "accepted")).toHaveLength(1);
	});

	it("does not index expense notes, receipt hash, internal IDs or raw invalid amount text", () => {
		const current = asset("account");
		const receipt = Object.assign(candidate(current, { id: "private-review-id", historyId: "private-history-id", source: "pdf", reviewMode: "expense", expenseDraft: {
			assetId: current.id, title: "Confirmed expense", amount: "invalid-amount-secret", currency: "CNY", eventDate: "2026-09-29", source: "Invoice desk",
		} }), { sourceText: "pdf-text-secret", fileHash: "file-hash-secret" });
		Object.assign(receipt.expenseDraft ?? {}, { note: "private-expense-note" });
		const entries = index({ reviewedCandidates: [receipt] });
		for (const query of ["private-review-id", "private-history-id", "invalid-amount-secret", "pdf-text-secret", "file-hash-secret", "private-expense-note"])
			expect(searchGlobalIndex(entries, query), query).toEqual([]);
		expect(searchGlobalIndex(entries, "confirmed expense")).toHaveLength(1);
	});

	it("does not parse or index oversized amount text from a malformed receipt projection", () => {
		const current = asset("account");
		const receipt = candidate(current, { source: "pdf", reviewMode: "expense", expenseDraft: {
			assetId: current.id, title: "Receipt", amount: "9".repeat(1000000), currency: "USD", eventDate: "2026-09-28", source: "Invoice desk",
		} });
		const entries = index({ reviewedCandidates: [receipt] });
		expect(searchGlobalIndex(entries, "99999999")).toEqual([]);
		expect(searchGlobalIndex(entries, "invoice desk")).toHaveLength(1);
	});

	it("limits tasks to ordinary visible titles, due dates, state and live related asset names", () => {
		const current = asset("item", { id: "linked-item", name: "Camera" });
		const ordinary = task({ assetId: current.id, name: "Check camera", done: true });
		const complex = [
			{ ...task({ id: "impact-task", name: "Private impact" }), impactSnapshot: {} as NonNullable<Task["impactSnapshot"]> },
			{ ...task({ id: "workflow-task", name: "Private workflow" }), projectWorkflow: {} as NonNullable<Task["projectWorkflow"]> },
			{ ...task({ id: "maintenance-task", name: "Private maintenance" }), maintenancePlan: {} as NonNullable<Task["maintenancePlan"]> },
			task({ id: "deleted-task", name: "Private deleted task", deleted: true }),
		];
		const entries = index({ assets: [current], tasks: [ordinary, ...complex] });
		for (const query of ["check camera", "2026-10-01", "done"])
			expect(searchGlobalIndex(entries, query).some((row) => row.source === "task")).toBe(true);
		expect(searchGlobalIndex(entries, "private")).toEqual([]);
		expect(searchGlobalIndex(entries, "task-operation-id")).toEqual([]);
	});

	it("does not index missing or deleted task relations, dedupe keys or completion timestamps", () => {
		const deleted = asset("item", { id: "deleted-relation", name: "Deleted relation secret", deleted: true });
		const entries = index({ assets: [deleted], tasks: [task({ assetId: deleted.id, dedupeKey: "dedupe-secret", completedAt: "completion-secret", completionHistory: ["history-secret"] })] });
		for (const query of ["deleted-relation", "deleted relation secret", "dedupe-secret", "completion-secret", "history-secret"])
			expect(searchGlobalIndex(entries, query)).toEqual([]);
		expect(searchGlobalIndex(entries, "check bill")).toHaveLength(1);
	});

	it("consumes translated labels without importing UI state or hardcoding English enums", () => {
		const current = asset("account", { name: "工作邮箱" });
		const entries = index({ assets: [current], history: [history(current.id, { title: "服务器账单" })], reviewedCandidates: [candidate(current)],
			tasks: [task({ name: "检查账单" })], locale: "zh-CN", labels: zhLabels });
		expect(searchGlobalIndex(entries, "账号")[0].source).toBe("asset");
		expect(searchGlobalIndex(entries, "支出")[0].source).toBe("finance");
		expect(searchGlobalIndex(entries, "已确认")[0].source).toBe("intake");
		expect(searchGlobalIndex(entries, "待完成")[0].source).toBe("task");
		expect(searchGlobalIndex(entries, "pending")).toEqual([]);
	});

	it("does not mutate input snapshots and rebuilds from changed repository values", () => {
		const current = Object.freeze(asset("account", { name: "Old name" }));
		const assets = Object.freeze([current]);
		const before = index({ assets });
		const after = index({ assets: [{ ...current, name: "New name" }] });
		expect(searchGlobalIndex(before, "old name")).toHaveLength(1);
		expect(searchGlobalIndex(after, "old name")).toEqual([]);
		expect(searchGlobalIndex(after, "new name")).toHaveLength(1);
		expect(current.name).toBe("Old name");
	});
	it("indexes an older project without domain fields without rewriting or exposing private notes", () => {
		const legacy = asset("project", { name: "Legacy travel project", notes: "private recovery phrase" });
		Reflect.deleteProperty(legacy, "projectDomains");
		const snapshot = JSON.stringify(legacy);
		const entries = index({ assets: [legacy] });
		expect(searchGlobalIndex(entries, "travel project")).toHaveLength(1);
		expect(searchGlobalIndex(entries, "private recovery phrase")).toEqual([]);
		expect(JSON.stringify(legacy)).toBe(snapshot);
	});

});
