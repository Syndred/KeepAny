import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { portableCandidate } from "./helpers/portable-candidate";
import { openVaultAccess } from "./helpers/vault-access";
import { selectChoice } from "./helpers/select-choice";
import { observeGraphNetwork } from "./helpers/graph-network-diagnostics";
const master = "Synthetic FC20 isolated tool master 2026!";
for (const locale of ["zh-CN", "en"] as const)
	for (const targetKind of ["smart-js", "links-js", "smart-css"] as const) {
		test(`${locale} ${targetKind} actual advanced failure stays local and explicitly reloads`, async ({
			page,
		}, info) => {
			const zh = locale === "zh-CN";
			const t = {
				add: zh ? "新增" : "Add",
				save: zh ? "保存" : "Save",
				cancel: zh ? "取消" : "Cancel",
				close: zh ? "关闭" : "Close",
				create: zh ? "创建密码库" : "Create vault",
				unlock: zh ? "解锁密码库" : "Unlock vault",
				error: zh ? "暂时无法打开这个功能" : "This feature could not be opened",
				reload: zh ? "重新加载" : "Reload page",
				accounts: zh ? "账号" : "Accounts",
			};
			const { release, archiveSha256 } = portableCandidate();
			const pattern =
				targetKind === "links-js"
					? /^assets\/VaultAccountLinksDialog-[^/]+\.js$/
					: targetKind === "smart-css"
						? /^assets\/PasswordSmartImportDialog-[^/]+\.css$/
						: /^assets\/PasswordSmartImportDialog-[^/]+\.js$/;
			const targets = release.webFiles.filter((row: { path: string }) =>
				pattern.test(row.path),
			);
			expect(targets).toHaveLength(1);
			const targetUrl = new URL(targets[0].path, info.project.use.baseURL).href;
			const failures: string[] = [];
			page.on("requestfailed", (request) => {
				if (request.url() === targetUrl)
					failures.push(request.failure()?.errorText ?? "unknown");
			});
			let documents = 0;
			page.on("request", (request) => {
				if (
					request.isNavigationRequest() &&
					request.frame() === page.mainFrame()
				)
					documents++;
			});
			const stop = await observeGraphNetwork(page, info);
			const cdp = await page.context().newCDPSession(page);
			const receipt: Record<string, unknown> = {
				acceptanceIds: ["FC20-C", "FC20-D"],
				classification:
					"isolated fictional actual compiled UI; declared inspector module/CSS fault",
				locale,
				targetKind,
				targetPath: targets[0].path,
				archiveSha256,
				sourceCommit: release.sourceCommit,
				sourceDirty: release.sourceDirty,
			};
			try {
				await page.addInitScript(
					(language) => localStorage.setItem("keepany-language", language),
					locale,
				);
				await page.goto("/accounts");
				const workspace = page.locator("main.unified-accounts-page");
				await workspace
					.getByRole("button", { name: t.add, exact: true })
					.click();
				let dialog = page.getByRole("dialog");
				await dialog.locator("#name").fill("Synthetic FC20 preserved account");
				await selectChoice(dialog.locator("#category"), "other");
				await dialog.locator("#username").fill("fc20.preserved@example.test");
				await dialog.getByRole("button", { name: t.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				const card = workspace
					.locator(".asset-account-card")
					.filter({ hasText: "Synthetic FC20 preserved account" });
				await expect(card).toBeVisible();
				const originalHref = await card.getAttribute("href");
				receipt.originalHref = originalHref;
				await openVaultAccess(page);
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page.getByRole("button", { name: t.create, exact: true }).click();
				await expect(page.locator(".password-vault-toolbar")).toBeVisible();
				await cdp.send("Network.enable");
				await cdp.send("Network.setBlockedURLs", { urls: [targetUrl] });
				const kind = targetKind === "links-js" ? "links" : "smart";
				const trigger = page.locator(`[data-vault-tool-trigger="${kind}"]`);
				await trigger.click();
				dialog = page.getByRole("dialog");
				await expect(
					dialog.getByRole("heading", { name: t.error, exact: true }),
				).toBeVisible();
				await expect.poll(() => failures.length).toBe(1);
				await expect(page.locator(".route-load-error")).toHaveCount(0);
				await expect(card).toBeVisible();
				receipt.localErrorKeptCore = true;
				const beforeDocuments = documents;
				await page.waitForTimeout(500);
				expect(documents).toBe(beforeDocuments);
				expect(failures).toHaveLength(1);
				receipt.noAutomaticRetryOrReloadIn500ms = true;
				await page.screenshot({
					path: info.outputPath("local-module-error.png"),
				});
				await dialog
					.locator(".actions")
					.getByRole("button", { name: t.close, exact: true })
					.click();
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				await workspace
					.getByRole("button", { name: t.add, exact: true })
					.click();
				dialog = page.getByRole("dialog");
				await expect(dialog.locator("#name")).toBeVisible();
				await dialog
					.getByRole("button", { name: t.cancel, exact: true })
					.click();
				await expect(dialog).toBeHidden();
				expect(await card.getAttribute("href")).toBe(originalHref);
				await trigger.click();
				dialog = page.getByRole("dialog");
				await expect(
					dialog.getByRole("heading", { name: t.error, exact: true }),
				).toBeVisible();
				expect(failures).toHaveLength(1);
				await cdp.send("Network.setBlockedURLs", { urls: [] });
				await dialog
					.getByRole("button", { name: t.reload, exact: true })
					.click();
				await openVaultAccess(page);
				await page.locator("#password-vault-unlock-master").fill(master);
				await page.getByRole("button", { name: t.unlock, exact: true }).click();
				await expect(page.locator(".password-vault-toolbar")).toBeVisible();
				expect(await card.getAttribute("href")).toBe(originalHref);
				await trigger.click();
				const actual = page.locator(
					targetKind === "links-js"
						? ".vault-connect-dialog"
						: ".password-smart-import-dialog",
				);
				await expect(actual).toBeVisible();
				await expect(page.locator(".deferred-vault-tool-dialog")).toHaveCount(
					0,
				);
				await page.screenshot({
					path: info.outputPath("actual-tool-restored.png"),
				});
				await actual
					.locator(":scope > header")
					.getByRole("button", { name: t.close, exact: true })
					.click();
				await expect(actual).toBeHidden();
				await expect(trigger).toBeFocused();
				receipt.localErrorKeptCore = true;
				receipt.closeReturnedFocus = true;
				receipt.normalAssetEditorCancelPreservedId = true;
				receipt.explicitReloadAndNormalUnlockPreservedId = true;
				receipt.actualToolOpenedAndClosed = true;
				receipt.noAutomaticRetryObserved = true;
			} finally {
				receipt.failures = failures;
				writeFileSync(
					info.outputPath("advanced-module-receipt.json"),
					`${JSON.stringify(receipt, null, 2)}\n`,
				);
				await cdp.send("Network.setBlockedURLs", { urls: [] });
				await cdp.detach();
				await stop();
			}
		});
	}
