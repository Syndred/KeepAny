import {createHash} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";

const evidence =
	process.env.KEEPANY_INDEPENDENT_EVIDENCE ??
	"test-results/account-layout-independent/social";
mkdirSync(evidence, { recursive: true });
const master = "Independent social synthetic 2026!",
	accountName = "Independent synthetic social creator";
const note =
	"Synthetic long social account notes. The expanded entry must remain readable while all collapsed neighbors retain their original height.\n自媒体虚构资料，仅用于展开布局独立验收。";
for (const language of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 1280, 1920, 2560]) {
		test(`independent social ${language} ${width}: AL01 AL02 populated category and neighbors`, async ({
			browser,
		}) => {
			test.setTimeout(120_000);
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
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const steps: object[] = [];
			try {
				await page.goto("/settings#advanced-settings");
                steps.push({stage:'identity',entrySha256:createHash('sha256').update(await(await page.request.get('/')).body()).digest('hex'),archiveSha256:createHash('sha256').update(readFileSync(process.env.KEEPANY_PREVIEW_ARCHIVE!)).digest('hex')});
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
				await page
					.getByRole("main")
					.getByRole("button", { name: t("add"), exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByLabel(t("name"), { exact: true })
					.fill(accountName);
				await page.locator("#category").click();
				await page
					.getByRole("option", { name: t("social"), exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("save"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await page.locator(".unified-vault-access summary").click();
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultCreate"), exact: true })
					.click();
				// Compare expansion against the fully unlocked disclosure UI, rather than
				// the preceding locked placeholder while the create operation settles.
				await expect(page.locator(".unified-account-passwords")).toHaveCount(9);
				const baseline = await page
					.locator(".unified-account")
					.evaluateAll((nodes) =>
						nodes.map((node) => {
							const anchor = node.querySelector("a");
							if (!anchor)
								throw Error("Account has no visible navigation link");
							return {
								href: anchor.getAttribute("href"),
								height: node.getBoundingClientRect().height,
							};
						}),
					);
				const account = page
						.locator(".unified-account")
						.filter({ hasText: accountName }),
					disclosure = account.locator(".unified-account-passwords");
				await disclosure.locator("summary").click();
				await disclosure
					.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
					.click();
				await page
					.locator("#password-vault-entry-title")
					.fill("Independent social passwordless login");
				await page
					.locator("#password-vault-entry-username")
					.fill("synthetic-independent-creator");
				await page.locator("#password-vault-entry-notes").fill(note);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(disclosure).toHaveJSProperty("open", true);
				await expect(disclosure).toContainText(t("pwVaultNoPassword"));
				await expect(disclosure).toContainText(note);
				const expanded = await page
					.locator(".unified-account")
					.evaluateAll((nodes) =>
						nodes.map((node) => {
							const anchor = node.querySelector("a");
							if (!anchor)
								throw Error("Account has no visible navigation link");
							return {
								href: anchor.getAttribute("href"),
								open: !!node.querySelector("details[open]"),
								height: node.getBoundingClientRect().height,
							};
						}),
					);
				steps.push({ step: "neighbor-measurements", baseline, expanded });
				for (const card of expanded) {
					if (!card.open) {
						const before = baseline.find((item) => item.href === card.href);
						if (!before) throw Error("Missing baseline for collapsed account");
						expect(card.height).toBeLessThanOrEqual(before.height + 1);
					}
				}
				const actions = await disclosure
					.locator(".password-vault-entry button")
					.evaluateAll((nodes) =>
						nodes.map((node) => {
							const parent = node.closest(".password-vault-entry");
							if (!parent) throw Error("Entry action has no card container");
							const rect = node.getBoundingClientRect(),
								card = parent.getBoundingClientRect();
							return {
								width: rect.width,
								height: rect.height,
								left: rect.left - card.left,
								right: card.right - rect.right,
							};
						}),
					);
				for (const action of actions) {
					expect(Number(action.width.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(Number(action.height.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(action.left).toBeGreaterThanOrEqual(0);
					expect(action.right).toBeGreaterThanOrEqual(0);
				}
				await expect(page.locator(".toast")).toBeHidden({timeout:10000});
                await page.locator(".asset-account-grid").screenshot({
					path: join(evidence, `${language}-${width}-social-neighbors.png`),
				});
				steps.push({
					step: "social-expanded-neighbors",
					baseline,
					expanded,
					actions,
				});
				const categories = page
					.locator(".unified-account-list")
					.first()
					.locator(".asset-category-scroll");
				await categories
					.getByRole("button", { name: t("social"), exact: true })
					.click();
				await expect(page.locator(".unified-account")).toHaveCount(1);
				if (
					!(await disclosure.evaluate(
						(node) => (node as HTMLDetailsElement).open,
					))
				)
					await disclosure.locator("summary").click();
				await expect(page.locator(".toast")).toBeHidden({timeout:10000});
                await account.screenshot({
					path: join(evidence, `${language}-${width}-social-filtered.png`),
				});
				const search=page.locator('#password-vault-search-input');await search.fill('no-matching-social-synthetic');await expect(page.locator('.unified-account')).toHaveCount(0);await page.getByRole('button',{name:t('accountListClearSearch'),exact:true}).click();await expect(search).toHaveValue('');await expect(account).toBeVisible();await expect(page.locator('.unified-account')).toHaveCount(1);await expect(categories.getByRole('button',{name:t('social'),exact:true})).toHaveAttribute('aria-pressed','true');steps.push({stage:'social-search-cleared',entryCount:await disclosure.locator('.password-vault-entry').count(),search:await search.inputValue(),category:await categories.getByRole('button',{name:t('social'),exact:true}).getAttribute('aria-pressed')});
                if(!(await disclosure.evaluate(n=>(n as HTMLDetailsElement).open)))await disclosure.locator("summary").click();
                await disclosure.locator("summary").focus();
				await disclosure.locator("summary").press("Enter");
				await expect(disclosure).toHaveJSProperty("open", false);
				await disclosure.locator("summary").press("Space");
				await expect(disclosure).toHaveJSProperty("open", true);
				await page.reload();
				const access = page.locator(".unified-vault-access");
				if (
					!(await access.evaluate((node) => (node as HTMLDetailsElement).open))
				)
					await access.locator("summary").click();
				await page.locator("#password-vault-unlock-master").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(account).toBeVisible();
				await disclosure.locator("summary").click();
				await expect(disclosure).toContainText(note);
				expect(errors).toEqual([]);
				steps.push({ step: "filtered-keyboard-refresh", result: "passed" });
                await expect(page.locator('.unified-account')).toHaveCount(1);await expect(disclosure.locator('.password-vault-entry')).toHaveCount(1);steps.push({stage:'social-populated',entryCount:await disclosure.locator('.password-vault-entry').count(),expanded:await disclosure.evaluate(n=>(n as HTMLDetailsElement).open),categoryFiltered:await categories.getByRole('button',{name:t('social'),exact:true}).getAttribute('aria-pressed'),searchCleared:await page.locator('#password-vault-search-input').inputValue()==='',refreshRestored:true});await expect(page.locator('.toast')).toBeHidden({timeout:10000});await account.screenshot({path:join(evidence,`${language}-${width}-social-restored.png`)});
			} finally {
				const release = process.env.KEEPANY_INDEPENDENT_PACKAGE_DIR
					? JSON.parse(
							readFileSync(
								join(process.env.KEEPANY_INDEPENDENT_PACKAGE_DIR, "RELEASE.json"),
								"utf8",
							),
						)
					: null;
				writeFileSync(
					join(evidence, `${language}-${width}-social.json`),
					JSON.stringify(
						{
							language,
							width,
							sourceCommit: release?.sourceCommit,
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
