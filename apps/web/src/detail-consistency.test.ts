import { expect, it } from "vitest";
import { assetSchema, newAsset } from "../../../packages/domain/src";
import { applyCatalogEdit, catalogRecords } from "./catalog-records";
import { detailDates } from "./unified-detail-dates";

it("preserves an explicit generic usage date and computes it independently of expiry", () => {
	const asset = assetSchema.parse({
		...newAsset("project"),
		usageStartDate: "2026-03-05",
		dueDate: "2027-03-18",
		createdAt: "2026-11-06T00:00:00Z",
	});
	expect(asset.usageStartDate).toBe("2026-03-05");
	expect(detailDates(asset, "2026-11-06")).toMatchObject({
		elapsed: 246,
		remaining: 132,
	});
	expect(detailDates({ ...asset, dueDate: "" }, "2026-11-06")).toMatchObject({
		elapsed: 246,
		remaining: null,
	});
	expect(
		detailDates({ ...asset, usageStartDate: undefined }, "2026-11-06").elapsed,
	).toBeNull();
	expect(
		detailDates({ ...asset, usageStartDate: "2026-11-07" }, "2026-11-06")
			.elapsed,
	).toBe(-1);
});

it("keeps legacy payloads unchanged and validates the optional generic date", () => {
	const legacy = newAsset("project");
	expect(assetSchema.parse(legacy).usageStartDate).toBeUndefined();
	expect(
		assetSchema.safeParse({ ...legacy, usageStartDate: "2026-02-30" }).success,
	).toBe(false);
	expect(
		assetSchema.parse({ ...legacy, usageStartDate: "" }).usageStartDate,
	).toBe("");
});

it("isolates each domain usage date from its owner and sibling on projection and edit", () => {
	const catalog = {
		categoryId: "",
		name: "one.example.test",
		url: "https://one.example.test",
		tags: [],
		status: "active",
		notes: "",
		attachments: [],
		deleted: false,
		usageStartDate: "2026-04-05",
	};
	const owner = assetSchema.parse({
		...newAsset("project"),
		usageStartDate: "2025-01-01",
		projectDomains: [
			{
				id: "00000000-0000-4000-8000-000000000001",
				name: "one.example.test",
				catalog,
			},
			{ id: "00000000-0000-4000-8000-000000000002", name: "two.example.test" },
		],
	});
	const [root, one, two] = catalogRecords([owner], []);
	expect(root.asset.usageStartDate).toBe("2025-01-01");
	expect(one.asset.usageStartDate).toBe("2026-04-05");
	expect(two.asset.usageStartDate).toBeUndefined();
	const next = applyCatalogEdit(
		one,
		{ ...one.asset, usageStartDate: "2026-05-06" },
		"",
	);
	expect(next.usageStartDate).toBe(owner.usageStartDate);
	expect(next.projectDomains[0].catalog?.usageStartDate).toBe("2026-05-06");
	expect(next.projectDomains[1]).toEqual(owner.projectDomains[1]);
	expect(
		assetSchema.safeParse({
			...next,
			projectDomains: [
				{
					...next.projectDomains[0],
					catalog: {
						...next.projectDomains[0].catalog,
						usageStartDate: "invalid",
					},
				},
			],
		}).success,
	).toBe(false);
});
