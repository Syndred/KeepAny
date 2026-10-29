import { defineConfig } from "@playwright/test";
import portableConfig from "./playwright.portable-release.config";

export default defineConfig({
	...portableConfig,
	testMatch: "pdf-removal-release.spec.ts",
	outputDir: "test-results/pdf-removal-release",
	workers: 1,
});
