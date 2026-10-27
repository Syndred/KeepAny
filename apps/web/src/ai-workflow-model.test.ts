import { describe, expect, it } from "vitest";
import { historySchema, newAsset, taskSchema } from "../../../packages/domain/src";
import { reviewedCandidateSchema } from "../../../packages/local-db/src/intake-review";
import {
	aiImportSchema,
	buildAiCandidates,
	executeSearchPlan,
	parseAiJson,
	reminderPlanSchema,
	searchPlanSchema,
} from "./ai-workflow-model";

const hash = "a".repeat(64);
const source = "Studio hosting 每月 USD 12.50，2026-10-15续费";
const output = () =>
	aiImportSchema.parse({
		records: [
			{
				kind: "subscription",
				name: "Studio hosting",
				amount: "12.50",
				currency: "USD",
				cycle: "month",
				dueDate: "2026-10-15",
				evidence: source,
			},
		],
	});
const input = {
	hash,
	name: "synthetic.txt",
	text: source,
	provider: "deepseek",
	model: "test-model",
};

describe("AI proposals stay bounded and require source-backed review", () => {
	it("produces stable draft IDs and exact minor units, without parsing source instructions", () => {
		const row = buildAiCandidates(output(), input)[0];
		expect(row.asset.amount).toBe(1250);
		expect(row.status).toBe("pending");
		expect(reviewedCandidateSchema.parse(row).ai?.evidence).toBe(source);
		expect(buildAiCandidates(output(), input)[0].id).toBe(row.id);
		expect(() =>
			buildAiCandidates(
				{
					...output(),
					records: [{ ...output().records[0], evidence: "invented source" }],
				},
				input,
			),
		).toThrow("ai-evidence");
		expect(() =>
			aiImportSchema.parse({
				records: [{ kind: "vault", name: "Secret", evidence: source }],
			}),
		).toThrow();
		expect(() =>
			parseAiJson('{"records":[],"tools":["delete"]}'),
		).not.toThrow();
		expect(() =>
			aiImportSchema.parse(parseAiJson('{"records":[],"tools":["delete"]}')),
		).toThrow();
	});
	it("normalizes the bounded null fields and auxiliary missing fields returned by DeepSeek", () => {
		const projectSource =
			"项目：DS 验收项目，网址 https://keepany.example.test/project。";
		const parsed = aiImportSchema.parse({
			text: "",
			records: [
				{
					kind: "project",
					name: "DS 验收项目",
					url: "https://keepany.example.test/project",
					description: null,
					category: null,
					tags: null,
					amount: null,
					currency: null,
					cycle: null,
					interval: null,
					dueDate: null,
					evidence: projectSource,
					relatedName: null,
					missingFields: [
						"description",
						"category",
						"tags",
						"amount",
						"currency",
						"cycle",
						"interval",
						"dueDate",
						"relatedName",
					],
				},
			],
		});
		expect(parsed.records[0]).toMatchObject({
			description: "",
			category: "",
			tags: [],
			relatedName: "",
			amount: null,
			currency: null,
			cycle: null,
			interval: null,
			dueDate: null,
			missingFields: ["amount", "currency", "cycle", "dueDate"],
		});
		const row = buildAiCandidates(parsed, { ...input, text: projectSource })[0];
		expect(reviewedCandidateSchema.parse(row).ai?.missingFields).toEqual([]);
		expect(row.asset.url).toBe("https://keepany.example.test/project");
		expect(row.status).toBe("pending");
		expect(parsed.records[0].username).toBe("");

		const subscription = aiImportSchema.parse({
			records: [
				{
					...output().records[0],
					url: null,
					description: null,
					category: null,
					tags: null,
					relatedName: null,
					missingFields: ["url", "description", "tags", "interval"],
				},
			],
		});
		const subscriptionRow = buildAiCandidates(subscription, input)[0];
		expect(subscriptionRow.asset.amount).toBe(1250);
		expect(subscriptionRow.asset.currency).toBe("USD");
		expect(subscriptionRow.asset.url).toBe("");
		expect(subscriptionRow.ai?.missingFields).toEqual([]);
		expect(
			reviewedCandidateSchema.safeParse({
				...subscriptionRow,
				status: "accepted",
			}).success,
		).toBe(true);
	});
	it("keeps explicit account identifiers source-backed and preserves login methods", () => {
		const accountSource =
			"登录清单：Gmail=reader@example.test；GitHub 登录。";
		const parsed = aiImportSchema.parse({
			records: [
				{
					kind: "account",
					name: "Studio mail",
					username: "  reader@example.test  ",
					evidence: "Gmail=reader@example.test",
				},
				{
					kind: "account",
					name: "Code hosting login",
					username: null,
					description: "GitHub 登录",
					evidence: "GitHub 登录",
				},
			],
		});
		expect(parsed.records[0].username).toBe("reader@example.test");
		expect(parsed.records[1].username).toBe("");
		const rows = buildAiCandidates(parsed, { ...input, text: accountSource });
		expect(rows[0].asset.username).toBe("reader@example.test");
		expect(rows[1].asset.username).toBe("");
		expect(rows[1].asset.description).toBe("GitHub 登录");

		const missingSourceUsername = aiImportSchema.parse({
			records: [
				{
					kind: "account",
					name: "Studio mail",
					username: "reader@example.test",
					evidence: "登录清单",
				},
			],
		});
		expect(() =>
			buildAiCandidates(missingSourceUsername, {
				...input,
				text: "登录清单：GitHub 登录。",
			}),
		).toThrow("ai-username");
	});
	it("rejects unknown structure and invalid values while normalizing optional nulls", () => {
		const record = {
			...output().records[0],
			description: null,
			tags: null,
		};
		for (const patch of [
			{ amount: 12.5 },
			{ currency: "BTC" },
			{ cycle: "monthly" },
			{ interval: 0 },
			{ dueDate: "2026-02-30" },
			{ kind: "vault" },
			{ kind: null },
			{ name: null },
			{ evidence: null },
			{ description: 1 },
			{ description: "x".repeat(2001) },
			{ tags: [null] },
			{ relatedName: {} },
			{ username: 1 },
			{ username: "x".repeat(301) },
			{ kind: "project", username: "project-login" },
			{ missingFields: ["password"] },
			{ missingFields: ["description", "unknown"] },
			{ missingFields: Array(12).fill("tags") },
			{ unknown: null },
		])
			expect(
				aiImportSchema.safeParse({ records: [{ ...record, ...patch }] })
					.success,
			).toBe(false);
		expect(
			aiImportSchema.safeParse({ text: null, records: [record] }).success,
		).toBe(false);
		expect(
			aiImportSchema.safeParse({ records: [record], unknown: null }).success,
		).toBe(false);
	});
	it("rejects bad money, impossible dates and unbounded output", () => {
		expect(() =>
			buildAiCandidates(
				{
					...output(),
					records: [{ ...output().records[0], amount: "12.501" }],
				},
				input,
			),
		).toThrow();
		expect(() =>
			aiImportSchema.parse({
				records: [
					{
						kind: "subscription",
						name: "Test",
						dueDate: "2026-02-30",
						evidence: source,
					},
				],
			}),
		).toThrow();
		expect(() => parseAiJson("x".repeat(120001))).toThrow();
		expect(parseAiJson('```json\n{"records":[]}\n```')).toEqual({
			records: [],
		});
	});
	it("cannot accept unknown subscription billing fields as default values", () => {
		const unknown = aiImportSchema.parse({
			records: [{ kind: "subscription", name: "Unknown", evidence: source }],
		});
		const row = buildAiCandidates(unknown, input)[0];
		expect(row.ai?.missingFields).toEqual(
			expect.arrayContaining(["amount", "currency", "cycle"]),
		);
		expect(
			reviewedCandidateSchema.safeParse({ ...row, status: "accepted" }).success,
		).toBe(false);
		expect(
			reviewedCandidateSchema.safeParse({
				...row,
				ai: { ...row.ai, missingFields: ["dueDate"] },
				status: "accepted",
			}).success,
		).toBe(true);
	});
});

