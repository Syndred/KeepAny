import { calendarDayDistance, type Asset } from "../../../packages/domain/src";

export function detailDates(asset: Asset, today: string) {
	const remainingDate =
		asset.kind === "item" ? asset.warrantyDate : asset.dueDate;
	const startedDate =
		asset.kind === "item"
			? asset.itemStartDate
			: asset.kind === "subscription"
				? (asset.subscriptionStartDate ?? "")
				: (asset.usageStartDate ?? "");
	const distance = (from: string, to: string) => {
		if (!from || !to) return null;
		try {
			return calendarDayDistance(from, to);
		} catch {
			return null;
		}
	};
	return {
		remainingDate,
		warrantyBlocked:
			asset.kind === "item" &&
			["notApplicable", "outOfWarranty"].includes(
				asset.itemWarrantyStatus ?? "",
			),
		remaining: distance(today, remainingDate),
		startedDate,
		elapsed: distance(startedDate, today),
		// Cancelled/archived records keep their factual dates, without a live countdown.
		inactive: asset.status === "cancelled" || asset.status === "archived",
	};
}
