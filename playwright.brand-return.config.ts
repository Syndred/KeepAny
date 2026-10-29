import brandUpgrade from "./playwright.brand-upgrade.config";
import { defineConfig } from '@playwright/test';

process.env.KEEPANY_BRAND_UPGRADE = '1';
process.env.KEEPANY_UPGRADE_BASE_COMMIT ??= '7ebc2c349f4826759c8b2ef848e8c6133c0b3858';
process.env.KEEPANY_UPGRADE_BASE_BRAND ??= 'StackPerch';

export default defineConfig({ ...brandUpgrade, outputDir: "test-results/brand-return" });
