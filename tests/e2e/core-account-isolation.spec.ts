import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { portableCandidate } from "./helpers/portable-candidate";
import { selectChoice } from "./helpers/select-choice";
import { openVaultAccess } from "./helpers/vault-access";

const master = "Synthetic FC20 core account master 2026!";
for (const locale of ["zh-CN", "en"] as const) {
	for (const state of ["empty", "locked", "unlocked"] as const) {
		test(`${locale} ${state} FC20 ordinary accounts work with unused CSV module blocked`, async ({
			page,
		}, info) => {
			const zh = locale === "zh-CN";
			const text = {
				add: zh ? "新增" : "Add",
				save: zh ? "保存" : "Save",
				close: zh ? "关闭" : "Close",
				accounts: zh ? "账号" : "Accounts",
				overview: zh ? "概览" : "Overview",
				all: zh ? "全部" : "All",
				email: zh ? "邮箱" : "Email",
			};
			const t = (key: keyof typeof passwordVaultCopy) =>
				passwordVaultCopy[key][zh ? 0 : 1];
			const { release, archiveSha256 } = portableCandidate();
			const targets = release.webFiles.filter((row) =>
				/^assets\/papaparse[^/]+\.js$/.test(row.path),
			);
			expect(targets).toHaveLength(1);
			const targetPath = targets[0].path;
			const workspace = page.locator("main.unified-accounts-page");
			const badge = workspace.locator(
				'.password-vault-header-meta [role="status"]',
			);
			const scripts: string[] = [];
			const errors: string[] = [];
			let intervention = false;
			page.on("request", (request) => {
				if (
					intervention &&
					request.resourceType() === "script" &&
					new URL(request.url()).pathname === `/${targetPath}`
				)
					scripts.push(request.url());
			});
			page.on("pageerror", (error) => errors.push(error.message));
			const control = await page.context().newCDPSession(page);
			const receipt: Record<string, unknown> = {
				acceptanceIds: ["FC20-A", "FC20-B", "FC20-G"],
				classification:
					"Isolated fictional actual compiled UI, declared inspector block; not spontaneous cancellation reproduction",
				locale,
				state,
				width: 1280,
				height: 900,
				sourceCommit: release.sourceCommit,
				sourceDirty: release.sourceDirty,
				archiveSha256,
				targetPath,
			};
			const hrefs = () =>
				workspace
					.locator("a.asset-account-card")
					.evaluateAll((nodes) =>
						nodes.map((node) => node.getAttribute("href")).sort(),
					);
			async function createAccount(
				title: string,
				category: string,
				username: string,
			) {
				await workspace
					.getByRole("button", { name: text.add, exact: true })
					.click();
				const editor = page.getByRole("dialog");
				await editor.locator("#name").fill(title);
				await selectChoice(editor.locator("#category"), category);
				await editor.locator("#username").fill(username);
				await editor
					.getByRole("button", { name: text.save, exact: true })
					.click();
				await expect(editor).toBeHidden();
				const card = workspace
					.locator("a.asset-account-card")
					.filter({ hasText: title });
				await expect(card).toBeVisible();
				await expect(card.getByText(title, { exact: true })).toBeVisible();
				await expect(card.getByText(username, { exact: true })).toBeVisible();
				const href = await card.getAttribute("href");
				expect(href).toBeTruthy();
				return href as string;
			}
			async function observeState() {
				if (state === "unlocked") {
					await expect(badge).toHaveText(t("pwVaultStatusLocked"));
					await openVaultAccess(page);
					await page.locator("#password-vault-unlock-master").fill(master);
					await page
						.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
						.click();
				}
				await expect(badge).toHaveText(
					t(
						state === "empty"
							? "pwVaultStatusEmpty"
							: state === "locked"
								? "pwVaultStatusLocked"
								: "pwVaultStatusUnlocked",
					),
				);
			}
			try {
				await page.setViewportSize({ width: 1280, height: 900 });
				await page.addInitScript(
					(language) => localStorage.setItem("keepany-language", language),
					locale,
				);
				await page.goto("/accounts");
				const originalHref = await createAccount(
					`Synthetic FC20 original ${locale} ${state}`,
					"other",
					"original.fc20@example.test",
				);
				receipt.originalHref = originalHref;
				if (state !== "empty") {
					await openVaultAccess(page);
					await page.locator("#password-vault-master").fill(master);
					await page.locator("#password-vault-master-confirm").fill(master);
					await page
						.getByRole("button", { name: t("pwVaultCreate"), exact: true })
						.click();
					await expect(badge).toHaveText(t("pwVaultStatusUnlocked"));
				}
				// A new Document clears the earlier page module map and normally locks an existing vault.
				await page.goto("/");
				await expect(
					page.getByRole("heading", {
						name: text.overview,
						exact: true,
						level: 1,
					}),
				).toBeVisible();
				await control.send("Network.enable");
				await control.send("Network.setBlockedURLs", {
					urls: [new URL(targetPath, info.project.use.baseURL).href],
				});
				intervention = true;
				await page
					.locator(".sidebar")
					.getByRole("link", { name: text.accounts, exact: true })
					.click();
				await expect(
					workspace.getByRole("button", { name: text.add, exact: true }),
				).toBeVisible();
				await expect(
					workspace.locator(`a.asset-account-card[href="${originalHref}"]`),
				).toBeVisible();
				await observeState();
				await expect(page.locator(".route-load-error")).toHaveCount(0);
				await page.screenshot({
					path: info.outputPath("blocked-core-ready.png"),
				});
				receipt.stateBefore = state;
				await workspace
					.getByRole("button", { name: text.add, exact: true })
					.click();
				const editor = page.getByRole("dialog");
				await editor.locator("#name").fill("Synthetic FC20 cancelled draft");
				await page.screenshot({
					path: info.outputPath("ordinary-editor-draft.png"),
				});
				await editor
					.getByRole("button", { name: text.close, exact: true })
					.first()
					.click();
				await expect(editor).toBeHidden();
				expect(await hrefs()).toEqual([originalHref]);
				receipt.cancelKeptIds = true;
				const addedHref = await createAccount(
					`Synthetic FC20 email ${locale} ${state}`,
					"email",
					"saved.fc20@example.test",
				);
				receipt.addedHref = addedHref;
				expect(addedHref).not.toBe(originalHref);
				const emailFilter = workspace.getByRole("button", {
					name: text.email,
					exact: true,
				});
				await emailFilter.click();
				await expect(emailFilter).toHaveAttribute("aria-pressed", "true");
				expect(await hrefs()).toEqual([addedHref]);
				await page.screenshot({ path: info.outputPath("email-filter.png") });
				await workspace
					.getByRole("button", { name: text.all, exact: true })
					.click();
				const expected = [originalHref, addedHref].sort();
				expect(await hrefs()).toEqual(expected);
				receipt.categoryFilterWorked = true;
				const expectedAccounts = [
					{
						href: originalHref,
						title: `Synthetic FC20 original ${locale} ${state}`,
						username: "original.fc20@example.test",
					},
					{
						href: addedHref,
						title: `Synthetic FC20 email ${locale} ${state}`,
						username: "saved.fc20@example.test",
					},
				];
				receipt.expectedAccounts = expectedAccounts;
				await page.reload();
				await observeState();
				await expect(workspace.locator("a.asset-account-card")).toHaveCount(2);
				receipt.afterHrefs = await hrefs();
				expect(receipt.afterHrefs).toEqual(expected);
				const refreshedAccounts = [];
				for (const account of expectedAccounts) {
					const card = workspace.locator(
						`a.asset-account-card[href="${account.href}"]`,
					);
					const title = card.getByText(account.title, { exact: true });
					const username = card.getByText(account.username, { exact: true });
					await expect(title).toBeVisible();
					await expect(username).toBeVisible();
					refreshedAccounts.push({
						href: await card.getAttribute("href"),
						title: await title.innerText(),
						username: await username.innerText(),
					});
				}
				expect(refreshedAccounts).toEqual(expectedAccounts);
				receipt.refreshedAccounts = refreshedAccounts;
				await expect(page.locator(".route-load-error")).toHaveCount(0);
				expect(scripts).toEqual([]);
				expect(errors).toEqual([]);
				await page.screenshot({
					path: info.outputPath("core-after-refresh.png"),
				});
				receipt.stateAfter = state;
				receipt.explicitRefresh = true;
				receipt.normalActionsAndReloadKeptIds = true;
				receipt.completed = true;
			} finally {
				receipt.unusedAdvancedScriptRequests = scripts;
				receipt.pageErrors = errors;
				writeFileSync(
					info.outputPath("core-account-receipt.json"),
					`${JSON.stringify(receipt, null, 2)}\n`,
				);
				await control
					.send("Network.setBlockedURLs", { urls: [] })
					.catch(() => {});
				await control.detach();
			}
		});
	}
}
