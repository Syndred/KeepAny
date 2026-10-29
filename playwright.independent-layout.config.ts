import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4231");
export default defineConfig({
 webServer: compiledServer(port),
 ...browserDefaults,

	testMatch: [
		"account-layout-independent.spec.ts",
		"account-layout-minimal-independent.spec.ts",
		"account-layout-category-independent.spec.ts",
		"account-password-consolidation.spec.ts",
		"ui-consolidation.spec.ts",
		"account-layout-busy-independent.spec.ts",
	],
	outputDir: `${process.env.KEEPANY_INDEPENDENT_EVIDENCE ?? "test-results/account-layout-independent"}/runs`,

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
	use: { ...browserDefaults.use,
		baseURL: `http://127.0.0.1:${port}`,

	},
});
