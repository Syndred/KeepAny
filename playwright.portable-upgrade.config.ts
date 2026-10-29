import { browserDefaults } from "./scripts/testing/browser-config";
import { defineConfig } from '@playwright/test';
process.env.KEEPANY_PORTABLE_UPGRADE = '1';

export default defineConfig({
 ...browserDefaults,

  testMatch: 'portable-preview-upgrade.spec.ts',
  outputDir: 'test-results/portable-upgrade',
  timeout: 150_000,
  workers: 1,

  use: { ...browserDefaults.use, screenshot: 'only-on-failure' },
});
