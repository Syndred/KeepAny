import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newAsset, type Asset } from "../../../packages/domain/src";
import { openLocalRepository } from "../../../packages/local-db/src";
import { addSampleLibrary, SAMPLE_LIBRARY_ID, sampleLibraryComplete } from "./sample-library";
import { COLLECTIONS_PREFERENCE_ID } from "./collection-model";
import { resources } from "./i18n";

const t = (key: string) => resources.en.translation[key] ?? key;
const image = readFileSync("apps/web/public/samples/laptop.png");
const imageFetch = () => new Response(image, { headers: { "content-type": "image/png" } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sample installation through the real local repository", () => {
	it("removes unreferenced files after an image load failure and allows a clean retry", async () => {
		const repository = await openLocalRepository(`sample-fetch-${crypto.randomUUID().slice(0, 8)}`);
		let count = 0;
		vi.stubGlobal("fetch", vi.fn(async () => ++count === 3 ? new Response("missing", { status: 404 }) : imageFetch()));
		try {
			await expect(addSampleLibrary(t, "en", repository)).rejects.toThrow("sample-image-missing");
			expect(await repository.list("asset")).toHaveLength(0);
			expect(await repository.fileStore.blobs.count()).toBe(0);
			expect(await repository.get("preference", SAMPLE_LIBRARY_ID)).toBeNull();
			vi.stubGlobal("fetch", vi.fn(async () => imageFetch()));
			await expect(addSampleLibrary(t, "en", repository)).resolves.toBe(true);
			expect(await repository.list("asset")).toHaveLength(24);
		} finally { await repository.close(); }
	});
	it("resumes committed sample IDs and atomic item transitions, preserves user data and collections, and deduplicates", async () => {
		const repository = await openLocalRepository(`sample-retry-${crypto.randomUUID().slice(0, 8)}`);
		const original = { ...newAsset("project"), name: "Existing user project" };
		const collection = { id: "existing-user-collection", name: "User collection", assetIds: [original.id] };
		vi.stubGlobal("fetch", vi.fn(async () => imageFetch()));
		try {
			await repository.save("asset", original);
			await repository.savePreferenceIfCurrent(null, { id: COLLECTIONS_PREFERENCE_ID, value: [collection] });
			const interrupted = vi.spyOn(repository, "setItemArchived").mockRejectedValueOnce(Error("synthetic-interruption"));
			await expect(addSampleLibrary(t, "en", repository)).rejects.toThrow("synthetic-interruption");
			const before = await repository.list<Asset>("asset");
			expect(before).toHaveLength(25);
			expect(await repository.fileStore.blobs.count()).toBe(8);
			interrupted.mockRestore();
			await expect(addSampleLibrary(t, "en", repository)).resolves.toBe(true);
			const after = await repository.list<Asset>("asset");
			expect(after.map((asset) => asset.id).sort()).toEqual(before.map((asset) => asset.id).sort());
			expect(await repository.get("asset", original.id)).toEqual(original);
			expect(after.some((asset) => asset.status === "loaned")).toBe(true);
			expect(after.some((asset) => asset.status === "archived" && asset.itemLifecycleStatus === "resold")).toBe(true);
			const collections = await repository.get<{ value: unknown[] }>("preference", COLLECTIONS_PREFERENCE_ID);
			expect(collections?.value[0]).toEqual(collection);
			expect(collections?.value).toHaveLength(2);
			const marker = await repository.get<{ value: unknown }>("preference", SAMPLE_LIBRARY_ID);
			expect(sampleLibraryComplete(marker?.value)).toBe(true);
			const history = await repository.list("history");
			await expect(addSampleLibrary(t, "en", repository)).resolves.toBe(false);
			expect(await repository.list("history")).toHaveLength(history.length);
			expect(await repository.fileStore.blobs.count()).toBe(8);
			expect(fetch).toHaveBeenCalledTimes(8);
		} finally { await repository.close(); }
	});
});
