import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
	newAsset,
	relationSchema,
	taskSchema,
	type Asset,
} from "../../domain/src";
import { openLocalRepository } from "./index";

const open = () =>
	openLocalRepository(`test-purge-${crypto.randomUUID().slice(0, 12)}`);
async function fixture() {
	const db = await open();
	const first = {
		...newAsset("account"),
		name: "Erased account",
		notes: "Erased note",
	};
	const other = { ...newAsset("project"), name: "Keep project" };
	await db.saveBatch([
		{ type: "asset", value: first },
		{ type: "asset", value: other },
	]);
	const relation = relationSchema.parse({
		id: crypto.randomUUID(),
		from: first.id,
		to: other.id,
		label: "Erased connection",
		source: "Erased source",
		createdAt: first.createdAt,
	});
	await db.save("relation", relation);
	await db.save(
		"task",
		taskSchema.parse({
			id: crypto.randomUUID(),
			name: "Erased task",
			assetId: first.id,
			createdAt: first.createdAt,
		}),
	);
	await db.save("history", {
		id: crypto.randomUUID(),
		assetId: first.id,
		action: "maintenance",
		note: "Erased history",
		createdAt: first.createdAt,
	});
	await db.deleteEntity("asset", first.id);
	return { db, first, other, relation };
}

