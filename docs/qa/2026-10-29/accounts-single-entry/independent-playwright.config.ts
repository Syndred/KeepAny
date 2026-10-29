import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
	testDir: resolve("tests/e2e"),
	testMatch: ["accounts-single-entry.spec.ts", "account-password-consolidation.spec.ts", "account-link-recovery.spec.ts", "password-vault-user-journey.spec.ts"],
	outputDir: resolve(process.env.KEEPANY_INDEPENDENT_RESULTS ?? "docs/qa/2026-10-29/accounts-single-entry/independent-results"),
	timeout: 150_000,
	retries: 0,
	workers: 1,
	reporter: [["list"], ["json", { outputFile: resolve(process.env.KEEPANY_INDEPENDENT_REPORT ?? "docs/qa/2026-10-29/accounts-single-entry/independent-results.json") }]],
	use: { baseURL: process.env.KEEPANY_SINGLE_ENTRY_URL ?? "http://127.0.0.1:4397", actionTimeout: 15_000, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
