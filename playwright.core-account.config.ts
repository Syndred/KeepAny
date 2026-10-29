import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import vaultTools from "./playwright.vault-tools.config";

export default defineConfig({
	...vaultTools,
	testMatch: "core-account-isolation.spec.ts",
	outputDir: resolve(
		process.env.KEEPANY_CORE_ACCOUNT_OUTPUT ??
			"test-results/core-account-isolation",
	),
	workers: 1,
});
