import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import independent from "./independent-playwright.config";

export default defineConfig({
	...independent,
	testMatch: ["account-layout-independent.spec.ts", "toast-dialog-layer.spec.ts", "vault-links-layout.spec.ts", "account-layout-busy-independent.spec.ts"],
	grep: /(?:zh-CN 1280|en 390)(?:x900)?(?: |:)/,
	outputDir: resolve(process.env.KEEPANY_INDEPENDENT_RESULTS ?? "test-results/accounts-single-entry/independent-adjacent/browser"),
	reporter: [["list"], ["json", { outputFile: resolve(process.env.KEEPANY_INDEPENDENT_REPORT ?? "test-results/accounts-single-entry/independent-adjacent/playwright.json") }]],
});
