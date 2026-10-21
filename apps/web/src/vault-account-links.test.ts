import { describe, it, expect } from "vitest";
import {
	newAsset,
	type Asset,
	type Relation,
} from "../../../packages/domain/src";
import {
	accountLinkRelations,
	aiAccountLinkInput,
	buildAccountLinkRows,
	normalizeLoginIdentifier,
	publicAccountUrl,
	readAiAccountLinks,
	sharedIdentifierSuggestions,
} from "./vault-account-links";
import { accountFamilyGraph } from "./account-family-graph";
const entry = (id: string, title: string, username: string) => ({
	id,
	title,
	username,
	usernameAliases: [],
	url: "https://example.test/login?token=private#private",
	linkedAssetIds: [],
	modifiedAt: "2026-10-21T00:00:00Z",
	historyCount: 0,
});
describe("reviewed vault account associations", () => {
	it("creates public metadata only and keeps account identity stable on retry", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "Google", "A@example.test"),
				entry("b", "Notion", "a@example.test"),
			],
			[],
		);
		expect(rows[0].account).toMatchObject({
			notes: "",
			description: "",
			username: "A@example.test",
			url: "https://example.test",
		});
		expect(rows[0].account.id).not.toBe(rows[1].account.id);
		const retry = await buildAccountLinkRows(
			[entry("a", "Google", "A@example.test")],
			rows.map((r) => r.account),
		);
		expect(retry[0]).toMatchObject({ account: rows[0].account, isNew: false });
		expect(sharedIdentifierSuggestions(rows)).toHaveLength(1);
		expect(aiAccountLinkInput(rows)).not.toMatch(
			/password|linkedAssetIds|token=|private/,
		);
	});
	it("reuses a single new account for duplicate entries within the same review", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "Google", "a@example.test"),
				entry("b", "Google", "a@example.test"),
			],
			[],
		);
		expect(rows[0].account.id).toBe(rows[1].account.id);
		expect(rows.every((row) => row.isNew)).toBe(true);
	});

	it("matches only email and normalized phone, never common handles", () => {
		expect(normalizeLoginIdentifier("+44 7700 900123")).toBe(
			normalizeLoginIdentifier("+44 (7700) 900123"),
		);
		expect(normalizeLoginIdentifier("admin")).toBe("");
		expect(normalizeLoginIdentifier("abc@gmail.com")).not.toBe(
			normalizeLoginIdentifier("ab.c@gmail.com"),
		);
		expect(
			publicAccountUrl("https://user:password@example.test/a?token=x"),
		).toBe("https://example.test");
	});
	it("rejects ambiguous and deleted account matches instead of overwriting", async () => {
		const e = entry("a", "Google", "a@example.test");
		const [row] = await buildAccountLinkRows([e], []);
		await expect(
			buildAccountLinkRows([e], [{ ...row.account, deleted: true }]),
		).rejects.toThrow();
		await expect(
			buildAccountLinkRows(
				[e],
				[
					{ ...row.account, id: "one" },
					{ ...row.account, id: "two" },
				],
			),
		).rejects.toThrow();
	});
	it("validates AI endpoints and secrets; outputs require caller review", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "Google", "a@example.test"),
				entry("b", "Notion", "a@example.test"),
			],
			[],
		);
		expect(() =>
			readAiAccountLinks(
				{
					relations: [
						{
							from: "invented",
							to: rows[0].account.id,
							kind: "login",
							evidence: "guess",
						},
					],
				},
				rows,
			),
		).toThrow();
		expect(() =>
			aiAccountLinkInput([{ ...rows[0], hint: "password: secret-value" }]),
		).toThrow();
		expect(() =>
			readAiAccountLinks(
				{
					relations: [
						{
							from: rows[0].account.id,
							to: rows[0].account.id,
							kind: "login",
							evidence: "x",
						},
					],
				},
				rows,
			),
		).toThrow();
	});
	it("deduplicates confirmed edges across retries and locale changes", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "Google", "a@example.test"),
				entry("b", "Notion", "a@example.test"),
			],
			[],
		);
		const suggested = sharedIdentifierSuggestions(rows);
		const saved = await accountLinkRelations(
			suggested,
			[],
			() => "相同登录标识",
		);
		expect(saved).toHaveLength(1);
		expect(
			await accountLinkRelations(
				suggested,
				saved,
				() => "Shared login identifier",
			),
		).toEqual([]);
		expect(
			await accountLinkRelations(
				suggested,
				[{ ...saved[0], deleted: true }],
				() => "Shared login identifier",
			),
		).toEqual([]);
	});
	it("shows the full connected family, including cycles, without crossing deleted nodes", () => {
		const assets = new Map(
			["a", "b", "c", "d"].map(
				(id) => [id, { ...newAsset("account"), id }] as [string, Asset],
			),
		);
		const rel = (from: string, to: string): Relation => ({
			id: from + to,
			from,
			to,
			label: "link",
			createdAt: "",
			verifiedAt: "",
			deleted: false,
		});
		const result = accountFamilyGraph("a", assets, [
			rel("a", "b"),
			rel("b", "c"),
			rel("c", "a"),
			{ ...rel("c", "d"), deleted: true },
		]);
		expect(result.neighbors.map((a) => a.id).sort()).toEqual(["b", "c"]);
		expect(result.relations).toHaveLength(3);
		expect(result.positions.get("b")).not.toEqual(result.positions.get("c"));
	});
});
