import { browserDefaults } from "./scripts/testing/browser-config";
import { defineConfig } from "@playwright/test";
import portableConfig from "./playwright.portable-release.config";

// This checklist case uses UI only; its other fixtures require Vite source imports.
export default defineConfig({
 ...browserDefaults,
	...portableConfig,
	testMatch: "impact-checklist.spec.ts",
	grep: /built PWA keeps the account checklist editable across offline reloads/,
	outputDir: "test-results/portable-offline-checklist",
	workers: 1,
});