describe("queries use local data and exact calculations", () => {
	const asset = (name: string, overrides = {}) => ({
		...newAsset("subscription"),
		name,
		id: name,
		amount: 1250,
		currency: "USD" as const,
		dueDate: "2026-10-15",
		...overrides,
	});
	it("filters active due subscriptions, excludes deleted and vault, sums by currency", () => {
		const data = {
			assets: [
				asset("Monthly"),
				asset("Annual", { amount: 12000, cycle: "year" }),
				asset("Paused", { status: "paused" }),
				asset("Deleted", { deleted: true }),
				{ ...newAsset("vault"), name: "Vault", id: "vault" },
				asset("RMB", { currency: "CNY", amount: 500 }),
			],
			tasks: [],
			relations: [],
			history: [],
		};
		const plan = searchPlanSchema.parse({
			scope: "assets",
			kind: "subscription",
			dateFrom: "2026-10-01",
			dateTo: "2026-10-31",
			aggregate: "monthlyTotal",
		});
		const result = executeSearchPlan(plan, data);
		expect(result.count).toBe(3);
		expect(result.totals.get("USD")).toBe(2250n);
		expect(result.totals.get("CNY")).toBe(500n);
		expect(() =>
			searchPlanSchema.parse({
				scope: "assets",
				dateFrom: "2026-11-01",
				dateTo: "2026-10-01",
			}),
		).toThrow();
	});
	it("requires a unique relation center and returns actual linked IDs", () => {
		const project = { ...newAsset("project"), id: "p", name: "Studio" },
			account = { ...newAsset("account"), id: "a", name: "Host login" };
		const relation = {
			id: "r",
			from: "p",
			to: "a",
			label: "Uses",
			createdAt: "",
			verifiedAt: "",
			deleted: false,
		};
		const plan = searchPlanSchema.parse({
			scope: "relations",
			relatedQuery: "Studio",
			kind: "account",
		});
		expect(
			executeSearchPlan(plan, {
				assets: [project, account],
				tasks: [],
				relations: [relation],
				history: [],
			}).results.map((row) => row.id),
		).toEqual(["a"]);
		expect(
			executeSearchPlan(plan, {
				assets: [project, { ...project, id: "p2" }, account],
				tasks: [],
				relations: [relation],
				history: [],
			}).ambiguous,
		).toBe(true);
	});
	it("applies task state and date filters locally", () => {
		const task = taskSchema.parse({
			id: "t",
			name: "Review hosting",
			dueDate: "2026-10-03",
			createdAt: "",
		});
		expect(
			executeSearchPlan(
				searchPlanSchema.parse({
					scope: "tasks",
					taskDone: false,
					query: "hosting",
				}),
				{
					assets: [],
					tasks: [task, { ...task, id: "done", done: true }],
					relations: [],
					history: [],
				},
			).results.map((row) => row.id),
		).toEqual(["t"]);
	});
});

