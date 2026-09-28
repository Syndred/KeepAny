import { describe, expect, it } from "vitest";
import { monthlyMinorUnits, newAsset } from "./index";
import {
	formatMinorUnits,
	inputFromMinorUnits,
	parseMinorUnits,
} from "./money";

describe("currency minor units at the UI boundary", () => {
	it("keeps the last cent of a large valid amount through input and display", () => {
		const maximum = Number.MAX_SAFE_INTEGER;
		expect(inputFromMinorUnits(maximum, "USD")).toBe("90071992547409.91");
		expect(parseMinorUnits("90071992547409.91", "USD")).toBe(maximum);
		expect(formatMinorUnits(maximum, "USD", "en-US")).toBe(
			"$90,071,992,547,409.91",
		);
		expect(formatMinorUnits(9007199254740001, "USD", "en-US")).toBe(
			"$90,071,992,547,400.01",
		);
	});

	it("accepts blank as zero and rejects extra precision or an unsafe integer", () => {
		expect(parseMinorUnits("", "USD")).toBe(0);
		expect(parseMinorUnits("12.34", "USD")).toBe(1234);
		expect(parseMinorUnits("12.345", "USD")).toBeNaN();
		expect(parseMinorUnits("90071992547409.92", "USD")).toBeNaN();
		expect(parseMinorUnits("12.1", "JPY")).toBeNaN();
		expect(parseMinorUnits("9007199254740991", "JPY")).toBe(
			Number.MAX_SAFE_INTEGER,
		);
		expect(formatMinorUnits(1234, "JPY", "en-US")).toBe("¥1,234");
	});

	it("keeps a large monthly total exact across subscriptions", () => {
		const first = {
			...newAsset("subscription"),
			amount: Number.MAX_SAFE_INTEGER,
			cycle: "month" as const,
		};
		const second = {
			...newAsset("subscription"),
			amount: 9,
			cycle: "month" as const,
		};
		const total = monthlyMinorUnits(first) + monthlyMinorUnits(second);
		expect(total).toBe(9007199254741000n);
		expect(formatMinorUnits(total, "USD", "en-US")).toBe(
			"$90,071,992,547,410.00",
		);
	});
});
