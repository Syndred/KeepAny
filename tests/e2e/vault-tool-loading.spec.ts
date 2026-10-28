import { writeFileSync } from "node:fs";
import {
	expect,
	test,
	type Page,
	type Locator,
	type TestInfo,
} from "@playwright/test";
import { portableCandidate } from "./helpers/portable-candidate";
import { openVaultAccess } from "./helpers/vault-access";
import { selectChoice } from "./helpers/select-choice";

const master = "Synthetic FC20 matrix master 2026!";
const { archiveSha256, release } = portableCandidate();
const toolFile = (kind: "smart" | "links") => {
	const pattern =
		kind === "smart"
			? /^assets\/PasswordSmartImportDialog-[^/]+\.js$/
			: /^assets\/VaultAccountLinksDialog-[^/]+\.js$/;
	const rows = release.webFiles.filter((row: { path: string }) =>
		pattern.test(row.path),
	);
	if (rows.length !== 1)
		throw Error("Expected exactly one actual compiled advanced tool");
	return rows[0].path as string;
};
async function prepare(page: Page, locale: string, consumer: string) {
	const zh = locale === "zh-CN";
	await page.addInitScript(
		(language) => localStorage.setItem("keepany-language", language),
		locale,
	);
	await page.goto("/accounts");
	const workspace = page.locator("main.unified-accounts-page");
	await workspace
		.getByRole("button", { name: zh ? "新增" : "Add", exact: true })
		.click();
	const editor = page.getByRole("dialog");
	await editor
		.locator("#name")
		.fill(
			"Synthetic FC20 long account with isolated persisted identity and no real credentials",
		);
	await selectChoice(editor.locator("#category"), "other");
	await editor.locator("#username").fill("fc20.matrix@example.test");
	await editor
		.getByRole("button", { name: zh ? "保存" : "Save", exact: true })
		.click();
	await expect(editor).toBeHidden();
	const card = workspace
		.locator(".asset-account-card")
		.filter({ hasText: "Synthetic FC20 long account" });
	const href = await card.getAttribute("href");
	expect(href).toBeTruthy();
	await openVaultAccess(page);
	await page.locator("#password-vault-master").fill(master);
	await page.locator("#password-vault-master-confirm").fill(master);
	await page
		.getByRole("button", {
			name: zh ? "创建密码库" : "Create vault",
			exact: true,
		})
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	if (consumer !== "accounts") {
		await card.click();
		if (consumer === "detail")
			await page
				.getByRole("button", {
					name: zh ? "在此查看密码" : "View passwords here",
					exact: true,
				})
				.click();
		else await page.locator(".workspace-password-actions a").click();
	}
	const panel = page.locator(".password-vault-panel");
	await expect(panel).toBeVisible();
	await expect(panel.locator(".password-vault-toolbar")).toBeVisible();
	return { panel, href };
}
async function inspectDialog(
	page: Page,
	dialog: Locator,
	label: string,
	info: TestInfo,
	states: boolean,
) {
	await expect(dialog).toBeVisible();
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	if (!box) throw Error("Expected a visible dialog");
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	const viewport = page.viewportSize();
	if (!viewport) throw Error("Expected a configured viewport");
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
	const controls = [];
	for (const button of await dialog.getByRole("button").all()) {
		const b = await button.boundingBox();
		if (!b) throw Error("Expected a visible button");
		expect(b.width).toBeGreaterThanOrEqual(44);
		expect(b.height).toBeGreaterThanOrEqual(44);
		controls.push({
			label:
				(await button.getAttribute("aria-label")) ?? (await button.innerText()),
			width: b.width,
			height: b.height,
		});
	}
	await page.screenshot({ path: info.outputPath(`${label}-default.png`) });
	if (states) {
		const button = dialog.locator(".actions button").last();
		await button.hover();
		await dialog.screenshot({ path: info.outputPath(`${label}-hover.png`) });
		await button.focus();
		await expect(button).toBeFocused();
		await dialog.screenshot({ path: info.outputPath(`${label}-focus.png`) });
		const b = await button.boundingBox();
		if (!b) throw Error("Expected a visible button");
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await dialog.screenshot({ path: info.outputPath(`${label}-pressed.png`) });
		await page.mouse.move(0, 0);
		await page.mouse.up();
		await expect(dialog).toBeVisible();
	}
	return { bounds: box, controls };
}
for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 563, 768, 1280, 1920, 2560])
		for (const consumer of ["accounts", "detail", "standalone"] as const) {
			test(`${locale} ${width} ${consumer} actual loading cancel and local module errors`, async ({
				browser,
			}, info) => {
				const phases: Array<Record<string, unknown>> = [];
				const receipt: Record<string, unknown> = {
					acceptanceIds: ["FC20-C", "FC20-D", "FC20-F"],
					archiveSha256,
					sourceCommit: release.sourceCommit,
					sourceDirty: release.sourceDirty,
					locale,
					width,
					consumer,
					classification:
						"fictional compiled candidate UI; loading explicitly bypasses SW to pause actual module request; error uses normal SW",
					phases,
				};
				try {
					for (const mode of ["loading", "error"] as const) {
						const context = await browser.newContext({
							baseURL: info.project.use.baseURL,
							locale,
							viewport: { width, height: 900 },
							serviceWorkers: "allow",
						});
						const page = await context.newPage();
						const cdp = await context.newCDPSession(page);
						const paused = new Map<string, string>();
						try {
							const { panel, href } = await prepare(page, locale, consumer);
							const urls = new Map(
								(["smart", "links"] as const).map((kind) => [
									kind,
									new URL(toolFile(kind), info.project.use.baseURL).href,
								]),
							);
							const failures: string[] = [];
							page.on("requestfailed", (request) => {
								if ([...urls.values()].includes(request.url()))
									failures.push(request.url());
							});
							let documents = 0;
							page.on("request", (r) => {
								if (r.isNavigationRequest() && r.frame() === page.mainFrame())
									documents++;
							});
							await cdp.send("Network.enable");
							if (mode === "loading") {
								await cdp.send("Network.setBypassServiceWorker", {
									bypass: true,
								});
								cdp.on("Fetch.requestPaused", (event) =>
									paused.set(event.request.url, event.requestId),
								);
								await cdp.send("Fetch.enable", {
									patterns: [...urls.values()].map((urlPattern) => ({
										urlPattern,
										requestStage: "Request" as const,
									})),
								});
							} else
								await cdp.send("Network.setBlockedURLs", {
									urls: [...urls.values()],
								});
							for (const kind of ["smart", "links"] as const) {
								const targetUrl = urls.get(kind);
								if (!targetUrl) throw Error("Expected the actual tool URL");
								const trigger = panel.locator(
									`[data-vault-tool-trigger="${kind}"]`,
								);
								const phase: Record<string, unknown> = {
									mode,
									kind,
									originalHref: href,
									toolPath: toolFile(kind),
								};
								phases.push(phase);
								await trigger.click();
								const dialog = page.locator(".deferred-vault-tool-dialog");
								await expect(dialog).toBeVisible();
								await expect(
									dialog.locator(`[data-vault-tool-phase="${mode}"]`),
								).toBeVisible();
								await expect(dialog.getByRole("heading")).toBeFocused();
								if (mode === "loading")
									await expect.poll(() => paused.has(targetUrl)).toBe(true);
								else
									await expect
										.poll(() => failures.includes(targetUrl))
										.toBe(true);
								phase.visual = await inspectDialog(
									page,
									dialog,
									`${mode}-${kind}`,
									info,
									true,
								);
								const beforeDocuments = documents;
								await dialog
									.locator(".actions")
									.getByRole("button", {
										name:
											locale === "zh-CN"
												? mode === "loading"
													? "取消"
													: "关闭"
												: mode === "loading"
													? "Cancel"
													: "Close",
										exact: true,
									})
									.click();
								await expect(dialog).toBeHidden();
								await expect(trigger).toBeFocused();
								if (mode === "loading") {
									const response = page.waitForResponse(targetUrl);
									const requestId = paused.get(targetUrl);
									if (!requestId)
										throw Error("Expected a genuinely paused module");
									await cdp.send("Fetch.continueRequest", {
										requestId,
									});
									paused.delete(targetUrl);
									const delivered = await response;
									expect(delivered.status()).toBe(200);
									expect(await delivered.finished()).toBeNull();
									phase.actualModuleResponseFinished = true;
									await page.waitForTimeout(500);
									await expect(page.getByRole("dialog")).toHaveCount(0);
									await expect(trigger).toBeFocused();
									await trigger.click();
									const actual = page.locator(
										kind === "smart"
											? ".password-smart-import-dialog"
											: ".vault-connect-dialog",
									);
									await expect(actual).toBeVisible();
									await actual
										.locator(":scope > header")
										.getByRole("button", {
											name: locale === "zh-CN" ? "关闭" : "Close",
											exact: true,
										})
										.click();
									await expect(actual).toBeHidden();
									await expect(trigger).toBeFocused();
									phase.lateModuleDidNotReopen = true;
									phase.explicitReopenNormal = true;
								} else {
									const count = failures.length;
									await trigger.click();
									await expect(
										dialog.locator('[data-vault-tool-phase="error"]'),
									).toBeVisible();
									expect(failures).toHaveLength(count);
									await dialog
										.locator(":scope > header")
										.getByRole("button", {
											name: locale === "zh-CN" ? "关闭" : "Close",
											exact: true,
										})
										.click();
									await expect(dialog).toBeHidden();
									await expect(trigger).toBeFocused();
									phase.noRetryOnReopen = true;
								}
								expect(documents).toBe(beforeDocuments);
								await expect(page.locator(".route-load-error")).toHaveCount(0);
								phase.closeReturnedToOwnTrigger = true;
								phase.noAutomaticDocumentReload = true;
								phase.completed = true;
							}
							if (consumer !== "accounts") {
								const menu = page.locator(".mobile-menu");
								if (await menu.isVisible()) await menu.click();
								await page
									.locator("aside")
									.getByRole("link", {
										name: locale === "zh-CN" ? "账号" : "Accounts",
										exact: true,
									})
									.click();
							}
							const workspace = page.locator("main.unified-accounts-page");
							await expect(
								workspace.locator(`a[href="${href}"]`),
							).toBeVisible();
							await workspace
								.getByRole("button", {
									name: locale === "zh-CN" ? "新增" : "Add",
									exact: true,
								})
								.click();
							await expect(
								page.getByRole("dialog").locator("#name"),
							).toBeVisible();
							await page
								.getByRole("dialog")
								.getByRole("button", {
									name: locale === "zh-CN" ? "取消" : "Cancel",
									exact: true,
								})
								.click();
							await expect(page.getByRole("dialog")).toHaveCount(0);
							await expect(
								workspace.locator(`a[href="${href}"]`),
							).toBeVisible();
						} finally {
							for (const requestId of paused.values())
								await cdp
									.send("Fetch.continueRequest", { requestId })
									.catch(() => {});
							await cdp.send("Fetch.disable").catch(() => {});
							await cdp
								.send("Network.setBlockedURLs", { urls: [] })
								.catch(() => {});
							await cdp
								.send("Network.setBypassServiceWorker", { bypass: false })
								.catch(() => {});
							await context.close();
						}
					}
				} finally {
					writeFileSync(
						info.outputPath("tool-state-receipt.json"),
						`${JSON.stringify(receipt, null, 2)}\n`,
					);
				}
			});
		}
