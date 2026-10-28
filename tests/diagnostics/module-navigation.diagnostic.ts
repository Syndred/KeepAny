import {
	mkdirSync,
	appendFileSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { selectChoice } from "../e2e/helpers/select-choice";
import { observeGraphNetwork } from "../e2e/helpers/graph-network-diagnostics";

test("fixed100 ordinary detail-to-account navigations with normal service worker", async ({
	page,
}, info) => {
	test.setTimeout(300_000);
	const evidence = join(
		process.cwd(),
		process.env.KEEPANY_MODULE_DIAGNOSTIC_ROOT ??
			"test-results/module-navigation-diagnostic",
		info.project.name,
	);
	mkdirSync(evidence, { recursive: true });
	const log = (row: object) =>
		appendFileSync(
			join(evidence, "actions.jsonl"),
			`${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`,
		);
	const versionSession = await page.context().newCDPSession(page);
	const version = await versionSession.send("Browser.getVersion");
	const commandLine = await versionSession
		.send("Browser.getBrowserCommandLine")
		.catch(() => ({ arguments: [] as string[] }));
	log({
		stage: "runtime-identity",
		browserVersion: page.context().browser()?.version(),
		protocolVersion: version,
		platform: process.platform,
		architecture: process.arch,
		configuredChannel: info.project.use.channel ?? "bundled",
		executable: commandLine.arguments[0] ?? null,
		flags: commandLine.arguments.filter((arg) =>
			/^--(?:headless|disable-dev-shm-usage|disable-background|disable-renderer-backgrounding|enable-automation|log-net-log|net-log-capture-mode)/.test(
				arg,
			),
		),
		candidateDeclaredByBuild: process.env.GITHUB_SHA ?? null,
	});
	await versionSession.detach();
	let roundInProgress = 0;
	let cleanPreFailureRounds = 0;
	let firstStaticFailure: Record<string, unknown> | undefined;
	const stop = await observeGraphNetwork(page, info, (failure) => {
		if (firstStaticFailure) return;
		firstStaticFailure = failure;
		log({
			stage: "first-static-failure",
			observedRound: roundInProgress,
			cleanPreFailureRounds,
			postFailureObservation: true,
			failure,
		});
	});
	const requireCleanObservation = () => {
		if (firstStaticFailure)
			throw Error(
				"Diagnostic stopped after first static request failure; subsequent UI cannot count as clean navigation",
			);
	};
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const archivePath = process.env.KEEPANY_PREVIEW_ARCHIVE;
		if (!archivePath)
			throw Error("Diagnostic requires the actual portable archive");
		const archiveBytes = readFileSync(archivePath);
		const archiveSha256 = createHash("sha256")
			.update(archiveBytes)
			.digest("hex");
		const sidecar = readFileSync(`${archivePath}.sha256`, "utf8")
			.trim()
			.split(/\s+/)[0];
		expect(archiveSha256).toBe(sidecar);
		const members = unzipSync(archiveBytes);
		const releases = Object.keys(members).filter((path) =>
			path.endsWith("/RELEASE.json"),
		);
		expect(releases).toHaveLength(1);
		const release = JSON.parse(strFromU8(members[releases[0]])) as {
			sourceCommit: string;
			sourceDirty: boolean;
			webFiles: { path: string; sha256: string }[];
		};
		if (process.env.GITHUB_SHA)
			expect(release.sourceCommit).toBe(process.env.GITHUB_SHA);
		const entryFiles = release.webFiles.filter((row) =>
			/^assets\/index-[\w-]+\.js$/.test(row.path),
		);
		expect(entryFiles).toHaveLength(1);
		const index = release.webFiles.find((row) => row.path === "index.html");
		if (!index) throw Error("Actual release has no index manifest entry");
		const httpIndex = await fetch(
			new URL("index.html", info.project.use.baseURL),
		);
		expect(httpIndex.status).toBe(200);
		const httpIndexSha256 = createHash("sha256")
			.update(new Uint8Array(await httpIndex.arrayBuffer()))
			.digest("hex");
		expect(httpIndexSha256).toBe(index.sha256);
		log({
			stage: "actual-package-identity",
			archivePath,
			archiveSha256,
			sidecar,
			sourceCommit: release.sourceCommit,
			sourceDirty: release.sourceDirty,
			httpIndexSha256,
			expectedBrowserEntry: `/${entryFiles[0].path}`,
		});
		await page.addInitScript(() =>
			localStorage.setItem("keepany-language", "zh-CN"),
		);
		await page.goto("/assets/account");
		const workspace = page.locator("main.unified-accounts-page");
		await workspace.getByRole("button", { name: "新增", exact: true }).click();
		const editor = page.getByRole("dialog");
		await editor
			.locator("#name")
			.fill("Synthetic module navigation diagnostic");
		await selectChoice(editor.locator("#category"), "other");
		await editor.locator("#username").fill("module.navigation@example.test");
		await editor.getByRole("button", { name: "保存", exact: true }).click();
		await expect(editor).toBeHidden();
		const card = workspace
			.locator(".asset-account-card")
			.filter({ hasText: "Synthetic module navigation diagnostic" });
		await expect(card).toBeVisible();
		requireCleanObservation();
		const href = await card.getAttribute("href");
		if (!href) throw Error("Missing synthetic account detail link");
		expect(href).toMatch(/^\/assets\/account\/[0-9a-f-]+$/);
		const baseline = await page.evaluate(() => ({
			scripts: [...document.scripts]
				.map((s) => s.getAttribute("src"))
				.filter(Boolean),
			sw: navigator.serviceWorker.controller?.scriptURL ?? null,
		}));
		expect(baseline.scripts).toContain(`/${entryFiles[0].path}`);
		log({
			stage: "created-one-synthetic-account",
			href,
			baseline,
			normalSwPolicy: "allow",
			plannedRounds: 100,
			trace: info.project.use.trace,
		});
		for (let round = 1; round <= 100; round++) {
			roundInProgress = round;
			requireCleanObservation();
			log({ stage: "round-start", round });
			await page.goto(href);
			await expect(
				page.getByRole("heading", {
					level: 1,
					name: "Synthetic module navigation diagnostic",
					exact: true,
				}),
			).toBeVisible();
			await page.locator('.topbar-back-link[href="/assets/account"]').click();
			await expect(
				workspace.getByRole("button", { name: "新增", exact: true }),
			).toBeVisible();
			await expect(card).toBeVisible();
			expect(await card.getAttribute("href")).toBe(href);
			await expect(page.locator(".route-load-error")).toHaveCount(0);
			requireCleanObservation();
			cleanPreFailureRounds = round;
			log({ stage: "round-passed", round, href });
			if (round % 10 === 0)
				await page.screenshot({ path: join(evidence, `round-${round}.png`) });
		}
		expect(errors).toEqual([]);
		requireCleanObservation();
		log({
			stage: "completed",
			passedRounds: 100,
			cleanPreFailureRounds,
			firstStaticFailure: null,
			postFailureObservation: false,
			pageErrors: errors,
		});
	} catch (error) {
		log({
			stage: "failure",
			message: error instanceof Error ? error.message : String(error),
			pageErrors: errors,
			cleanPreFailureRounds,
			firstStaticFailure,
			postFailureObservation: !!firstStaticFailure,
		});
		await page
			.content()
			.then((content) =>
				writeFileSync(join(evidence, "failure-dom.html"), content),
			)
			.catch((captureError) =>
				log({
					stage: "failure-dom-unavailable",
					name: captureError instanceof Error ? captureError.name : "unknown",
				}),
			);
		await page
			.screenshot({ path: join(evidence, "failure.png") })
			.catch((captureError) =>
				log({
					stage: "failure-image-unavailable",
					name: captureError instanceof Error ? captureError.name : "unknown",
				}),
			);
		throw error;
	} finally {
		await stop().catch((error) =>
			log({
				stage: "collector-stop-error",
				name: error instanceof Error ? error.name : "unknown",
			}),
		);
	}
});
