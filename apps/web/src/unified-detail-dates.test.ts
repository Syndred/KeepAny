import { expect, it } from "vitest";
import { assetSchema, newAsset } from "../../../packages/domain/src";
import { detailDates } from "./unified-detail-dates";

it("uses real start dates and calendar days, never purchase, creation or billing anchors", () => {
	const item = {
		...newAsset("item"),
		purchaseDate: "2026-01-01",
		itemStartDate: "2026-05-20",
		warrantyDate: "2027-05-20",
	};
	expect(detailDates(item, "2026-11-05")).toMatchObject({
		elapsed: 169,
		remaining: 196,
	});
	expect(
		detailDates({ ...item, itemStartDate: "" }, "2026-11-05").elapsed,
	).toBeNull();
	const sub = {
		...newAsset("subscription"),
		subscriptionStartDate: "2026-03-28",
		billingAnchor: "2026-11-28",
		dueDate: "2026-11-28",
	};
	expect(detailDates(sub, "2026-11-05")).toMatchObject({
		elapsed: 222,
		remaining: 23,
	});
	expect(
		detailDates({ ...sub, subscriptionStartDate: undefined }, "2026-11-05")
			.elapsed,
	).toBeNull();
	expect(detailDates(sub, "2026-11-06")).toMatchObject({
		elapsed: 223,
		remaining: 22,
	});
});
it("retains future, today, overdue and inactive semantics without manufacturing usage dates", () => {
	const base = {
		...newAsset("subscription"),
		subscriptionStartDate: "2026-11-06",
		dueDate: "2026-11-05",
	};
	expect(detailDates(base, "2026-11-05")).toMatchObject({
		elapsed: -1,
		remaining: 0,
	});
	expect(detailDates(base, "2026-11-07")).toMatchObject({
		elapsed: 1,
		remaining: -2,
	});
	expect(
		detailDates({ ...base, status: "cancelled" }, "2026-11-05").inactive,
	).toBe(true);
	expect(
		detailDates(
			{ ...newAsset("project"), dueDate: "2026-11-06" },
			"2026-11-05",
		),
	).toMatchObject({ elapsed: null, remaining: 1 });
});
it("keeps the new optional start field compatible with legacy assets and rejects invalid dates", () => {
	const legacy = newAsset("subscription");
	expect(assetSchema.parse(legacy).subscriptionStartDate).toBeUndefined();
	expect(
		assetSchema.safeParse({ ...legacy, subscriptionStartDate: "2026-02-30" })
			.success,
	).toBe(false);
	expect(
		assetSchema.parse({ ...legacy, subscriptionStartDate: "2026-03-28" })
			.subscriptionStartDate,
	).toBe("2026-03-28");
});

it("honors explicit warranty exclusions before presenting a live countdown", () => {
	for (const status of ["notApplicable", "outOfWarranty"] as const)
		expect(
			detailDates(
				{
					...newAsset("item"),
					warrantyDate: "2027-05-20",
					itemWarrantyStatus: status,
				},
				"2026-11-05",
			).warrantyBlocked,
		).toBe(true);
	expect(
		detailDates(
			{
				...newAsset("item"),
				warrantyDate: "2027-05-20",
				itemWarrantyStatus: "inWarranty",
			},
			"2026-11-05",
		).warrantyBlocked,
	).toBe(false);
});
