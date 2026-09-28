import { describe, expect, it } from "vitest";
import { entitlementsSchema, entitlementTokenPolicy } from "./index";

describe("commercial entitlement contract", () => {
	it("keeps unmeasured usage unknown and limits bearer lifetime to one minute", () => {
		expect(entitlementTokenPolicy.maxAgeSeconds).toBe(60);
		expect(
			entitlementsSchema.parse({
				version: 1,
				subject: "keepanyadm:user-1",
				plan: "plus",
				status: "active",
				limits: { storageBytes: 1_000, aiCreditsMonthly: 50, devices: 2 },
				usage: { storageBytes: null, aiCreditsUsed: null },
				expiresAt: null,
				updatedAt: new Date().toISOString(),
			}).usage,
		).toEqual({ storageBytes: null, aiCreditsUsed: null });
	});
});
