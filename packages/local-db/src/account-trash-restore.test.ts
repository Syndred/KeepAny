import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { newAsset, type Asset } from "../../domain/src";
import {
	AccountRestoreConflict,
	LocalRepository,
	openLocalRepository,
} from "./index";

const account = (changes: Partial<Asset> = {}): Asset => ({
	...newAsset("account"),
	name: "Notion",
	username: "owner@example.com",
	...changes,
});

describe("account restoration after re-import", () => {
	it("keeps the old account in trash and identifies the current account without reviving its connections", async () => {
		const db = await openLocalRepository(
			`account-restore-${crypto.randomUUID()}`,
		);
		try {
			const old = account(),
				current = account({ name: "notion", username: "OWNER@example.com" });
			const mailbox = account({ name: "Mailbox", category: "email" });
			for (const asset of [old, mailbox]) await db.save("asset", asset);
			const line = {
				id: crypto.randomUUID(),
				from: old.id,
				to: mailbox.id,
				label: "Login email",
				createdAt: new Date().toISOString(),
			};
			await db.save("relation", line);
			await db.deleteEntity("asset", old.id);
			await db.save("asset", current);
			const before = await db.get<Asset>("asset", old.id);
			await expect(db.restoreEntity("asset", old.id)).rejects.toMatchObject({
				message: "account-restore-conflict",
				existingId: current.id,
			});
			expect(await db.get("asset", old.id)).toEqual(before);
			expect(
				(await db.list<Asset>("asset")).map((asset) => asset.id).sort(),
			).toEqual([current.id, mailbox.id].sort());
			await db.deleteEntity("asset", current.id);
			await db.restoreEntity("asset", old.id);
			expect((await db.get<Asset>("asset", old.id))?.deleted).toBe(false);
			expect(
				(await db.list<Asset>("asset")).filter(
					(asset) => asset.name === old.name,
				),
			).toHaveLength(1);
		} finally {
			await db.close();
		}
	});

	it.each([
		[
			{ category: "phone", username: "+86 13812345678" },
			{ category: "phone", name: "My phone", username: "13812345678" },
		],
		[
			{ category: "email" },
			{
				category: "email",
				name: "Main mailbox",
				username: "ｏｗｎｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ",
			},
		],
	])(
		"also protects renamed mailbox and phone identity records (%j)",
		async (left, right) => {
			const db = await openLocalRepository(
				`account-restore-${crypto.randomUUID()}`,
			);
			try {
				const old = account(left),
					current = account(right);
				await db.save("asset", old);
				await db.deleteEntity("asset", old.id);
				await db.save("asset", current);
				await expect(db.restoreEntity("asset", old.id)).rejects.toBeInstanceOf(
					AccountRestoreConflict,
				);
			} finally {
				await db.close();
			}
		},
	);

	it.each([
		[{ username: "first@example.com" }, { username: "second@example.com" }],
		[{}, { name: "Figma" }],
		[{ username: "" }, { username: "" }],
		[{ username: "CaseSensitiveHandle" }, { username: "casesensitivehandle" }],
	])(
		"restores distinct platform accounts without treating them as duplicates (%j)",
		async (left, right) => {
			const db = await openLocalRepository(
				`account-restore-${crypto.randomUUID()}`,
			);
			try {
				const old = account(left),
					current = account(right);
				await db.save("asset", old);
				await db.deleteEntity("asset", old.id);
				await db.save("asset", current);
				await db.restoreEntity("asset", old.id);
				expect(await db.list("asset")).toHaveLength(2);
			} finally {
				await db.close();
			}
		},
	);

	it("serializes two competing restorations and keeps exactly one account live", async () => {
		const db = await openLocalRepository(
			`account-restore-${crypto.randomUUID()}`,
		);
		try {
			const a = account(),
				b = account();
			for (const asset of [a, b]) {
				await db.save("asset", asset);
				await db.deleteEntity("asset", asset.id);
			}
			const results = await Promise.allSettled([
				db.restoreEntity("asset", a.id),
				db.restoreEntity("asset", b.id),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(
				results.find((result) => result.status === "rejected"),
			).toMatchObject({ reason: { message: "account-restore-conflict" } });
			expect(await db.list("asset")).toHaveLength(1);
		} finally {
			await db.close();
		}
	});

	it("sees another repository's re-import after reading the old account list", async () => {
		const name = `account-restore-${crypto.randomUUID()}`;
		const first = await openLocalRepository(name);
		const second = new LocalRepository(first.records, first.fileStore);
		try {
			const old = account(),
				current = account();
			await first.save("asset", old);
			await first.deleteEntity("asset", old.id);
			await first.list("asset");
			await second.save("asset", current);
			await expect(first.restoreEntity("asset", old.id)).rejects.toMatchObject({
				existingId: current.id,
			});
			expect((await first.get<Asset>("asset", old.id))?.deleted).toBe(true);
		} finally {
			await first.close();
		}
	});
});
