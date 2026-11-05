import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const candidate = process.env.KEEPANY_WEB_CANDIDATE;
if (!candidate) throw Error("KEEPANY_WEB_CANDIDATE must identify the compiled candidate.");
const port = Number(process.env.KEEPANY_TEMPLATE_PORT ?? "4417");
export default defineConfig({ testDir: "./tests/e2e", testMatch: ["account-template.spec.ts", "unified-account-editor.spec.ts", "compact-accounts.spec.ts", "simple-account-relations.spec.ts"], retries: 0, workers: 2, timeout: 120000,
 outputDir: process.env.KEEPANY_TEMPLATE_OUTPUT ?? "test-results/account-template", use: { baseURL: `http://127.0.0.1:${port}`, actionTimeout: 10000, screenshot: "only-on-failure", trace: "retain-on-failure" },
 webServer: { command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false }
});
