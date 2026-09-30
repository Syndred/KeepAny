import { describe, expect, it } from "vitest";
import { newAsset, type Asset } from "../../../packages/domain/src";
import { matchesAssetSearch } from "./asset-search";

describe("public asset search", () => {
	it.each([
		["name", { name: "Studio Camera" }, "STUDIO CAMERA"],
		["tag", { tags: ["studio", "Field Camera"] }, "FIELD CAMERA"],
		["URL", { url: "https://camera.example/Guide" }, "CAMERA.EXAMPLE/GUIDE"],
		[
			"account identifier",
			{ username: "CameraOwner@example.test" },
			"CAMERAOWNER@EXAMPLE.TEST",
		],
		[
			"item location",
			{ location: "书房 → 工作桌 → Second Drawer" },
			"  SECOND DRAWER  ",
		],
	] satisfies [string, Partial<Asset>, string][])(
		"matches %s without case sensitivity",
		(_field, values, query) => {
			expect(
				matchesAssetSearch({ ...newAsset("item"), ...values }, query),
			).toBe(true);
		},
	);

	it("finds public profile, payment, category and project domain details", () => {
		const asset = {
			...newAsset("project"),
			category: "Studio equipment",
			description: "Compact travel camera",
			contact: "Public contact desk",
			borrower: "Loan recipient",
			accountProvider: "Example identity provider",
			subscriptionPaymentMethod: "Visa ending 4242",
			projectTitle: "Camera toolkit",
			projectEmail: "support@toolkit.example",
			projectDomains: [
				{
					id: crypto.randomUUID(),
					name: "toolkit.example",
					registrar: "Domain registrar",
					accountId: "private-domain-account",
					expiryDate: "",
					annualAmount: null,
					currency: "CNY" as const,
					autoRenew: "unknown" as const,
				},
			],
		};
		for (const query of [
			"equipment",
			"travel camera",
			"contact desk",
			"loan recipient",
			"identity provider",
			"4242",
			"camera toolkit",
			"support@",
			"toolkit.example",
			"domain registrar",
		])
			expect(matchesAssetSearch(asset, query)).toBe(true);
		expect(matchesAssetSearch(asset, "private-domain-account")).toBe(false);
	});

	it("never searches hidden metadata, private notes or arbitrary sensitive properties", () => {
		const hidden = "hidden-secret-needle";
		const asset = {
			...newAsset("account"),
			name: "Public account",
			id: hidden,
			notes: hidden,
			lastRenewalId: hidden,
			lastSubscriptionSaveId: hidden,
			lastItemEventId: hidden,
			attachments: [hidden],
			projectMedia: {
				logoId: hidden,
				homeScreenshotId: "",
				productScreenshotIds: [],
				promoCoverId: "",
			},
			password: hidden,
			recoveryCode: hidden,
			token: hidden,
		};
		expect(matchesAssetSearch(asset, hidden)).toBe(false);
		expect(matchesAssetSearch(asset, "public account")).toBe(true);
	});

	it("excludes deleted records even for empty or matching queries", () => {
		const asset = {
			...newAsset("item"),
			name: "Deleted camera",
			location: "Secret shelf",
			deleted: true,
		};
		for (const query of ["", " ", "camera", "shelf"])
			expect(matchesAssetSearch(asset, query)).toBe(false);
	});

	it("keeps blank searches unfiltered and nonmatching searches empty", () => {
		const asset = {
			...newAsset("item"),
			name: "Camera",
			location: "书房 → 抽屉",
		};
		expect(matchesAssetSearch(asset, " ")).toBe(true);
		expect(matchesAssetSearch(asset, "抽屉")).toBe(true);
		expect(matchesAssetSearch(asset, "missing shelf")).toBe(false);
	});
});
