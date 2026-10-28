import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";

const evidence =
	process.env.KEEPANY_INDEPENDENT_EVIDENCE ??
	"test-results/account-layout-independent/busy";
mkdirSync(evidence, { recursive: true });
for (const language of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 1280, 1920, 2560]) {
		test(`independent busy ${language} ${width}: AL05 AL10 real async UI under CPU throttle`, async ({
			browser,
		}) => {
			test.setTimeout(180_000);
			const context = await browser.newContext({
				viewport: { width, height: 1050 },
				locale: language,
			});
			await context.addInitScript(
				(locale) => localStorage.setItem("keepany-language", locale),
				language,
			);
			const page = await context.newPage(),
				t = (key: string) =>
					(resources[language].translation as Record<string, string>)[key] ??
					key;
			const cdp = await context.newCDPSession(page),
				steps: object[] = [],
				errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				await page.goto("/settings#advanced-settings");
				await page
					.getByRole("button", { name: t("loadSample"), exact: true })
					.click();
				await expect(
					page.getByRole("button", {
						name: t("sampleLibraryPresent"),
						exact: true,
					}),
				).toBeDisabled();
				await page.goto("/accounts");
				await page.locator(".unified-vault-access summary").click();
				const master = "Independent busy synthetic 2026!";
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				// Performance preparation only: no product API, state injection or request interception.
				const create = page.getByRole("button", {
					name: t("pwVaultCreate"),
					exact: true,
				});
				await create.click();
				const toolbar = page.locator(".password-vault-toolbar");
				await expect(toolbar).toBeVisible({ timeout: 30_000 });
				await cdp.send("Emulation.setCPUThrottlingRate", { rate: 16 });
				const sample = toolbar.getByRole("button", {
					name: t("sampleLogins"),
					exact: true,
				});
				await sample.click();
				await expect(sample).toBeDisabled();
				const before = await toolbar
					.locator("button")
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							label: node.getAttribute("aria-label") ?? node.textContent,
							disabled: (node as HTMLButtonElement).disabled,
						})),
					);
				expect(before.every((button) => button.disabled)).toBe(true);
				// Capture the rendered frame immediately; an element screenshot waits for
				// stability and can miss an honest transient state. No state is held/faked.
				const frame = await cdp.send("Page.captureScreenshot", {
					format: "png",
					captureBeyondViewport: false,
				});
				writeFileSync(
					join(evidence, `${language}-${width}-toolbar-busy.png`),
					Buffer.from(frame.data, "base64"),
				);
				await expect(sample).toBeDisabled();
				steps.push({
					step: "sample-real-busy",
					cpuThrottle: 16,
					disabledBeforeAndAfterScreenshot: true,
					buttons: before,
				});
				await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
				await expect(sample).toHaveCount(0, { timeout: 60_000 });
				await expect(
					page.locator(".unified-account-passwords .password-vault-entry"),
				).toHaveCount(8);
				const phone = page
					.locator(".unified-account")
					.filter({ has: page.locator(".asset-account-phone") });
				await phone.locator("summary").click();
				await expect(phone.locator(".password-vault-entry")).toBeVisible();
				await expect(
					toolbar.getByRole("button", {
						name: t("pwVaultNewEntry"),
						exact: true,
					}),
				).toBeEnabled();
				expect(errors).toEqual([]);
				steps.push({
					step: "completed-real-operation",
					entries: 8,
					toolbarEnabled: true,
					result: "passed",
				});
			} finally {
				await cdp
					.send("Emulation.setCPUThrottlingRate", { rate: 1 })
					.catch(() => {});
				const release = process.env.KEEPANY_PREVIEW_DIRECTORY
					? JSON.parse(
							readFileSync(
								join(process.env.KEEPANY_PREVIEW_DIRECTORY, "RELEASE.json"),
								"utf8",
							),
						)
					: null;
				writeFileSync(
					join(evidence, `${language}-${width}-busy.json`),
					JSON.stringify(
						{
							language,
							width,
							sourceCommit: release?.sourceCommit,
							preparation:
								"CDP 16x main-thread CPU throttle; real UI operations, no internal product state writes",
							steps,
							errors,
						},
						null,
						2,
					),
				);
				await context.close();
			}
		});
	}
