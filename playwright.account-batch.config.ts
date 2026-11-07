import { defineConfig } from "@playwright/test";
import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";

const localURL = process.env.KEEPANY_ACCOUNT_BATCH_URL;
const localSHA = process.env.KEEPANY_ACCOUNT_BATCH_INDEX_SHA256;
const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4457");
const executablePath = process.env.KEEPANY_TEST_BROWSER_EXECUTABLE;

if (Boolean(localURL) !== Boolean(localSHA)) throw Error("The direct candidate needs both its isolated URL and index SHA-256.");
if (localURL && (process.env.CI || !/^http:\/\/127\.0\.0\.1:\d{4,5}\/$/.test(localURL) ||
 new Set(["1420", "4180", "5173"]).has(new URL(localURL).port) || !/^[a-f0-9]{64}$/.test(localSHA ?? ""))) {
 throw Error("Use a dedicated local compiled-candidate port and its exact index SHA-256.");
}

export default defineConfig({
 ...browserDefaults,
 testMatch: "account-batch.spec.ts",
 workers: 1,
 timeout: 150_000,
 outputDir: "test-results/account-batch",
 reporter: [["line"], ["json", { outputFile: "test-results/account-batch/results.json" }]],
 use: {
  ...browserDefaults.use,
  baseURL: localURL ?? `http://127.0.0.1:${port}/`,
  channel: process.env.KEEPANY_TEST_BROWSER_CHANNEL,
  launchOptions: { executablePath },
  viewport: { width: 1280, height: 800 },
  serviceWorkers: "block",
  trace: "retain-on-failure",
 },
 webServer: localURL ? undefined : compiledServer(port),
});
