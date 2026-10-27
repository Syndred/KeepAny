import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	// Generated browser fixtures can contain copied Playwright specs.
	test: { exclude: [...configDefaults.exclude, "tests/e2e/**", "test-results/**", "**/dist/**"] },
});
