import { describe, expect, it } from "vitest";
import {
	type Asset,
	type Relation,
	newAsset,
} from "../../../packages/domain/src";
import { accountIdentityStableId } from "./account-identities";
import {
	aiAccountLinkInput,
	buildAccountLinkRows,
	buildAccountLinkSavePlan,
	existingAccountLinkRows,
	reviewableAccountLinkSuggestions,
	sharedIdentifierSuggestions,
	accountLinkRelationChanges,
} from "./vault-account-links";
const email = "shared@example.test",
	phone = "13800138000";
const account = (id: string, username: string, category = "other"): Asset => ({
	...newAsset("account"),
	id,
	name: id,
	username,
	category,
	url: `https://example.test/${id}?public=preserved`,
	notes: `private-${id}`,
	description: `description-${id}`,
});
const entry = (
	id: string,
	username: string,
	aliases: string[] = [],
	asset?: Asset,
) => ({
	id,
	title: id,
	username,
	usernameAliases: aliases,
	linkedAssetIds: asset ? [asset.id] : [],
	url: "",
	modifiedAt: "2026-10-24T00:00:00Z",
	historyCount: 0,
});
const label = (_kind: string, kind?: string) =>
	kind === "phone" ? "Login phone" : "Login email";
async function fixture() {
	const mail = account("mail", email, "email"),
		mobile = account("phone", phone, "phone");
	const existing = account("existing", " SHARED@EXAMPLE.TEST "),
		byPhone = account("phone-service", "+86 138 0013 8000");
	const alias = account("alias-service", phone),
		other = account("different", "shared+different@example.test");
	const contact = { ...account("contact-only", "handle"), contact: email };
	const deleted = { ...account("deleted", email), deleted: true };
	const assets = [
		mail,
		mobile,
		existing,
		byPhone,
		alias,
		other,
		contact,
		deleted,
	];
	const known = await buildAccountLinkRows(
		[
			entry("published-alias", phone, [email], alias),
			entry("not-imported", email),
		],
		assets,
	);
	const selected = await buildAccountLinkRows(
		[entry("new-service", email, [phone])],
		assets,
	);
	const rows = [
		...selected,
		...existingAccountLinkRows(selected, assets, known),
	];
	return {
		assets,
		selected,
		rows,
		known,
		mail,
		mobile,
		existing,
		byPhone,
		alias,
	};
}
describe("existing account identifier coverage", () => {
	it("backfills existing primary and published alias accounts while keeping unimported entries private", async () => {
		const f = await fixture(),
			before = JSON.stringify(f.assets);
		expect(
			f.rows
				.filter((row) => row.contextOnly)
				.map((row) => row.account.id)
				.sort(),
		).toEqual([f.existing.id, f.byPhone.id, f.alias.id].sort());
		const suggestions = await reviewableAccountLinkSuggestions(f.rows, []);
		expect(suggestions).toHaveLength(6);
		const plan = await buildAccountLinkSavePlan(
			f.rows,
			suggestions,
			f.assets,
			[],
			label,
		);
		expect(plan.newAssets.map((asset) => asset.id)).toEqual([
			f.selected[0].account.id,
		]);
		expect(plan.accountUpdates).toEqual([]);
		expect(plan.newRelations).toHaveLength(6);
		expect(plan.replacedRelations).toEqual([]);
		expect(JSON.stringify(f.assets)).toBe(before);
		expect(aiAccountLinkInput(f.rows)).not.toMatch(
			/private-|published-alias|not-imported|existing|alias-service/,
		);
		const saved = [...f.assets, ...plan.newAssets],
			relations = plan.newRelations;
		const selectedAgain = await buildAccountLinkRows(
			[entry("new-service", email, [phone])],
			saved,
			new Map(),
			relations,
		);
		const again = [
			...selectedAgain,
			...existingAccountLinkRows(selectedAgain, saved, f.known),
		];
		const repeat = await buildAccountLinkSavePlan(
			again,
			await reviewableAccountLinkSuggestions(again, relations),
			saved,
			relations,
			label,
		);
		expect(repeat.newAssets).toEqual([]);
		expect(repeat.newRelations).toEqual([]);
		expect(repeat.accountUpdates).toEqual([]);
	});
	it("selecting a mailbox includes saved services without stripping their other login connections", async () => {
		const f = await fixture();
		const selected = await buildAccountLinkRows(
			[entry("mailbox", email, [], f.mail)],
			f.assets,
		);
		const rows = [
			...selected,
			...existingAccountLinkRows(selected, f.assets, f.known),
		];
		const phoneRow = f.known[0];
		const phoneRelations = (
			await accountLinkRelationChanges(
				sharedIdentifierSuggestions([phoneRow]),
				[],
				label,
			)
		).newRelations;
		const plan = await buildAccountLinkSavePlan(
			rows,
			await reviewableAccountLinkSuggestions(rows, phoneRelations),
			f.assets,
			phoneRelations,
			label,
		);
		expect(plan.newRelations.every((line) => line.to === f.mail.id)).toBe(true);
		expect(plan.newRelations.map((line) => line.from).sort()).toEqual([
			f.existing.id,
		]);
		expect(plan.replacedRelations).toEqual([]);
		expect(plan.accountUpdates).toHaveLength(1); // Only the selected mailbox title is reviewed for update.
		expect(plan.accountUpdates[0].expected.id).toBe(f.mail.id);
	});
	it("does not revive context connections that were trashed or permanently deleted", async () => {
		const f = await fixture();
		const suggestion = sharedIdentifierSuggestions(f.rows).find(
			(row) => row.from === f.existing.id,
		);
		if (!suggestion) throw Error("Missing existing-account suggestion");
		const line = (await accountLinkRelationChanges([suggestion], [], label))
			.newRelations[0];
		const deleted = { ...line, deleted: true };
		const changes = await accountLinkRelationChanges(
			[suggestion],
			[deleted],
			label,
		);
		expect(changes.newRelations).toEqual([]);
		expect(changes.deletedRelations).toHaveLength(1);
		const withoutRestore = await buildAccountLinkSavePlan(
			f.rows,
			[suggestion],
			f.assets,
			[deleted],
			label,
		);
		expect(withoutRestore.newRelations).toEqual([]);
		expect(withoutRestore.restoredRelations).toEqual([]);
		const explicit = await buildAccountLinkSavePlan(
			f.rows,
			[suggestion],
			f.assets,
			[deleted],
			label,
			[deleted],
		);
		expect(explicit.restoredRelations).toEqual([deleted]);
		const purged = { ...deleted, purged: true as const };
		const offered = await reviewableAccountLinkSuggestions(f.rows, [purged]);
		expect(offered).not.toContainEqual(suggestion);
		await expect(
			buildAccountLinkSavePlan(f.rows, [suggestion], f.assets, [purged], label),
		).rejects.toThrow("account-link-stale");
		const writable = f.rows.map((row) =>
			row.account.id === f.existing.id ? { ...row, contextOnly: false } : row,
		);
		const reimport = await buildAccountLinkSavePlan(
			writable,
			[suggestion],
			f.assets,
			[purged],
			label,
		);
		expect(reimport.newRelations).toHaveLength(1);
		expect(reimport.newRelations[0].id).not.toBe(line.id);
	});
	it("rejects changed existing metadata and never rewrites a context account", async () => {
		const f = await fixture();
		const changed = f.assets.map((asset) =>
			asset.id === f.existing.id
				? { ...asset, notes: "changed elsewhere" }
				: asset,
		);
		await expect(
			buildAccountLinkSavePlan(
				f.rows,
				sharedIdentifierSuggestions(f.rows),
				changed,
				[],
				label,
			),
		).rejects.toThrow("account-link-stale");
	});
	it("keeps unrelated old generated links on a context account", async () => {
		const f = await fixture(),
			third = account("other-mail", "other@example.test", "email");
		const old: Relation = {
			id: await accountIdentityStableId("login-link", [
				f.existing.id,
				"email",
				third.id,
			]),
			from: f.existing.id,
			to: third.id,
			label: "Login email",
			source: third.username,
			createdAt: "2026-10-22T00:00:00Z",
			verifiedAt: "",
			deleted: false,
		};
		const plan = await buildAccountLinkSavePlan(
			f.rows,
			sharedIdentifierSuggestions(f.rows),
			[...f.assets, third],
			[old],
			label,
		);
		expect(plan.replacedRelations).toEqual([]);
	});
	it("does not treat duplicate identities, contacts, partial numbers or different plus-addresses as services", async () => {
		const f = await fixture();
		const assets = [
			...f.assets,
			account("duplicate-mail", email, "email"),
			account("short-phone", "00138000"),
			account("dots", "sha.red@example.test"),
		];
		const ids = existingAccountLinkRows(f.selected, assets, f.known).map(
			(row) => row.account.id,
		);
		expect(ids.sort()).toEqual(
			[f.existing.id, f.byPhone.id, f.alias.id].sort(),
		);
		expect(existingAccountLinkRows([], assets, f.known)).toEqual([]);
	});
	it("does not publish unselected edits to the primary identifier through alias context", async () => {
		const f = await fixture();
		const pending = await buildAccountLinkRows(
			[entry("changed", "new@example.test", [email], f.alias)],
			f.assets,
		);
		const rows = existingAccountLinkRows(f.selected, f.assets, pending);
		expect(
			rows.find((row) => row.account.id === f.alias.id)?.identifiers,
		).toEqual([`phone:${phone}`]);
	});
	it("does not publish aliases from an unlinked vault entry that merely matches an existing account", async () => {
		const f = await fixture();
		const known = await buildAccountLinkRows(
			[entry(f.alias.name, phone, [email])],
			f.assets,
		);
		expect(known[0].isNew).toBe(false);
		expect(known[0].published).toBe(false);
		const rows = existingAccountLinkRows(f.selected, f.assets, known);
		expect(
			rows.find((row) => row.account.id === f.alias.id)?.identifiers,
		).toEqual([`phone:${phone}`]);
	});
});

