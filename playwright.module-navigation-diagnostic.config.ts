import { browserDefaults, compiledServer } from "./scripts/testing/browser-config";
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
 ...browserDefaults,
	testDir: "./tests/diagnostics",
	testMatch: "module-navigation.diagnostic.ts",
	outputDir: resolve(outputRoot, "run"),
	workers: 1,

	timeout: 300_000,
	use: { ...browserDefaults.use,
		baseURL: `http://127.0.0.1:${port}`,
		locale: "zh-CN",
		viewport: { width: 1536, height: 1024 },
		serviceWorkers: "allow",

	},
	projects: arms.map((arm) => {
		const directory = resolve(process.cwd(), outputRoot, arm.name);
		mkdirSync(directory, { recursive: true });
		return {
			name: arm.name,
			use: { ...browserDefaults.use,
				channel: arm.channel,
				trace: arm.trace,
				launchOptions: {
					args: [
						`--log-net-log=${resolve(directory, "netlog-default.json")}`,
						"--net-log-capture-mode=Default",
						"--enable-tracing=ServiceWorker,loading",
						`--enable-tracing-output=${resolve(directory, "chromium-loading-trace.json")}`,
						"--enable-tracing-format=json",
						"--trace-startup-record-mode=record-continuously",
					],
				},
			},
		};
	}),
	webServer: compiledServer(port),
});
