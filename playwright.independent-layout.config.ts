import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: [
		"account-layout-independent.spec.ts",
		"account-layout-minimal-independent.spec.ts",
		"account-layout-category-independent.spec.ts",
		"account-password-consolidation.spec.ts",
		"ui-consolidation.spec.ts",
		"account-layout-busy-independent.spec.ts",
	],
	outputDir: `${process.env.KEEPANY_INDEPENDENT_EVIDENCE ?? "test-results/account-layout-independent"}/runs`,
	retries: 0,
	workers: 1,
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile: `${process.env.KEEPANY_INDEPENDENT_EVIDENCE ?? "test-results/account-layout-independent"}/results.json`,
			},
		],
	],
	use: {
		baseURL: `http://127.0.0.1:${process.env.KEEPANY_RELEASE_TEST_PORT ?? "4231"}`,
		screenshot: "only-on-failure",
	},
});
