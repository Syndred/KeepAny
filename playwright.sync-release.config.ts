import { defineConfig } from "@playwright/test";
import releaseConfig from "./playwright.release.config";

if (!process.env.KEEPANY_TEST_DATABASE_URL) {
	throw new Error("Sync release checks require an isolated KEEPANY_TEST_DATABASE_URL.");
}

// Use the same committed Web files as the local release checks, with real
// loopback HTTP and PostgreSQL. Each test owns and drops its database schema.
export default defineConfig({
	...releaseConfig,
	testMatch: ["self-host-sync.spec.ts", "self-host-photo-sync.spec.ts"],
	workers: 1,
});
