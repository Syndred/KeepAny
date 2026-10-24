import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
	type Asset,
	type Relation,
	newAsset,
} from "../../../packages/domain/src";
import { openLocalRepository } from "../../../packages/local-db/src";
import {
	AccountIdentitySavePending,
	saveAccountWithIdentityLinks,
} from "./account-identity-save";
import { accountIdentityStableId } from "./account-identities";
const email = "shared@example.test",
	otherEmail = "other@example.test",
	phone = "13800138000";
const account = (
	name: string,
	username: string,
	category = "other",
): Asset => ({ ...newAsset("account"), name, username, category });
const labels = (_kind: string, kind?: string) =>
	kind === "phone" ? "Login phone" : "Login email";
const open = () =>
	openLocalRepository(
		`test-account-identity-save-${crypto.randomUUID().slice(0, 8)}`,
	);

describe("ordinary account identifier connections", () => {
	it("supports both creation orders and future saves without duplicate identity records", async () => {
		const repo = await open();
		try {
			const early = await saveAccountWithIdentityLinks(
				null,
				account("early", email),
				labels,
				repo,
			);
			expect(await repo.list("asset")).toHaveLength(1);
			expect(await repo.list("relation")).toHaveLength(0);
			const mailbox = await saveAccountWithIdentityLinks(
				null,
				account("mailbox", email, "email"),
				labels,
				repo,
			);
			expect(await repo.list<Relation>("relation")).toMatchObject([
				{ from: early.id, to: mailbox.id, label: "Login email" },
			]);
			const later = await saveAccountWithIdentityLinks(
				null,
				account("later", email.toUpperCase()),
				labels,
				repo,
			);
			expect(await repo.list("asset")).toHaveLength(3);
			expect(await repo.list("relation")).toHaveLength(2);
			await saveAccountWithIdentityLinks(
				later,
				{ ...later, notes: "private ordinary note" },
				labels,
				repo,
			);
			expect(await repo.list("relation")).toHaveLength(2);
		} finally {
			await repo.close();
		}
	});
	it("uses explicit form categories and does not classify services as mailboxes by their names", async () => {
		const repo = await open();
		try {
			const mailbox = await saveAccountWithIdentityLinks(
				null,
				account("mailbox", email, "email"),
				labels,
				repo,
			);
			const service = await saveAccountWithIdentityLinks(
				null,
				account("Gmail billing", email, "other"),
				labels,
				repo,
			);
			expect(await repo.list<Relation>("relation")).toMatchObject([
				{ from: service.id, to: mailbox.id },
			]);
		} finally {
			await repo.close();
		}
	});
	it("supports a mailbox named with its email even when its separate username is empty", async () => {
		const repo = await open();
		try {
			const service = await saveAccountWithIdentityLinks(
				null,
				account("service", email),
				labels,
				repo,
			);
			const mailbox = await saveAccountWithIdentityLinks(
				null,
				account(email, "", "email"),
				labels,
				repo,
			);
			expect(await repo.list<Relation>("relation")).toMatchObject([
				{ from: service.id, to: mailbox.id },
			]);
			await expect(
				saveAccountWithIdentityLinks(
					mailbox,
					{ ...mailbox, name: otherEmail },
					labels,
					repo,
				),
			).rejects.toThrow("account-link-identity-in-use");
			expect((await repo.get<Asset>("asset", mailbox.id))?.name).toBe(email);
		} finally {
			await repo.close();
		}
	});
	it("moves a changed primary email while preserving published phone aliases and manual recovery purposes", async () => {
		const repo = await open();
		try {
			const first = await saveAccountWithIdentityLinks(
				null,
				account("first mail", email, "email"),
				labels,
				repo,
			);
			const second = await saveAccountWithIdentityLinks(
				null,
				account("second mail", otherEmail, "email"),
				labels,
				repo,
			);
			const mobile = await saveAccountWithIdentityLinks(
				null,
				account("phone", phone, "phone"),
				labels,
				repo,
			);
			const service = await saveAccountWithIdentityLinks(
				null,
				account("service", email),
				labels,
				repo,
			);
			const alias: Relation = {
				id: await accountIdentityStableId("login-link", [
					service.id,
					"phone",
					mobile.id,
				]),
				from: service.id,
				to: mobile.id,
				label: "Login phone",
				source: phone,
				verifiedAt: "",
				createdAt: "2026-10-24T00:00:00Z",
				deleted: false,
			};
			const recovery: Relation = {
				...alias,
				id: crypto.randomUUID(),
				to: first.id,
				label: "Recovery email",
				source: "manual",
			};
			await repo.saveBatch([
				{ type: "relation", value: alias },
				{ type: "relation", value: recovery },
			]);
			const changed = await saveAccountWithIdentityLinks(
				service,
				{ ...service, username: otherEmail },
				labels,
				repo,
			);
			const live = await repo.list<Relation>("relation");
			expect(live).toHaveLength(3);
			expect(live).toEqual(
				expect.arrayContaining([
					alias,
					recovery,
					expect.objectContaining({
						from: service.id,
						to: second.id,
						label: "Login email",
					}),
				]),
			);
			await saveAccountWithIdentityLinks(
				changed,
				{ ...changed, description: "changed public description" },
				labels,
				repo,
			);
			expect(await repo.list("relation")).toHaveLength(3);
			const latest = await repo.get<Asset>("asset", service.id);
			if (!latest) throw Error("Saved source missing");
			await saveAccountWithIdentityLinks(
				latest,
				{ ...latest, username: email },
				labels,
				repo,
			);
			const roundTrip = await repo.list<Relation>("relation");
			expect(roundTrip).toHaveLength(3);
			expect(roundTrip).toEqual(
				expect.arrayContaining([
					alias,
					recovery,
					expect.objectContaining({
						from: service.id,
						to: first.id,
						label: "Login email",
					}),
				]),
			);
		} finally {
			await repo.close();
		}
	});
	it("does not automatically restore deleted or purged lines on unrelated account saves", async () => {
		const repo = await open();
		try {
			await saveAccountWithIdentityLinks(
				null,
				account("mail", email, "email"),
				labels,
				repo,
			);
			let service = await saveAccountWithIdentityLinks(
				null,
				account("service", email),
				labels,
				repo,
			);
			const [line] = await repo.list<Relation>("relation");
			await repo.saveRelationIfCurrent(line, { ...line, deleted: true });
			service = await saveAccountWithIdentityLinks(
				service,
				{ ...service, notes: "first edit" },
				labels,
				repo,
			);
			expect(await repo.list("relation")).toHaveLength(0);
			const purge = await repo.previewTrashPurge([
				{ type: "relation", id: line.id },
			]);
			await repo.purgeTrash(purge);
			await saveAccountWithIdentityLinks(
				service,
				{ ...service, notes: "second edit" },
				labels,
				repo,
			);
			await saveAccountWithIdentityLinks(
				null,
				account("another service", email),
				labels,
				repo,
			);
			const live = await repo.list<Relation>("relation");
			expect(live).toHaveLength(1);
			expect(live[0].from).not.toBe(service.id);
		} finally {
			await repo.close();
		}
	});
	it("does not overwrite another tab or revive a deleted source", async () => {
		const repo = await open();
		try {
			const service = await saveAccountWithIdentityLinks(
				null,
				account("service", email),
				labels,
				repo,
			);
			await repo.saveAssetIfCurrent(service, {
				...service,
				notes: "another tab",
			});
			await expect(
				saveAccountWithIdentityLinks(
					service,
					{ ...service, name: "old editor" },
					labels,
					repo,
				),
			).rejects.toThrow("asset-stale");
			await expect(
				saveAccountWithIdentityLinks(null, service, labels, repo),
			).rejects.toThrow("asset-stale");
			const current = await repo.get<Asset>("asset", service.id);
			if (!current) throw Error("Saved source missing");
			await repo.saveAssetIfCurrent(current, { ...current, deleted: true });
			await expect(
				saveAccountWithIdentityLinks(current, current, labels, repo),
			).rejects.toThrow("asset-stale");
		} finally {
			await repo.close();
		}
	});
	it("rolls back new source/connection writes together when the existing batch fails", async () => {
		const repo = await open();
		try {
			await saveAccountWithIdentityLinks(
				null,
				account("mail", email, "email"),
				labels,
				repo,
			);
			const failing = vi
				.spyOn(repo, "saveBatchIfAssetsCurrent")
				.mockRejectedValueOnce(Error("synthetic-write-failure"));
			await expect(
				saveAccountWithIdentityLinks(
					null,
					account("service", email),
					labels,
					repo,
				),
			).rejects.toThrow("synthetic-write-failure");
			expect(await repo.list("asset")).toHaveLength(1);
			expect(await repo.list("relation")).toHaveLength(0);
			failing.mockRestore();
		} finally {
			await repo.close();
		}
	});
	it("returns the committed source snapshot so a partial connection write can be retried safely", async () => {
		const repo = await open();
		try {
			await saveAccountWithIdentityLinks(
				null,
				account("mail", email, "email"),
				labels,
				repo,
			);
			const service = account("service", email);
			await repo.save("asset", service);
			const failing = vi
				.spyOn(repo, "saveBatchIfAssetsCurrent")
				.mockRejectedValueOnce(Error("synthetic-write-failure"));
			let partial: AccountIdentitySavePending | undefined;
			try {
				await saveAccountWithIdentityLinks(
					service,
					{ ...service, notes: "saved before connections" },
					labels,
					repo,
				);
			} catch (error) {
				if (error instanceof AccountIdentitySavePending) partial = error;
				else throw error;
			}
			expect(partial).toBeInstanceOf(AccountIdentitySavePending);
			failing.mockRestore();
			if (!partial) throw Error("Expected partial-save receipt");
			const current = partial.savedAccount;
			expect(current.notes).toBe("saved before connections");
			await saveAccountWithIdentityLinks(current, current, labels, repo);
			expect(await repo.list("asset")).toHaveLength(2);
			expect(await repo.list("relation")).toHaveLength(1);
		} finally {
			await repo.close();
		}
	});
	it("rejects ambiguous identity targets instead of choosing an arbitrary mailbox", async () => {
		const repo = await open();
		try {
			const one = account("one", email, "email"),
				two = account("two", email, "email");
			await repo.saveBatch([
				{ type: "asset", value: one },
				{ type: "asset", value: two },
			]);
			await expect(
				saveAccountWithIdentityLinks(
					null,
					account("service", email),
					labels,
					repo,
				),
			).rejects.toThrow("account-link-ambiguous");
			expect(await repo.list("asset")).toHaveLength(2);
			expect(await repo.list("relation")).toHaveLength(0);
		} finally {
			await repo.close();
		}
	});
});
