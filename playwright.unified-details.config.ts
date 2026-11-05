import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const candidate = process.env.KEEPANY_WEB_CANDIDATE;
const port = Number(process.env.KEEPANY_UD_PORT ?? process.env.KEEPANY_RELEASE_TEST_PORT ?? '4421');

export default defineConfig({
 testDir: './tests/e2e',
 testMatch: ['unified-detail-v7.spec.ts'],
 retries: 0,
 fullyParallel: true,
 workers: 1,
 timeout: 150_000,
 outputDir: process.env.KEEPANY_EVIDENCE_DIR ?? 'test-results/unified-asset-details',
 use: {
  baseURL: `http://127.0.0.1:${port}`,
  actionTimeout: 12_000,
  timezoneId: "Asia/Shanghai",
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
 },
 webServer: candidate ? {
  command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`,
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
 } : {
  command: 'node scripts/serve-preview-for-tests.mjs',
  url: `http://127.0.0.1:${port}`,
  env: {KEEPANY_RELEASE_TEST_PORT:String(port)},
  reuseExistingServer: false,
 },
});
