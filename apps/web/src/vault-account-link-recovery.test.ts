import { describe, expect, it } from "vitest";
import { newAsset, type Asset } from "../../../packages/domain/src";
import {
	accountLinkRelationChanges,
	buildAccountLinkReview,
	buildAccountLinkRows,
	buildAccountLinkSavePlan,
	sharedIdentifierSuggestions,
} from "./vault-account-links";

const entry = {
	id: "recovery-entry",
	title: "Test account",
	username: "owner@example.test",
	usernameAliases: [],
	url: "",
	linkedAssetIds: [] as string[],
	modifiedAt: "",
	historyCount: 0,
};
const label = () => "Login email";

describe("reviewed account link recovery", () => {
	it("re-imports under a new stable id without reviving deleted accounts or blocking unrelated entries", async () => {
		const [original] = await buildAccountLinkRows([entry], []);
		const deleted = { ...original.account, deleted: true };
		const source = { ...entry, linkedAssetIds: [deleted.id] };
		const review = await buildAccountLinkReview(
			[
				source,
				{ ...entry, id: "other", title: "Other", username: "different-handle" },
			],
			[deleted],
			new Map(),
			[],
		);
		expect(review.rows.map((row) => row.entryId)).toEqual([entry.id, "other"]);
		expect(review.blocked).toEqual([]);
		expect(review.rows[0].account.id).not.toBe(deleted.id);
		expect(review.rows[0].isNew).toBe(true);
		expect(review.rows[0].replaceAccountIds).toEqual([deleted.id]);
		const retry = await buildAccountLinkRows([source], [deleted]);
		expect(retry[0].account.id).toBe(review.rows[0].account.id);
		const again = await buildAccountLinkRows(
			[source],
			[deleted, { ...retry[0].account, deleted: true }],
		);
		expect(again[0].account.id).not.toBe(deleted.id);
		expect(again[0].account.id).not.toBe(retry[0].account.id);
		expect(deleted.deleted).toBe(true);
		const restored = await buildAccountLinkReview(
			[source],
			[{ ...deleted, deleted: false }],
			new Map(),
			[],
		);
		expect(restored.blocked).toEqual([]);
		expect(restored.rows[0].account.id).toBe(deleted.id);
	});
	it("replaces only explicitly reviewed account links and reopens without the old tombstone blocking", async () => {
		const [original] = await buildAccountLinkRows([entry], []);
		const deleted = { ...original.account, deleted: true };
		const target = { ...original.account, id: "chosen-live-account" };
		const project = { ...newAsset("project"), id: "preserved-project" };
		const source = { ...entry, linkedAssetIds: [deleted.id, project.id] };
		const assets = [deleted, target, project];
		const [resolved] = await buildAccountLinkRows(
			[source],
			assets,
			new Map(),
			[],
			{ accounts: new Map([[entry.id, target.id]]) },
		);
		expect(resolved.replaceAccountIds).toEqual([deleted.id]);
		expect(resolved.account.id).toBe(target.id);
		expect(resolved.originalAccount).toEqual(target);
		expect(
			(await buildAccountLinkSavePlan([resolved], [], assets, [], label))
				.newAssets,
		).toEqual([]);
		const reopened = await buildAccountLinkRows(
			[{ ...source, linkedAssetIds: [target.id, project.id] }],
			assets,
		);
		expect(reopened[0].account.id).toBe(target.id);
		expect(deleted.deleted).toBe(true);
	});
	it("requires an explicit choice for duplicate account matches and rejects stale choices", async () => {
		const target = {
			...newAsset("account"),
			name: entry.title,
			username: entry.username,
		};
		const duplicate = { ...target, id: "duplicate" };
		const review = await buildAccountLinkReview(
			[entry],
			[target, duplicate],
			new Map(),
			[],
		);
		expect(review.blocked[0].conflict).toMatchObject({
			scope: "account",
			reason: "ambiguous",
			accounts: [target, duplicate],
		});
		const resolutions = { accounts: new Map([[entry.id, target.id]]) };
		expect(
			(
				await buildAccountLinkReview(
					[entry],
					[target, duplicate],
					new Map(),
					[],
					resolutions,
				)
			).blocked,
		).toEqual([]);
		await expect(
			buildAccountLinkReview(
				[entry],
				[{ ...target, deleted: true }, duplicate],
				new Map(),
				[],
				resolutions,
			),
		).rejects.toThrow("account-link-stale");
	});
	it("reuses the active email identity on retry while leaving an old identity deleted", async () => {
		const [initial] = await buildAccountLinkRows([entry], []);
		const deleted = { ...initial.identityAccounts[0].account, deleted: true };
		const target = { ...deleted, id: "chosen-email", deleted: false };
		const assets: Asset[] = [deleted, target];
		const blocked = await buildAccountLinkReview(
			[entry],
			assets,
			new Map(),
			[],
		);
		expect(blocked.blocked).toEqual([]);
		expect(blocked.rows[0].identityAccounts[0].account.id).toBe(target.id);
		const rows = await buildAccountLinkRows([entry], assets, new Map(), [], {
			identities: new Map([["email:owner@example.test", target.id]]),
		});
		const plan = await buildAccountLinkSavePlan(
			rows,
			sharedIdentifierSuggestions(rows),
			assets,
			[],
			label,
		);
		expect(plan.newRelations[0].to).toBe(target.id);
		const reopened = await buildAccountLinkRows(
			[entry],
			[...assets, ...plan.newAssets],
			new Map(),
			plan.newRelations,
		);
		expect(reopened[0].identityAccounts[0].account.id).toBe(target.id);
		expect(deleted.deleted).toBe(true);
	});
	it("lists duplicate email identities for a deliberate choice", async () => {
		const identity = {
			...newAsset("account"),
			category: "email",
			username: entry.username,
		};
		const second = { ...identity, id: "second-email" };
		const review = await buildAccountLinkReview(
			[entry],
			[identity, second],
			new Map(),
			[],
		);
		expect(review.blocked[0].conflict).toMatchObject({
			scope: "identity",
			reason: "ambiguous",
			accounts: [identity, second],
		});
		const rows = await buildAccountLinkRows(
			[entry],
			[identity, second],
			new Map(),
			[],
			{ identities: new Map([["email:owner@example.test", second.id]]) },
		);
		expect(sharedIdentifierSuggestions(rows)[0].to).toBe(second.id);
	});
	it("keeps an explicit identity replacement usable after the old identity has changed", async () => {
		const [initial] = await buildAccountLinkRows([entry], []);
		const previous = {
			...initial.identityAccounts[0].account,
			username: "changed@example.test",
		};
		const target = {
			...initial.identityAccounts[0].account,
			id: "chosen-identity",
		};
		const assets = [previous, target];
		const review = await buildAccountLinkReview([entry], assets, new Map(), []);
		expect(review.blocked[0].conflict.reason).toBe("incompatible");
		const rows = await buildAccountLinkRows([entry], assets, new Map(), [], {
			identities: new Map([["email:owner@example.test", target.id]]),
		});
		const plan = await buildAccountLinkSavePlan(
			rows,
			sharedIdentifierSuggestions(rows),
			assets,
			[],
			label,
		);
		const reopened = await buildAccountLinkReview(
			[entry],
			[...assets, ...plan.newAssets],
			new Map(),
			plan.newRelations,
		);
		expect(reopened.blocked).toEqual([]);
		expect(reopened.rows[0].identityAccounts[0].account.id).toBe(target.id);
	});
	it("restores a deleted line only in an explicit restoration plan, with the same id", async () => {
		const rows = await buildAccountLinkRows([entry], []);
		const suggestions = sharedIdentifierSuggestions(rows);
		const first = await buildAccountLinkSavePlan(
			rows,
			suggestions,
			[],
			[],
			label,
		);
		const deleted = { ...first.newRelations[0], deleted: true };
		const assets = first.newAssets;
		const reopened = await buildAccountLinkRows(
			[{ ...entry, linkedAssetIds: [rows[0].account.id] }],
			assets,
			new Map(),
			[deleted],
		);
		const next = sharedIdentifierSuggestions(reopened);
		const changes = await accountLinkRelationChanges(next, [deleted], label);
		expect(changes.deletedRelations[0].relation).toEqual(deleted);
		expect(
			(await buildAccountLinkSavePlan(reopened, next, assets, [deleted], label))
				.restoredRelations,
		).toEqual([]);
		const restored = await buildAccountLinkSavePlan(
			reopened,
			next,
			assets,
			[deleted],
			label,
			[deleted],
		);
		expect(restored.restoredRelations).toEqual([deleted]);
		expect(restored.newRelations).toEqual([]);
		expect(restored.newAssets).toEqual([]);
		const retry = await buildAccountLinkSavePlan(
			reopened,
			next,
			assets,
			[{ ...deleted, deleted: false }],
			label,
			[deleted],
		);
		expect(retry.restoredRelations).toEqual([]);
		expect(retry.newRelations).toEqual([]);
	});
	it("rejects a connection deleted or edited after the reviewed suggestions", async () => {
		const rows = await buildAccountLinkRows([entry], []);
		const suggestions = sharedIdentifierSuggestions(rows);
		const first = await buildAccountLinkSavePlan(
			rows,
			suggestions,
			[],
			[],
			label,
		);
		const deleted = { ...first.newRelations[0], deleted: true };
		const reopened = await buildAccountLinkRows(
			[entry],
			first.newAssets,
			new Map(),
			[deleted],
		);
		await expect(
			buildAccountLinkSavePlan(
				reopened,
				sharedIdentifierSuggestions(reopened),
				first.newAssets,
				[deleted],
				label,
				[],
			),
		).rejects.toThrow("account-link-stale");
		await expect(
			buildAccountLinkSavePlan(
				reopened,
				sharedIdentifierSuggestions(reopened),
				first.newAssets,
				[{ ...deleted, label: "Edited after review" }],
				label,
				[deleted],
			),
		).rejects.toThrow("account-link-stale");
	});
});