it("uses published identifier relations but excludes recovery purposes and mismatched kinds", async () => {
	const selected = await buildAccountLinkRows([entry("new", email)], []);
	const service = account("service", phone),
		target = account("old-identity", email, "email");
	const line: Relation = {
		id: crypto.randomUUID(),
		from: service.id,
		to: target.id,
		label: "login email",
		source: email,
		createdAt: "2026-10-24T00:00:00Z",
		verifiedAt: "",
		deleted: false,
	};
	const assets = [service, target];
	expect(
		existingAccountLinkRows(selected, assets, [], [line]).map(
			(row) => row.account.id,
		),
	).toEqual([service.id]);
	for (const label of ["Recovery email", "Login phone", "Third-party login"]) {
		expect(
			existingAccountLinkRows(selected, assets, [], [{ ...line, label }]),
		).toEqual([]);
	}
});

it("unions identifiers from two published passwords for one service without duplicating its account or line", async () => {
	const mail = account("mail", email, "email"),
		mobile = account("phone", phone, "phone"),
		service = account("one-service", email);
	const assets = [mail, mobile, service];
	const known = await buildAccountLinkRows(
		[
			entry("copy-a", email, [phone], service),
			entry("copy-b", email, [phone], service),
		],
		assets,
	);
	const selected = await buildAccountLinkRows([entry("new", phone)], assets);
	const context = existingAccountLinkRows(selected, assets, known);
	expect(context).toHaveLength(1);
	expect(context[0].account).toEqual(service);
	const rows = [...selected, ...context],
		suggestions = await reviewableAccountLinkSuggestions(rows, []);
	expect(suggestions.filter((line) => line.from === service.id)).toHaveLength(
		1,
	);
	const plan = await buildAccountLinkSavePlan(
		rows,
		suggestions,
		assets,
		[],
		label,
	);
	expect(plan.newAssets).toHaveLength(1);
	expect(plan.accountUpdates).toEqual([]);
});

it("requires a fresh review if an existing connection is deleted after the preview", async () => {
	const selected = await buildAccountLinkRows([entry("new", email)], []);
	const existing = account("old", email),
		rows = [...selected, ...existingAccountLinkRows(selected, [existing])];
	const suggestion = sharedIdentifierSuggestions(rows).find(
		(line) => line.from === existing.id,
	);
	if (!suggestion) throw Error("Missing existing-account suggestion");
	const line = (await accountLinkRelationChanges([suggestion], [], label))
		.newRelations[0];
	await expect(
		buildAccountLinkSavePlan(
			rows,
			sharedIdentifierSuggestions(rows),
			[existing],
			[{ ...line, deleted: true }],
			label,
			[],
		),
	).rejects.toThrow("account-link-stale");
});
