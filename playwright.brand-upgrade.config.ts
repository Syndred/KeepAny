import { browserDefaults } from "./scripts/testing/browser-config";
import { defineConfig } from '@playwright/test';

process.env.KEEPANY_BRAND_UPGRADE = '1';

export default defineConfig({
 ...browserDefaults,

  testMatch: 'stackperch-upgrade.spec.ts',
  outputDir: 'test-results/brand-upgrade',
  timeout: 210_000,
  workers: 1,

  // The isolated test starts and stops both packages on its own dynamic port.
  // Source text can include synthetic passwords, so failure screenshots stay off.
  use: { ...browserDefaults.use, screenshot: 'off' },
});
