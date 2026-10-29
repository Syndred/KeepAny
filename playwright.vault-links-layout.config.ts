import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { browserDefaults, compiledServer, reviewedSnapshots } from "./scripts/testing/browser-config";
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4397");
export default defineConfig({
 ...browserDefaults,
 testMatch: "vault-links-layout.spec.ts", workers: 1, maxFailures: 1,
 timeout: 180_000, globalTimeout: 20 * 60_000,
 ...reviewedSnapshots("fc24"),
 outputDir: resolve(process.env.KEEPANY_LINKS_OUTPUT ?? "test-results/vault-links-layout/run"),
 reporter: [["list"], ["json", { outputFile: resolve(process.env.KEEPANY_LINKS_RESULTS ?? "test-results/vault-links-layout/results.json") }]],
 use: { ...browserDefaults.use, baseURL: `http://127.0.0.1:${port}`, navigationTimeout: 30_000, serviceWorkers: "allow", trace: "on" },
 webServer: compiledServer(port, true),
});
