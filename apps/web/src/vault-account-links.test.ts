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
	buildAccountLinkSavePlan,
	normalizeLoginIdentifier,
	publicAccountUrl,
	readAiAccountLinks,
	sharedIdentifierSuggestions,
	suggestAccountCategory,
} from "./vault-account-links";
import { accountIdentityStableId } from "./account-identities";
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
	it("prefills editable hints and includes all selected identifiers without copying notes to accounts", async () => {
		const rows = await buildAccountLinkRows(
			[
				{
					...entry("a", "Google", "a@example.test"),
					usernameAliases: [
						"backup@example.test",
						"+44 7700 900123",
						"handle-a",
					],
				},
				{
					...entry("b", "Other", "b@example.test"),
					usernameAliases: ["unselected@example.test"],
				},
			],
			[],
			new Map([
				["a", "Original recovery hint"],
				["b", "Unselected note"],
			]),
		);
		expect(rows[0].hint).toBe("Original recovery hint");
		expect(rows[0].account.notes).toBe("");
		expect(rows[0].loginIdentifiers).toEqual([
			"a@example.test",
			"backup@example.test",
			"+44 7700 900123",
			"handle-a",
		]);
		const input = aiAccountLinkInput([{ ...rows[0], hint: "Edited hint" }]);
		expect(JSON.parse(input)[0]).toMatchObject({
			hint: "Edited hint",
			loginIdentifiers: rows[0].loginIdentifiers,
		});
		expect(input).not.toMatch(
			/Original recovery hint|Unselected note|unselected@example/,
		);
		expect(
			JSON.parse(aiAccountLinkInput([{ ...rows[0], hint: "" }]))[0].hint,
		).toBe("");
		expect(() =>
			aiAccountLinkInput([
				{ ...rows[0], loginIdentifiers: ["password: secret"] },
			]),
		).toThrow();
	});
	it("keeps long notes intact for review and blocks sending until shortened", async () => {
		const long = "x".repeat(501);
		const rows = await buildAccountLinkRows(
			[entry("a", "Google", "a@example.test")],
			[],
			new Map([["a", long]]),
		);
		expect(rows[0].hint).toBe(long);
		expect(() => aiAccountLinkInput(rows)).toThrow();
		expect(() =>
			aiAccountLinkInput([{ ...rows[0], hint: long.slice(0, 500) }]),
		).not.toThrow();
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
		expect(normalizeLoginIdentifier("2020034943091")).toBe("");
		expect(normalizeLoginIdentifier("875306537")).toBe("");
		expect(normalizeLoginIdentifier("+86 138-0013-8000")).toBe(
			normalizeLoginIdentifier("13800138000"),
		);
		expect(normalizeLoginIdentifier("abc@gmail.com")).not.toBe(
			normalizeLoginIdentifier("ab.c@gmail.com"),
		);
		expect(
			publicAccountUrl("https://user:password@example.test/a?token=x"),
		).toBe("https://example.test");
	});
	it("classifies mailbox and phone records without misclassifying services using those identifiers", () => {
		expect(
			suggestAccountCategory(entry("mail", "Gmail QA", "qa.owner@gmail.com")),
		).toBe("email");
		expect(
			suggestAccountCategory(entry("outlook", "outlook1", "owner@outlook.com")),
		).toBe("email");
		expect(
			suggestAccountCategory(entry("google", "谷歌3", "owner@gmail.com")),
		).toBe("email");
		expect(
			suggestAccountCategory(entry("phone", "手机号", "13800138000")),
		).toBe("phone");
		expect(
			suggestAccountCategory(entry("phone", "+86 13800138000", "13800138000")),
		).toBe("phone");
		for (const title of [
			"学信网",
			"尼康",
			"Google app",
			"Google Cloud",
			"Notion",
			"Phone service QA",
		])
			expect(suggestAccountCategory(entry(title, title, "13800138000"))).toBe(
				"other",
			);
		expect(
			suggestAccountCategory(
				entry("google-app", "Google app", "qa.owner@gmail.com"),
			),
		).toBe("other");
	});
	it("uses stable identity nodes rather than an arbitrary service as a shared-identifier hub", async () => {
		const rows = await buildAccountLinkRows(
			[
				{
					...entry("a", "Bybit", "owner@example.test"),
					usernameAliases: ["13800138000"],
				},
				{
					...entry("b", "Notion", "OWNER@example.test"),
					usernameAliases: ["+86 13800138000"],
				},
				entry("c", "University", "2020034943091"),
			],
			[],
		);
		const suggested = sharedIdentifierSuggestions(rows);
		expect(suggested).toHaveLength(4);
		expect(
			suggested.filter((item) => item.identifierKind === "email"),
		).toHaveLength(2);
		expect(new Set(suggested.map((item) => item.to)).size).toBe(2);
		expect(
			suggested.every(
				(item) => !rows.some((row) => row.account.id === item.to),
			),
		).toBe(true);
		const plan = await buildAccountLinkSavePlan(
			rows,
			suggested,
			[],
			[],
			(_kind, identity) =>
				identity === "email" ? "Login email" : "Login phone",
		);
		expect(plan.newAssets).toHaveLength(5);
		expect(plan.newRelations).toHaveLength(4);
		const email = plan.newAssets.find((asset) => asset.category === "email");
		expect(email?.id).toBe(
			await accountIdentityStableId("login-identity", [
				"email",
				"example.test",
				"owner@example.test",
			]),
		);
		for (const relation of plan.newRelations) {
			expect(relation.id).toBe(
				await accountIdentityStableId("login-link", [
					relation.from,
					relation.label === "Login email" ? "email" : "phone",
					relation.to,
				]),
			);
			expect(relation.from).not.toBe(relation.to);
		}
	});
	it("reuses a selected mailbox itself, without importing an unselected password entry", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("mail", "Gmail QA", "owner@gmail.com"),
				entry("service", "Notion", "owner@gmail.com"),
			],
			[],
		);
		const all = sharedIdentifierSuggestions(rows);
		expect(all).toEqual([
			expect.objectContaining({
				from: rows[1].account.id,
				to: rows[0].account.id,
				identifierKind: "email",
			}),
		]);
		const plan = await buildAccountLinkSavePlan(
			rows,
			all,
			[],
			[],
			() => "Login email",
		);
		expect(plan.newAssets).toHaveLength(2);
		const onlyService = sharedIdentifierSuggestions([rows[1]]);
		expect(onlyService[0].to).not.toBe(rows[0].account.id);
		const selectedPlan = await buildAccountLinkSavePlan(
			[rows[1]],
			onlyService,
			[],
			[],
			() => "Login email",
		);
		expect(selectedPlan.newAssets).toHaveLength(2);
		expect(
			selectedPlan.newAssets.some((asset) => asset.name === "Gmail QA"),
		).toBe(false);
	});
	it("does not create unselected identity nodes and respects intentionally deleted identity relationships", async () => {
		const rows = await buildAccountLinkRows(
			[entry("service", "Notion", "owner@example.test")],
			[],
		);
		const suggested = sharedIdentifierSuggestions(rows);
		const none = await buildAccountLinkSavePlan(
			rows,
			[],
			[],
			[],
			() => "Login email",
		);
		expect(none.newAssets).toEqual([rows[0].account]);
		const saved = await accountLinkRelations(
			suggested,
			[],
			() => "Login email",
		);
		const deleted = await buildAccountLinkSavePlan(
			rows,
			suggested,
			[],
			[{ ...saved[0], deleted: true }],
			() => "登录邮箱",
		);
		expect(deleted.newRelations).toEqual([]);
		expect(deleted.newAssets).toEqual([rows[0].account]);
	});
	it("reuses existing intake identities, preserves manual categories and previews current vault metadata", async () => {
		const original = {
			...newAsset("account"),
			id: "existing-service",
			name: "Old service",
			username: "old@example.test",
			url: "https://old.test",
			category: "Work",
			notes: "Keep manual notes",
			description: "Keep purpose",
		};
		const mail = {
			...newAsset("account"),
			id: "existing-mail",
			category: "email",
			name: "My mail",
			username: "owner@example.test",
			accountProvider: "Custom mail",
			notes: "Keep mail notes",
		};
		const source = {
			...entry("service", "Notion", "owner@example.test"),
			linkedAssetIds: [original.id],
		};
		const rows = await buildAccountLinkRows([source], [original, mail]);
		expect(rows[0].originalAccount).toEqual(original);
		expect(rows[0].account).toMatchObject({
			id: original.id,
			name: "Notion",
			username: "owner@example.test",
			category: "Work",
			notes: original.notes,
			description: original.description,
		});
		expect(rows[0].loginIdentifiers).not.toContain(original.username);
		const suggested = sharedIdentifierSuggestions(rows);
		expect(suggested[0].to).toBe(mail.id);
		const plan = await buildAccountLinkSavePlan(
			rows,
			suggested,
			[original, mail],
			[],
			() => "Login email",
		);
		expect(plan.newAssets).toEqual([]);
		expect(plan.accountUpdates).toHaveLength(1);
		expect(plan.accountUpdates[0].next.category).toBe("Work");
		expect(plan.expectedAssets).toContainEqual(mail);
		expect(plan.expectedAssets).toContainEqual(plan.accountUpdates[0].next);
		const categoryEdited = [
			{ ...rows[0], account: { ...rows[0].account, category: "Tools" } },
		];
		expect(
			(
				await buildAccountLinkSavePlan(
					categoryEdited,
					suggested,
					[original, mail],
					[],
					() => "Login email",
				)
			).accountUpdates[0].next.category,
		).toBe("Tools");
	});
	it("repairs empty categories and supports retries after partial CAS/batch completion while rejecting concurrent changes", async () => {
		const [initial] = await buildAccountLinkRows(
			[entry("a", "Gmail", "owner@gmail.com")],
			[],
		);
		const original = { ...initial.account, category: "" };
		const rows = await buildAccountLinkRows(
			[entry("a", "Gmail", "owner@gmail.com")],
			[original],
		);
		expect(rows[0].account.category).toBe("email");
		const plan = await buildAccountLinkSavePlan(
			rows,
			[],
			[original],
			[],
			() => "Login email",
		);
		expect(plan.accountUpdates).toHaveLength(1);
		const retry = await buildAccountLinkSavePlan(
			rows,
			[],
			[plan.accountUpdates[0].next],
			[],
			() => "Login email",
		);
		expect(retry.accountUpdates).toEqual([]);
		await expect(
			buildAccountLinkSavePlan(
				rows,
				[],
				[{ ...original, notes: "Concurrent edit" }],
				[],
				() => "Login email",
			),
		).rejects.toThrow("account-link-stale");
		const newRows = await buildAccountLinkRows(
			[entry("b", "Notion", "owner@example.test")],
			[],
		);
		const suggested = sharedIdentifierSuggestions(newRows);
		const created = await buildAccountLinkSavePlan(
			newRows,
			suggested,
			[],
			[],
			() => "Login email",
		);
		const retryBatch = await buildAccountLinkSavePlan(
			newRows,
			suggested,
			created.newAssets,
			created.newRelations,
			() => "登录邮箱",
		);
		expect(retryBatch.newAssets).toEqual([]);
		expect(retryBatch.newRelations).toEqual([]);
		await expect(
			buildAccountLinkSavePlan(
				newRows,
				suggested,
				created.newAssets.map((asset) =>
					asset.category === "email"
						? { ...asset, notes: "Concurrent target edit" }
						: asset,
				),
				created.newRelations,
				() => "Login email",
			),
		).rejects.toThrow("account-link-stale");
	});
	it("offers a reviewed replacement only for verifiable legacy automatic hub edges", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "Bybit", "owner@example.test"),
				entry("b", "Notion", "owner@example.test"),
			],
			[],
		);
		const [a, b] = rows.map((row) => row.account.id);
		const legacy: Relation = {
			id: await accountIdentityStableId("pw-link-identifier", [
				...[a, b].sort(),
				"identifier",
			]),
			from: a,
			to: b,
			label: "相同登录标识",
			source: "",
			createdAt: "",
			verifiedAt: "",
			deleted: false,
		};
		const manual = { ...legacy, id: "manual-edge" };
		const ai = {
			...legacy,
			id: `pw-link-login-${"a".repeat(64)}`,
			label: "Signs in with this account",
		};
		const mismatchedId = {
			...legacy,
			id: `pw-link-identifier-${"0".repeat(64)}`,
		};
		const suggested = sharedIdentifierSuggestions(rows);
		const plan = await buildAccountLinkSavePlan(
			rows,
			suggested,
			[],
			[legacy, manual, ai, mismatchedId],
			() => "Login email",
		);
		expect(plan.replacedRelations).toEqual([
			{ expected: legacy, next: { ...legacy, deleted: true } },
		]);
		expect(
			(
				await buildAccountLinkSavePlan(
					rows,
					suggested,
					[],
					[
						{
							...legacy,
							label: "My edited dependency",
							source: "Manual evidence",
						},
					],
					() => "Login email",
				)
			).replacedRelations,
		).toEqual([]);
		expect(
			(
				await buildAccountLinkSavePlan(
					rows,
					[suggested[0]],
					[],
					[legacy],
					() => "Login email",
				)
			).replacedRelations,
		).toEqual([]);
		expect(
			(
				await buildAccountLinkSavePlan(
					[rows[0]],
					sharedIdentifierSuggestions([rows[0]]),
					[],
					[legacy],
					() => "Login email",
				)
			).replacedRelations,
		).toEqual([]);
	});
	it("keeps deleted identity targets in trash while allowing re-import and rejects ambiguous active targets", async () => {
		const original = {
			...newAsset("account"),
			id: "identity",
			category: "email",
			username: "owner@example.test",
		};
		const source = entry("a", "Notion", "owner@example.test");
		const [fresh] = await buildAccountLinkRows(
			[source],
			[{ ...original, deleted: true }],
		);
		expect(fresh.identityAccounts[0].account.id).not.toBe(original.id);
		expect(fresh.identityAccounts[0].isNew).toBe(true);
		await expect(
			buildAccountLinkRows([source], [original, { ...original, id: "second" }]),
		).rejects.toThrow("account-link-ambiguous");
		const [reimported] = await buildAccountLinkRows(
			[{ ...source, linkedAssetIds: [original.id] }],
			[{ ...original, deleted: true }],
		);
		expect(reimported.account.id).not.toBe(original.id);
		expect(reimported.replaceAccountIds).toEqual([original.id]);
	});
	it("offers removal of legacy numeric-username links without manufacturing phone identities", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "University", "2020034943091"),
				entry("b", "Library", "2020034943091"),
			],
			[],
		);
		const [from, to] = rows.map((row) => row.account.id);
		const legacy: Relation = {
			id: await accountIdentityStableId("pw-link-identifier", [
				...[from, to].sort(),
				"identifier",
			]),
			from,
			to,
			label: "Shared login identifier",
			createdAt: "",
			verifiedAt: "",
			deleted: false,
		};
		const plan = await buildAccountLinkSavePlan(
			rows,
			[],
			[],
			[legacy],
			() => "Login phone",
		);
		expect(plan.newAssets).toHaveLength(2);
		expect(plan.newRelations).toEqual([]);
		expect(plan.replacedRelations).toHaveLength(1);
		expect(
			(
				await buildAccountLinkSavePlan(
					[
						{ ...rows[0], account: { ...rows[0].account, category: "phone" } },
						rows[1],
					],
					[],
					[],
					[legacy],
					() => "Login phone",
				)
			).replacedRelations,
		).toEqual([]);
	});
	it("keeps an existing identity as the hub when expanding a subset review to include a legacy unclassified mailbox", async () => {
		const mailEntry = entry("mail", "Gmail", "owner@gmail.com"),
			serviceEntry = entry("service", "Notion", "owner@gmail.com");
		const subsetRows = await buildAccountLinkRows([serviceEntry], []);
		const subset = await buildAccountLinkSavePlan(
			subsetRows,
			sharedIdentifierSuggestions(subsetRows),
			[],
			[],
			() => "Login email",
		);
		const [mailRow] = await buildAccountLinkRows([mailEntry], []);
		const assets = [...subset.newAssets, { ...mailRow.account, category: "" }];
		const fullRows = await buildAccountLinkRows(
			[mailEntry, serviceEntry],
			assets,
			new Map(),
			subset.newRelations,
		);
		const suggested = sharedIdentifierSuggestions(fullRows);
		const identityId = subset.newAssets.find(
			(asset) => asset.category === "email",
		)?.id;
		expect(suggested.every((suggestion) => suggestion.to === identityId)).toBe(
			true,
		);
		const plan = await buildAccountLinkSavePlan(
			fullRows,
			suggested,
			assets,
			subset.newRelations,
			() => "Login email",
		);
		expect(plan.newAssets).toEqual([]);
		expect(plan.newRelations).toHaveLength(1);
		expect(plan.newRelations[0].from).toBe(mailRow.account.id);
		const after = assets.map(
			(asset) =>
				plan.accountUpdates.find((update) => update.next.id === asset.id)
					?.next ?? asset,
		);
		const repeatedRows = await buildAccountLinkRows(
			[mailEntry, serviceEntry],
			after,
			new Map(),
			[...subset.newRelations, ...plan.newRelations],
		);
		expect(
			(
				await buildAccountLinkSavePlan(
					repeatedRows,
					sharedIdentifierSuggestions(repeatedRows),
					after,
					[...subset.newRelations, ...plan.newRelations],
					() => "Login email",
				)
			).newRelations,
		).toEqual([]);
	});
	it("reuses a custom-category mailbox established by a verifiable identity relation", async () => {
		const identity = {
			...newAsset("account"),
			id: "my-mail",
			name: "My work mailbox",
			username: "owner@example.test",
			category: "Work",
			notes: "Preserve custom profile",
		};
		const existingService = {
			...newAsset("account"),
			id: "old-service",
			name: "Old service",
			username: identity.username,
		};
		const relation: Relation = {
			id: await accountIdentityStableId("login-link", [
				existingService.id,
				"email",
				identity.id,
			]),
			from: existingService.id,
			to: identity.id,
			label: "Login email",
			createdAt: "",
			verifiedAt: "",
			deleted: false,
		};
		const rows = await buildAccountLinkRows(
			[entry("new", "Notion", identity.username)],
			[existingService, identity],
			new Map(),
			[relation],
		);
		expect(rows[0].identityAccounts[0].account).toEqual(identity);
		const plan = await buildAccountLinkSavePlan(
			rows,
			sharedIdentifierSuggestions(rows),
			[existingService, identity],
			[relation],
			() => "Login email",
		);
		expect(plan.newAssets).toEqual([rows[0].account]);
		expect(plan.newRelations[0].to).toBe(identity.id);
		const [replacement] = await buildAccountLinkRows(
			[entry("new", "Notion", identity.username)],
			[existingService, { ...identity, deleted: true }],
			new Map(),
			[relation],
		);
		expect(replacement.identityAccounts[0].account.id).not.toBe(identity.id);
		expect(replacement.identityAccounts[0].isNew).toBe(true);
	});
	it("does not treat arbitrary same-endpoint edges as proof that an identity relationship replaced a legacy hub", async () => {
		const rows = await buildAccountLinkRows(
			[
				entry("a", "Bybit", "owner@example.test"),
				entry("b", "Notion", "owner@example.test"),
			],
			[],
		);
		const suggested = sharedIdentifierSuggestions(rows);
		const identityLinks = await accountLinkRelations(
			suggested,
			[],
			() => "Login email",
		);
		const [from, to] = rows.map((row) => row.account.id);
		const legacy: Relation = {
			id: await accountIdentityStableId("pw-link-identifier", [
				...[from, to].sort(),
				"identifier",
			]),
			from,
			to,
			label: "Shared login identifier",
			createdAt: "",
			verifiedAt: "",
			deleted: false,
		};
		const existingRelations = [
			legacy,
			...identityLinks.map((relation) => ({ ...relation, deleted: true })),
			...identityLinks.map((relation, index) => ({
				...relation,
				id: `manual-${index}`,
				label: "Owns",
				deleted: false,
			})),
		];
		const assets = [
			...rows.map((row) => row.account),
			rows[0].identityAccounts[0].account,
		];
		const plan = await buildAccountLinkSavePlan(
			rows,
			suggested,
			assets,
			existingRelations,
			() => "Login email",
		);
		expect(plan.newRelations).toEqual([]);
		expect(plan.replacedRelations).toEqual([]);
	});
	it("cleans only reviewed sources' obsolete automatic identity links after a username update", async () => {
		const oldRows = await buildAccountLinkRows(
			[
				entry("service", "Notion", "old@example.test"),
				entry("other", "Slack", "old@example.test"),
			],
			[],
		);
		const saved = await buildAccountLinkSavePlan(
			oldRows,
			sharedIdentifierSuggestions(oldRows),
			[],
			[],
			() => "Login email",
		);
		const source = saved.newAssets.find((asset) => asset.name === "Notion");
		if (!source) throw Error("fixture");
		const updatedEntry = {
			...entry("service", "Notion", "new@example.test"),
			linkedAssetIds: [source.id],
		};
		const rows = await buildAccountLinkRows(
			[updatedEntry],
			saved.newAssets,
			new Map(),
			saved.newRelations,
		);
		const owned = saved.newRelations.find(
			(relation) => relation.from === source.id,
		);
		if (!owned) throw Error("fixture");
		const plan = await buildAccountLinkSavePlan(
			rows,
			sharedIdentifierSuggestions(rows),
			saved.newAssets,
			saved.newRelations,
			() => "Login email",
		);
		expect(plan.accountUpdates[0].next.username).toBe("new@example.test");
		expect(plan.replacedRelations).toEqual([
			{ expected: owned, next: { ...owned, deleted: true } },
		]);
		expect(plan.newRelations).toHaveLength(1);
		const edited = { ...owned, source: "My manual evidence" };
		expect(
			(
				await buildAccountLinkSavePlan(
					rows,
					sharedIdentifierSuggestions(rows),
					saved.newAssets,
					[edited],
					() => "Login email",
				)
			).replacedRelations,
		).toEqual([]);
		const noChangeRows = await buildAccountLinkRows(
			[entry("service", "Notion", "old@example.test")],
			saved.newAssets,
			new Map(),
			saved.newRelations,
		);
		expect(
			(
				await buildAccountLinkSavePlan(
					noChangeRows,
					sharedIdentifierSuggestions(noChangeRows),
					saved.newAssets,
					saved.newRelations,
					() => "Login email",
				)
			).replacedRelations,
		).toEqual([]);
	});
	it("blocks changing an identity used by incoming accounts and never repurposes a canonical identity ID", async () => {
		const oldRows = await buildAccountLinkRows(
			[
				entry("mail", "Gmail", "old@gmail.com"),
				entry("service", "Notion", "old@gmail.com"),
			],
			[],
		);
		const saved = await buildAccountLinkSavePlan(
			oldRows,
			sharedIdentifierSuggestions(oldRows),
			[],
			[],
			() => "Login email",
		);
		const mail = saved.newAssets.find((asset) => asset.name === "Gmail");
		if (!mail) throw Error("fixture");
		const rows = await buildAccountLinkRows(
			[
				{
					...entry("mail", "Gmail", "new@gmail.com"),
					linkedAssetIds: [mail.id],
				},
			],
			saved.newAssets,
			new Map(),
			saved.newRelations,
		);
		await expect(
			buildAccountLinkSavePlan(
				rows,
				sharedIdentifierSuggestions(rows),
				saved.newAssets,
				saved.newRelations,
				() => "Login email",
			),
		).rejects.toThrow("account-link-identity-in-use");
		const genericRows = await buildAccountLinkRows(
			[entry("source", "Notion", "old@example.test")],
			[],
		);
		const generic = genericRows[0].identityAccounts[0].account;
		const changingGeneric = await buildAccountLinkRows(
			[
				{
					...entry("mail-new", "Email", "new@example.test"),
					linkedAssetIds: [generic.id],
				},
			],
			[generic],
		);
		await expect(
			buildAccountLinkSavePlan(
				changingGeneric,
				[],
				[generic],
				[],
				() => "Login email",
			),
		).rejects.toThrow("account-link-identity-in-use");
	});
	it("leaves deleted accounts untouched and rejects ambiguous active matches", async () => {
		const e = entry("a", "Google", "a@example.test");
		const [row] = await buildAccountLinkRows([e], []);
		const [fresh] = await buildAccountLinkRows(
			[e],
			[{ ...row.account, deleted: true }],
		);
		expect(fresh.account.id).not.toBe(row.account.id);
		expect(fresh.isNew).toBe(true);
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
		expect(
			result.relations.map((relation) => [relation.from, relation.to]),
		).toEqual([
			["a", "b"],
			["b", "c"],
			["c", "a"],
		]);
	});
});
