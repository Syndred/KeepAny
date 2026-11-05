import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const candidate = process.env.KEEPANY_WEB_CANDIDATE;
if (!candidate) throw Error('Specify KEEPANY_WEB_CANDIDATE for the compiled candidate.');
const port = Number(process.env.KEEPANY_UD_PORT ?? '4421');

export default defineConfig({
 testDir: './tests/e2e',
 testMatch: ['unified-asset-details.spec.ts'],
 retries: 0,
 workers: 2,
 timeout: 150_000,
 outputDir: process.env.KEEPANY_EVIDENCE_DIR ?? 'test-results/unified-asset-details',
 use: {
  baseURL: `http://127.0.0.1:${port}`,
  actionTimeout: 12_000,
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
 },
 webServer: {
  command: `node node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port ${port} --strictPort --outDir "${resolve(candidate)}"`,
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
 },
});
