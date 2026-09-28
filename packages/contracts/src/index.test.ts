import { describe, expect, it } from "vitest";
import { entitlementsSchema, entitlementTokenPolicy, syncChangeSchema } from "./index";

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

describe("sync pull contract", () => {
	it("requires the original operation ID for envelope authentication", () => {
		const change = {
			operationId: crypto.randomUUID(), id: `asset:${crypto.randomUUID()}`, kind: "asset",
			schemaVersion: 1, ciphertext: "opaque", tombstone: false, version: 1, sequence: 1,
		};
		expect(syncChangeSchema.parse(change).operationId).toBe(change.operationId);
		expect(syncChangeSchema.safeParse({ ...change, operationId: undefined }).success).toBe(false);
	});
});
