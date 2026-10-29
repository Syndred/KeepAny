import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import independent from "./independent-playwright.config";

export default defineConfig({
	...independent,
	testMatch: ["account-layout-independent.spec.ts", "toast-dialog-layer.spec.ts", "vault-links-layout.spec.ts", "account-layout-busy-independent.spec.ts"],
	grep: /(?:zh-CN 1280|en 390)(?:x900)?(?: |:)/,
	outputDir: resolve("test-results/accounts-single-entry/independent-final-494890/adjacent/browser"),
	reporter: [["list"], ["json", { outputFile: resolve("test-results/accounts-single-entry/independent-final-494890/adjacent/playwright.json") }]],
});
