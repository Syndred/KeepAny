import { describe, expect, it } from "vitest";
import { newAsset, type History } from "../../../packages/domain/src";
import { detailHistoryRows, withDetailImages } from "./unified-detail-data";

const renewal: History = {
	id: "renewal",
	assetId: "subscription",
	action: "renew",
	note: "Original receipt",
	amount: 2800,
	currency: "CNY",
	billDate: "2026-09-28",
	createdAt: "2026-09-28T00:00:00.000Z",
	deleted: false,
	financeCorrection: {
		note: "Corrected bill",
		eventDate: "2026-09-29",
		amount: 2100,
		currency: "CNY",
		hidden: false,
		assetIds: ["ordinary", "wallet"],
	},
};
describe("unified detail history", () => {
	it("keeps immutable renewal evidence on its original subscription", () => {
		expect(detailHistoryRows([renewal], "subscription")).toEqual([renewal]);
	});
	it("shows corrected bill presentation on both current owners without duplicates", () => {
		for (const id of ["ordinary", "wallet"])
			expect(detailHistoryRows([renewal], id)).toMatchObject([
				{ note: "Corrected bill", amount: 2100, billDate: "2026-09-29" },
			]);
	});
	it("honors hidden ledger rows while retaining the original renewal", () => {
		const hidden = {
			...renewal,
			financeCorrection: { ...renewal.financeCorrection!, hidden: true },
		};
		expect(detailHistoryRows([hidden], "ordinary")).toEqual([]);
		expect(detailHistoryRows([hidden], "subscription")).toEqual([hidden]);
	});
	it("excludes deleted and unrelated records", () => {
		expect(
			detailHistoryRows([{ ...renewal, deleted: true }], "subscription"),
		).toEqual([]);
		expect(detailHistoryRows([renewal], "other")).toEqual([]);
	});
});
describe("unified gallery role references", () => {
	const asset = {
		...newAsset("project"),
		attachments: ["old", "keep"],
		projectMedia: {
			logoId: "old",
			homeScreenshotId: "old",
			promoCoverId: "keep",
			productScreenshotIds: ["old", "keep"],
		},
	};
	it("replaces every reference to the chosen image and keeps other roles", () => {
		expect(
			withDetailImages(asset, ["new", "keep"], "old", "new").projectMedia,
		).toEqual({
			logoId: "new",
			homeScreenshotId: "new",
			promoCoverId: "keep",
			productScreenshotIds: ["new", "keep"],
		});
	});
	it("clears removed references without mutating the source", () => {
		expect(withDetailImages(asset, ["keep"]).projectMedia).toEqual({
			logoId: "",
			homeScreenshotId: "",
			promoCoverId: "keep",
			productScreenshotIds: ["keep"],
		});
		expect(asset.projectMedia.logoId).toBe("old");
	});
	it("preserves existing roles when appending an image", () => {
		expect(
			withDetailImages(asset, ["old", "keep", "new"]).projectMedia,
		).toEqual(asset.projectMedia);
	});
});
