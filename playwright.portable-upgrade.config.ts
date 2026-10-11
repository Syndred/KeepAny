import { defineConfig } from '@playwright/test';
process.env.KEEPANY_PORTABLE_UPGRADE = '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'portable-preview-upgrade.spec.ts',
  timeout: 150_000,
  workers: 1,
  retries: 0,
  use: { screenshot: 'only-on-failure' },
});
