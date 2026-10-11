import { defineConfig } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

// Opt-in diagnostic for a real storage failure; never included in the normal
// release suite. Always serve the delivered production package in isolation.
const port = Number(process.env.KEEPANY_QUOTA_TEST_PORT ?? "4403");
const baseURL = `http://127.0.0.1:${port}`;
let archive = process.env.KEEPANY_PREVIEW_ARCHIVE;
if (!archive && !process.env.KEEPANY_PREVIEW_DIRECTORY) {
	const directory = resolve("dist/preview");
	archive = readdirSync(directory).filter(name => name.endsWith(".zip"))
		.map(name => ({ path: join(directory, name), modified: statSync(join(directory, name)).mtimeMs }))
		.sort((a, b) => b.modified - a.modified)[0]?.path;
	if (!archive) throw Error("Build a portable preview before quota acceptance.");
}
let release;
if (process.env.KEEPANY_PREVIEW_DIRECTORY) release = JSON.parse(readFileSync(join(process.env.KEEPANY_PREVIEW_DIRECTORY, "RELEASE.json"), "utf8"));
else {
	const files = unzipSync(readFileSync(archive!));
	const metadata = Object.entries(files).find(([path]) => path.endsWith("/RELEASE.json"))?.[1];
	if (!metadata) throw Error("Portable release metadata missing.");
	release = JSON.parse(strFromU8(metadata));
}
const entry = release.webFiles.find((file: { path: string }) => /^assets\/index-.*\.js$/.test(file.path));
if (!entry) throw Error("Portable application entry missing.");
process.env.KEEPANY_QUOTA_PACKAGE_ENTRY = `/${entry.path}`;
process.env.KEEPANY_QUOTA_PACKAGE_COMMIT = release.sourceCommit;

export default defineConfig({
	testDir: "./tests/e2e",
	testMatch: "storage-quota-recovery.spec.ts",
	outputDir: "test-results/quota-review",
	timeout: 120_000,
	workers: 1,
	use: { baseURL, screenshot: "only-on-failure", trace: "retain-on-failure" },
	webServer: {
		command: "node scripts/serve-preview-for-tests.mjs",
		env: { KEEPANY_RELEASE_TEST_PORT: String(port), ...(archive ? { KEEPANY_PREVIEW_ARCHIVE: resolve(archive) } : {}) },
		url: baseURL,
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
