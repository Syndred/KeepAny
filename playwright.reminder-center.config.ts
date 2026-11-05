import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const directory = process.env.KEEPANY_WEB_CANDIDATE;
if (!directory) throw Error("An explicit compiled Web candidate is required.");
const port = Number(process.env.KEEPANY_REMINDER_PORT ?? "4448");
export default defineConfig({ testDir: "./tests/e2e", testMatch: "reminder-center.spec.ts", retries: 0, workers: 2, timeout: 100000,
 outputDir: process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/reminder-center", use: { baseURL: `http://127.0.0.1:${port}`, actionTimeout: 10000, screenshot: "only-on-failure", trace: "retain-on-failure", serviceWorkers: "block" },
 webServer: { command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(directory)}"`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false }
});
