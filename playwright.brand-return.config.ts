import { defineConfig } from '@playwright/test';

process.env.KEEPANY_BRAND_UPGRADE = '1';
process.env.KEEPANY_UPGRADE_BASE_COMMIT ??= '7ebc2c349f4826759c8b2ef848e8c6133c0b3858';
process.env.KEEPANY_UPGRADE_BASE_BRAND ??= 'StackPerch';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'stackperch-upgrade.spec.ts',
  outputDir: 'test-results/brand-return',
  timeout: 210_000,
  workers: 1,
  retries: 0,
  // Reuse the existing same-origin data, KDBX, encrypted-draft and backup flow.
  // The fixture owns its dynamic port and uses only synthetic credentials.
  use: { screenshot: 'off' },
});
