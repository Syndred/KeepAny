import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	// Generated browser fixtures can contain copied Playwright specs.
	// Crypto/KDBX tests share finite CPU and memory. Match the two-worker release
	// browser budget rather than multiplying expensive KDFs by host logical CPUs.
	test: { maxWorkers: 2, exclude: [...configDefaults.exclude, "tests/e2e/**", "test-results/**", "**/dist/**"] },
});
