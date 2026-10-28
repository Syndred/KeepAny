import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.KEEPANY_RELEASE_TEST_PORT ?? "4393");
const outputRoot =
	process.env.KEEPANY_MODULE_DIAGNOSTIC_ROOT ??
	"test-results/module-navigation-diagnostic";
const arms = [
	{ name: "A-bundled-trace", channel: undefined, trace: "retain-on-failure" },
	{ name: "B-bundled-trace-off", channel: undefined, trace: "off" },
	{ name: "C-chrome-trace", channel: "chrome", trace: "retain-on-failure" },
	{ name: "D-chrome-trace-off", channel: "chrome", trace: "off" },
] as const;

export default defineConfig({
	testDir: "./tests/diagnostics",
	testMatch: "module-navigation.diagnostic.ts",
	outputDir: resolve(outputRoot, "run"),
	workers: 1,
	retries: 0,
	timeout: 300_000,
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		locale: "zh-CN",
		viewport: { width: 1536, height: 1024 },
		serviceWorkers: "allow",
		actionTimeout: 15_000,
		screenshot: "only-on-failure",
	},
	projects: arms.map((arm) => {
		const directory = resolve(process.cwd(), outputRoot, arm.name);
		mkdirSync(directory, { recursive: true });
		return {
			name: arm.name,
			use: {
				channel: arm.channel,
				trace: arm.trace,
				launchOptions: {
					args: [
						`--log-net-log=${resolve(directory, "netlog-default.json")}`,
						"--net-log-capture-mode=Default",
					],
				},
			},
		};
	}),
	webServer: {
		cwd: process.cwd(),
		command: "node scripts/serve-preview-for-tests.mjs",
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