it("normalizes nullable query strings without accepting invalid search plans", () => {
	const base = { scope: "assets", query: null, relatedQuery: null };
	expect(searchPlanSchema.parse(base)).toMatchObject({
		query: "",
		relatedQuery: "",
	});
	for (const patch of [
		{ query: 1 },
		{ query: {} },
		{ query: "x".repeat(161) },
		{ relatedQuery: [] },
		{ relatedQuery: "x".repeat(161) },
		{ scope: null },
		{ kind: "vault" },
		{ dateFrom: "2026-02-30" },
		{ aggregate: null },
		{ unknown: null },
	])
		expect(searchPlanSchema.safeParse({ ...base, ...patch }).success).toBe(
			false,
		);
});

it("queries shared bills once through any ordinary owner kind and uses corrected renewal values and dates", () => {
	const project = { ...newAsset("project"), name: "Studio" }, item = { ...newAsset("item"), name: "Camera" }, subscription = newAsset("subscription");
	const shared = historySchema.parse({ id: "shared-bill", assetId: project.id, assetIds: [project.id,item.id], action: "expense", title: "Equipment invoice",
		note: "", eventDate: "2026-10-24", amount: 1001, currency: "CNY", createdAt: "2026-10-27T00:00:00Z" });
	const renewal = historySchema.parse({ id: "renewal-bill", assetId: subscription.id, action: "renew", note: "Original fact", title: "Original renewal",
		billDate: "2026-09-27", amount: 2000, currency: "CNY", createdAt: "2026-10-27T00:00:00Z", financeCorrection: {
			title: "Corrected renewal", note: "Corrected bill", eventDate: "2026-10-25", amount: 3001, currency: "JPY", assetIds: [item.id] } });
	const data = { assets: [project,item,subscription], tasks: [], relations: [], history: [shared,renewal] };
	const results = executeSearchPlan(searchPlanSchema.parse({ scope: "finance", kind: "item", dateFrom: "2026-10-01", dateTo: "2026-10-31" }), data);
	expect(results.results.map(row => row.id)).toEqual([shared.id,renewal.id]);
	expect(results.results[1].history).toMatchObject({ amount: 3001, currency: "JPY", eventDate: "2026-10-25", note: "Corrected bill" });
	expect(executeSearchPlan(searchPlanSchema.parse({ scope: "finance", query: "Corrected renewal" }), data).count).toBe(1);
	expect(executeSearchPlan(searchPlanSchema.parse({ scope: "finance", query: "Original renewal" }), data).count).toBe(0);
	expect(renewal.amount).toBe(2000); expect(renewal.billDate).toBe("2026-09-27");
});

