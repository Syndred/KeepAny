import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { assetSchema, newAsset, type Asset } from "../../domain/src";
import { openLocalRepository } from "./index";
import {
	applyCatalogEdit,
	catalogRecords,
} from "../../../apps/web/src/catalog-records";

const open = () =>
	openLocalRepository(`catalog-${crypto.randomUUID().slice(0, 12)}`);
describe("stable catalog categories and backwards-compatible records", () => {
	it("serializes normalized duplicate names, reserves fixed pages and rejects stale category writes", async () => {
		const db = await open();
		try {
			const attempts = await Promise.allSettled([
				db.saveCatalogCategory(null, { name: " Work " }),
				db.saveCatalogCategory(null, { name: "ｗＯＲＫ" }),
			]);
			expect(
				attempts.filter((value) => value.status === "fulfilled"),
			).toHaveLength(1);
			const category = (await db.list<any>("category"))[0];
			await db.saveCatalogCategory(category, { name: "Renamed", hidden: true });
			await expect(
				db.saveCatalogCategory(category, { name: "Stale" }),
			).rejects.toThrow("category-stale");
			for (const name of [
				"",
				"全部",
				"ＡＬＬ",
				"Ledger",
				"实物",
				"订阅",
				"x".repeat(61),
			])
				await expect(db.saveCatalogCategory(null, { name })).rejects.toThrow(
					"category-",
				);
		} finally {
			await db.close();
		}
	});
	it("rename, hide and removal keep assets verbatim; removed IDs are safely unclassified", async () => {
		const db = await open();
		try {
			const category = await db.saveCatalogCategory(null, {
				name: "Collection",
			});
			const asset = {
				...newAsset("project"),
				name: "Keepsake",
				catalogCategoryId: category.id,
				projectTitle: "Historical title",
				contact: "Historical contact",
			};
			await db.saveCatalogAsset(null, asset, category.id);
			const renamed = await db.saveCatalogCategory(category, {
				name: "Keepsakes",
				hidden: true,
			});
			expect(await db.get("asset", asset.id)).toEqual(asset);
			await db.saveCatalogCategory(renamed, {
				name: renamed.name,
				deleted: true,
			});
			expect(await db.get("asset", asset.id)).toEqual(asset);
			const categories = await db.list<any>("category", true);
			expect(catalogRecords([asset], categories)[0].categoryId).toBe("");
			await expect(
				db.saveCatalogAsset(asset, { ...asset, name: "Changed" }, category.id),
			).rejects.toThrow("category-stale");
			await db.saveCatalogAsset(
				asset,
				{ ...asset, name: "Changed", catalogCategoryId: "" },
				"",
			);
		} finally {
			await db.close();
		}
	});
	it("preserves legacy project/domain data and generic metadata in a backup round trip", async () => {
		const db = await open(),
			other = await open();
		try {
			const projectCategory = await db.saveCatalogCategory(null, {
				name: "project",
				source: "project",
			});
			const domainCategory = await db.saveCatalogCategory(null, {
				name: "domains",
				source: "domains",
			});
			const legacy = assetSchema.parse({
				...newAsset("project"),
				catalogCategoryId: undefined,
				name: "Historical",
				longDescription: "Private old copy",
				notes: "Plain note",
				projectDomains: [
					{
						id: crypto.randomUUID(),
						name: "example.test",
						registrar: "Old registrar",
						annualAmount: 1000,
						expiryDate: "2027-10-30",
						autoRenew: "on",
					},
				],
			});
			const records = catalogRecords(
				[legacy],
				[projectCategory, domainCategory],
			);
			expect(records.map((record) => record.categoryId)).toEqual([
				projectCategory.id,
				domainCategory.id,
			]);
			const record = records[1],
				draft = {
					...record.asset,
					name: "Display label",
					notes: "Domain note",
					url: "",
					tags: ["test"],
					updatedAt: new Date().toISOString(),
				};
			const next = applyCatalogEdit(record, draft, domainCategory.id);
			expect(next.longDescription).toBe(legacy.longDescription);
			expect(next.projectDomains[0]).toMatchObject({
				name: "example.test",
				registrar: "Old registrar",
				annualAmount: 1000,
				autoRenew: "on",
			});
			await db.save("asset", next);
			await other.restoreArchive(await db.exportArchive());
			const restored = await other.get<Asset>("asset", legacy.id);
			expect(restored).toEqual(next);
			expect(
				catalogRecords([restored!], await other.list("category"))[1].asset,
			).toMatchObject({ name: "Display label", notes: "Domain note", url: "" });
		} finally {
			await db.close();
			await other.close();
		}
	});
	it("does not resurrect removed legacy categories and does not overwrite changed records", async () => {
		const db = await open();
		try {
			const group = await db.saveCatalogCategory(null, {
				name: "project",
				source: "project",
			});
			await db.saveCatalogCategory(group, { name: "project", deleted: true });
			expect(
				(
					await db.saveCatalogCategory(null, {
						name: "project",
						source: "project",
					})
				).deleted,
			).toBe(true);
			const asset = { ...newAsset("project"), name: "First" };
			await db.saveCatalogAsset(null, asset, "");
			await db.saveCatalogAsset(asset, { ...asset, name: "Latest" }, "");
			await expect(
				db.saveCatalogAsset(asset, { ...asset, name: "Stale" }, ""),
			).rejects.toThrow("asset-stale");
		} finally {
			await db.close();
		}
	});
	it("keeps legacy custom-category IDs and membership through rename/removal without rewriting old records", async () => {
		const db = await open();
		try {
			const old = await db.createCategory("project", "Legacy Work", 0);
			const asset = {
				...newAsset("project"),
				catalogCategoryId: undefined,
				category: old.name,
				name: "Old work",
			};
			const other = {
				...newAsset("project"),
				catalogCategoryId: undefined,
				category: "other",
				name: "Other",
			};
			await db.saveBatch([
				{ type: "asset", value: asset },
				{ type: "asset", value: other },
			]);
			expect(
				catalogRecords([asset, other], [old]).map(
					(record) => record.categoryId,
				),
			).toEqual([old.id, ""]);
			const renamed = await db.saveCatalogCategory(old, {
				name: "Renamed work",
			});
			expect(renamed.id).toBe(old.id);
			expect(renamed.legacyName).toBe(old.name);
			expect(
				catalogRecords([asset, other], [renamed]).map(
					(record) => record.categoryId,
				),
			).toEqual([old.id, ""]);
			expect(await db.get("asset", asset.id)).toEqual(asset);
			await db.saveCatalogCategory(renamed, {
				name: renamed.name,
				deleted: true,
			});
			expect(
				catalogRecords([asset], await db.list("category", true))[0].categoryId,
			).toBe("");
		} finally {
			await db.close();
		}
	});
	it("initializes default legacy groups even when old user names match their internal keys", async () => {
		const db = await open();
		try {
			await db.createCategory("project", "project", 0);
			await db.createCategory("project", "domains", 1);
			const group = await db.saveCatalogCategory(null, {
				name: "project",
				source: "project",
			});
			expect(group.name).toBe("project (2)");
			expect(
				(
					await db.saveCatalogCategory(null, {
						name: "project",
						source: "project",
					})
				).id,
			).toBe(group.id);
			expect(
				(
					await db.saveCatalogCategory(null, {
						name: "domains",
						source: "domains",
					})
				).name,
			).toBe("domains (2)");
		} finally {
			await db.close();
		}
	});
});