describe("confirmed trash purge", () => {
	it("keeps a synced erasure authoritative when an old remote record arrives", async () => {
		const { db, first } = await fixture();
		try {
			const endpoint = "https://sync.example.test",
				accountId = "synthetic-purge",
				workspaceId = crypto.randomUUID();
			const digest = new Uint8Array(
				await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(JSON.stringify([endpoint, accountId])),
				),
			);
			const scope = `${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}:${workspaceId}`;
			await db.claimDatasetBinding({ endpoint, accountId, workspaceId, scope });
			await db.purgeTrash(
				await db.previewTrashPurge([{ type: "asset", id: first.id }]),
			);
			const row = (await db.allRecords()).find(
				(record) => record.id === `asset:${first.id}`,
			);
			if (!row) throw Error("missing-fixture");
			const operationId = crypto.randomUUID();
			await db.stageScopedOutbox(scope, row, {
				operationId,
				id: row.id,
				kind: "asset",
				schemaVersion: 1,
				expectedVersion: 0,
				ciphertext: "synthetic-erasure",
				tombstone: true,
				intent: "write",
			});
			await db.acknowledgeScopedOutbox(scope, operationId, 1, 1);
			expect(
				await db.applyScopedPull(scope, {
					row: { ...row, payload: JSON.stringify(first) },
					sequence: 1,
					version: 2,
				}),
			).toBe("conflict");
			expect(await db.scopedConflict(scope)).not.toBeNull();
			await expect(db.resolveScopedConflict(scope, "remote")).rejects.toThrow(
				"trash-purged",
			);
			expect(await db.scopedConflict(scope)).not.toBeNull();
			await db.resolveScopedConflict(scope, "local");
			expect((await db.get<Asset>("asset", first.id))?.purged).toBe(true);
			expect(await db.scopedConflict(scope)).toBeNull();
		} finally {
			await db.close();
		}
	});
	it("erases selected content and dependent records, keeps other assets, survives export and refuses recovery", async () => {
		const { db, first, other } = await fixture();
		try {
			const plan = await db.previewTrashPurge([
				{ type: "asset", id: first.id },
			]);
			expect(plan.rows.map((row) => row.type).sort()).toEqual([
				"asset",
				"history",
				"relation",
				"task",
			]);
			await db.purgeTrash(plan);
			expect(await db.get("asset", other.id)).toEqual(other);
			const records = await db.allRecords();
			expect(JSON.stringify(records)).not.toContain("Erased");
			expect((await db.get<Asset>("asset", first.id))?.purged).toBe(true);
			await expect(db.restoreEntity("asset", first.id)).rejects.toThrow(
				"not-in-trash",
			);
			await expect(
				db.save("asset", { ...first, deleted: false }),
			).rejects.toThrow("trash-purged");
			await expect(db.save("history", { id: crypto.randomUUID(), assetId: first.id, action: "maintenance", note: "Queued old edit", createdAt: first.createdAt })).rejects.toThrow("trash-purged");
			await expect(
				db.applyIncoming(
					"asset",
					first,
					(await db.allRecords()).find((row) => row.id === `asset:${first.id}`)
						?.payload ?? null,
				),
			).resolves.toBe("conflict");
			// A retry after the durable write is safe and does not recreate old values.
			await db.purgeTrash(plan);
			const restored = await open();
			try {
				await restored.restoreArchive(await db.exportArchive());
				expect((await restored.get<Asset>("asset", first.id))?.purged).toBe(
					true,
				);
				await expect(restored.restoreEntity("asset", first.id)).rejects.toThrow(
					"not-in-trash",
				);
			} finally {
				await restored.close();
			}
		} finally {
			await db.close();
		}
	});

	it("permanently deletes a connection while keeping both endpoint accounts", async () => {
		const { db, first, other, relation } = await fixture();
		try {
			await db.restoreEntity("asset", first.id);
			await db.deleteEntity("relation", relation.id);
			await db.purgeTrash(
				await db.previewTrashPurge([{ type: "relation", id: relation.id }]),
			);
			expect((await db.get<Asset>("asset", first.id))?.deleted).toBe(false);
			expect(await db.get("asset", other.id)).toEqual(other);
			await expect(db.restoreEntity("relation", relation.id)).rejects.toThrow(
				"not-in-trash",
			);
		} finally {
			await db.close();
		}
	});

	it("rejects a restored root or a new dependent record before writing anything", async () => {
		const { db, first } = await fixture();
		try {
			const plan = await db.previewTrashPurge([
				{ type: "asset", id: first.id },
			]);
			await db.restoreEntity("asset", first.id);
			await expect(db.purgeTrash(plan)).rejects.toThrow("trash-stale");
			await db.deleteEntity("asset", first.id);
			const again = await db.previewTrashPurge([
				{ type: "asset", id: first.id },
			]);
			await db.save("task", {
				id: crypto.randomUUID(),
				name: "New task",
				assetId: first.id,
				createdAt: first.createdAt,
			});
			await expect(db.purgeTrash(again)).rejects.toThrow("trash-stale");
			expect((await db.get<Asset>("asset", first.id))?.name).toBe(first.name);
		} finally {
			await db.close();
		}
	});

	it("checks related edits, refuses live targets and excludes unrelated plan rows", async () => {
		const { db, first, other, relation } = await fixture();
		try {
			await expect(
				db.previewTrashPurge([{ type: "asset", id: other.id }]),
			).rejects.toThrow("trash-stale");
			const plan = await db.previewTrashPurge([
				{ type: "asset", id: first.id },
			]);
			await db.save("relation", {
				...relation,
				label: "New label",
				deleted: true,
			});
			await expect(db.purgeTrash(plan)).rejects.toThrow("trash-stale");
			const current = await db.previewTrashPurge([
				{ type: "asset", id: first.id },
			]);
			const unrelated = (await db.allRecords()).find(
				(row) => row.id === `asset:${other.id}`,
			);
			if (!unrelated) throw Error("missing-fixture");
			current.rows.push(unrelated);
			await expect(db.purgeTrash(current)).rejects.toThrow("trash-stale");
			expect(await db.get("asset", other.id)).toEqual(other);
		} finally {
			await db.close();
		}
	});

	it("releases unique attachments and keeps shared attachments", async () => {
		const { db, first, other } = await fixture();
		try {
			const unique = await db.putFile(
				new File(["unique"], "unique.png", { type: "image/png" }),
			);
			const shared = await db.putFile(
				new File(["shared"], "shared.png", { type: "image/png" }),
			);
			const deleted = await db.get<Asset>("asset", first.id);
			if (!deleted) throw Error("missing-fixture");
			await db.save("asset", { ...deleted, attachments: [unique, shared] });
			await db.save("asset", { ...other, attachments: [shared] });
			await db.purgeTrash(
				await db.previewTrashPurge([{ type: "asset", id: first.id }]),
			);
			expect(await db.fileStore.blobs.get(unique)).toBeUndefined();
			expect(await db.fileStore.blobs.get(shared)).toBeDefined();
		} finally {
			await db.close();
		}
	});

	it("retains data after a failed storage write and allows the reviewed plan to retry", async () => {
		const { db, first } = await fixture();
		try {
			const plan = await db.previewTrashPurge([
				{ type: "asset", id: first.id },
			]);
			const fault = vi
				.spyOn(db.db.records.storageInstance, "bulkWrite")
				.mockRejectedValueOnce(Error("injected-write"));
			await expect(db.purgeTrash(plan)).rejects.toThrow("injected-write");
			fault.mockRestore();
			expect((await db.get<Asset>("asset", first.id))?.name).toBe(first.name);
			await db.purgeTrash(plan);
			expect((await db.get<Asset>("asset", first.id))?.purged).toBe(true);
		} finally {
			await db.close();
		}
	});
});