it("excludes hidden renewal bills and bills owned only by deleted or vault records from local AI finance lookup", () => {
	const account = newAsset("account"), vault = newAsset("vault"), deleted = { ...newAsset("item"), deleted: true };
	const base = historySchema.parse({ id: "hidden-bill", assetId: account.id, action: "renew", note: "", amount: 1,
		currency: "CNY", billDate: "2026-10-25", createdAt: "2026-10-27T00:00:00Z", financeCorrection: {
			note: "", eventDate: "2026-10-25", amount: 1, currency: "CNY", hidden: true } });
	const histories = [base, { ...base, id: "vault-bill", financeCorrection: undefined, assetId: vault.id },
		{ ...base, id: "deleted-owner-bill", financeCorrection: undefined, assetId: deleted.id },
		{ ...base, id: "vault-source-linked-bill", assetId: vault.id, financeCorrection: { ...base.financeCorrection,
			note: "", eventDate: "2026-10-25", amount: 1, currency: "CNY" as const, hidden: false, assetIds: [account.id] } }];
	expect(executeSearchPlan(searchPlanSchema.parse({ scope: "finance" }), { assets: [account,vault,deleted], tasks: [], relations: [], history: histories }).count).toBe(0);
});

it("accepts DeepSeek's null subscription reminder queries as unresolved empty strings", () => {
	const actualResponse = {
		operation: "subscription",
		name: "DS 验收订阅续费提醒",
		taskQuery: null,
		assetQuery: null,
		localDate: null,
		localTime: "09:00",
		timeZone: "Asia/Shanghai",
		leadMinutes: 0,
		leadDays: 3,
		rule: { mode: "once" },
	};
	expect(reminderPlanSchema.parse(actualResponse)).toEqual({
		...actualResponse,
		taskQuery: "",
		assetQuery: "",
	});
	expect(reminderPlanSchema.parse({ ...actualResponse, name: null }).name).toBe(
		"",
	);
	for (const patch of [
		{ name: 1 },
		{ name: "x".repeat(301) },
		{ taskQuery: {} },
		{ taskQuery: "x".repeat(301) },
		{ assetQuery: [] },
		{ assetQuery: "x".repeat(161) },
		{ operation: null },
		{ timeZone: null },
		{ localDate: "2026-02-30" },
		{ leadMinutes: null },
		{ leadDays: "3" },
		{ rule: { mode: "delete" } },
		{ unknown: null },
	])
		expect(
			reminderPlanSchema.safeParse({ ...actualResponse, ...patch }).success,
		).toBe(false);
});

it("rejects edited invalid reminder zones, limits and unknown operations", () => {
	const base = {
		operation: "create",
		timeZone: "Asia/Shanghai",
		localDate: "2026-10-03",
		localTime: "09:00",
	};
	expect(reminderPlanSchema.parse(base).leadMinutes).toBe(0);
	for (const patch of [
		{ timeZone: "Made/up" },
		{ localTime: "25:00" },
		{ leadMinutes: -1 },
		{ leadDays: 3651 },
		{ operation: "delete" },
	])
		expect(reminderPlanSchema.safeParse({ ...base, ...patch }).success).toBe(
			false,
		);
});
