import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";
import { sourceModuleUrl } from "./helpers/source-module-url";

const evidence = process.env.KEEPANY_EVIDENCE_DIR;
const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");

// Healthy-contract extension for T03-01/02/04. Existing profile/search tests do not
// jointly check canceled fields, unchanged relation IDs and a double-click create.
for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T03 account validation, double save and edit preserve existing data`, async ({ browser }) => {
		test.setTimeout(120_000);
		const zh = locale === "zh-CN";
		const copy = zh ? { add: "新增", save: "保存", cancel: "取消", edit: "编辑", search: "搜索账号", clear: "清空账号搜索" }
			: { add: "Add", save: "Save", cancel: "Cancel", edit: "Edit", search: "Search accounts", clear: "Clear account search" };
		const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const name = "QA Mail owner";
		const readAccounts = async () => page.evaluate(async path => {
			const { localRepository } = await import(path);
			return (await (await localRepository()).allRecords()).filter((row: { type: string }) => row.type === "asset")
				.map((row: { payload: string }) => JSON.parse(row.payload)).filter((row: { kind: string; deleted: boolean }) => row.kind === "account" && !row.deleted);
		}, repositoryPath);
		const capture = async (stage: string) => {
			if (!evidence) return;
			mkdirSync(evidence, { recursive: true });
			await page.screenshot({ path: join(evidence, `T03-${locale}-${width}-${stage}.png`), fullPage: true });
		};
		try {
			await page.goto("/accounts");
			await page.getByRole("button", { name: copy.add, exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog.locator("#name")).toHaveAttribute("aria-invalid", "true");
			expect(await readAccounts()).toHaveLength(0);
			await dialog.locator("#name").fill(name);
			await selectChoice(dialog.locator("#category"), "email");
			await dialog.locator("#url").fill("invalid-url");
			await dialog.locator("#username").fill("qa.owner@example.test");
			await dialog.locator("#accountProvider").fill("QA Mail");
			await dialog.locator("#contact").fill("public-contact@example.test");
			await dialog.locator("#description").fill("Keep this purpose");
			await dialog.locator("#tags").fill("qa-work, retained-tag");
			await dialog.locator("#notes").fill("Keep this note, punctuation and spaces  ");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeVisible();
			await expect(dialog.locator("#url")).toBeFocused();
			expect(await dialog.locator("#url").evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(false);
			await expect(dialog.locator("#name")).toHaveValue(name);
			expect(await readAccounts()).toHaveLength(0);
			await capture("invalid-url");
			await dialog.locator("#url").fill("https://mail.example.test");
			await expect(dialog.locator("#url")).toHaveValue("https://mail.example.test");
			await dialog.getByRole("button", { name: copy.save, exact: true }).dblclick();
			await expect(dialog).toBeHidden();
			await expect.poll(async () => (await readAccounts()).length).toBe(1);
			await page.reload();
			await expect(page.locator("a.asset-account-card")).toHaveCount(1);
			await page.locator("a.asset-account-card").click();
			const accountId = page.url().split("/").at(-1);
			if (!accountId) throw Error("Missing account id");
			const relationId = await page.evaluate(async ({ repositoryPath, domainPath, accountId }) => {
				const { saveBatch } = await import(repositoryPath);
				const { newAsset, relationSchema } = await import(domainPath);
				const project = { ...newAsset("project"), name: "QA existing project" };
				const relation = relationSchema.parse({ id: crypto.randomUUID(), from: accountId, to: project.id, label: "manages", createdAt: new Date().toISOString(), verifiedAt: "2026-10-01" });
				await saveBatch([{ type: "asset", value: project }, { type: "relation", value: relation }]);
				return relation.id;
			}, { repositoryPath, domainPath, accountId });
			const edit = page.locator(".page-header").getByRole("button", { name: copy.edit, exact: true });
			await edit.click();
			await expect(dialog.locator("#category")).toHaveAttribute("data-value", "email");
			await expect(dialog.locator("#notes")).toHaveValue("Keep this note, punctuation and spaces  ");
			await dialog.locator("#name").fill("Canceled rename");
			await dialog.locator("#notes").fill("Canceled note");
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await page.reload();
			await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
			await edit.click();
			await expect(dialog.locator("#notes")).toHaveValue("Keep this note, punctuation and spaces  ");
			await dialog.locator("#accountProvider").fill("QA Mail updated");
			await dialog.locator("#notes").scrollIntoViewIfNeeded();
			await expect(dialog.getByRole("button", { name: copy.save, exact: true })).toBeInViewport({ ratio: 1 });
			const spacing = await dialog.locator("form > .actions").evaluate(actions => {
				const buttons = Array.from(actions.querySelectorAll("button")).map(button => button.getBoundingClientRect());
				return { gap: buttons.length === 2 ? Math.max(buttons[1].left - buttons[0].right, buttons[0].left - buttons[1].right, buttons[1].top - buttons[0].bottom, buttons[0].top - buttons[1].bottom) : null,
					overflow: document.documentElement.scrollWidth > innerWidth };
			});
			expect(spacing.overflow).toBe(false);
			expect(spacing.gap).toBeGreaterThanOrEqual(7);
			await capture("edit-preserved-fields");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await edit.click();
			for (const [id, value] of Object.entries({ name, url: "https://mail.example.test", username: "qa.owner@example.test", contact: "public-contact@example.test", description: "Keep this purpose", accountProvider: "QA Mail updated", notes: "Keep this note, punctuation and spaces  " })) {
				await expect(dialog.locator(`#${id}`)).toHaveValue(value);
			}
			await expect(dialog.locator("#category")).toHaveAttribute("data-value", "email");
			await expect(dialog.locator("#tags")).toHaveValue("qa-work, retained-tag");
			const relation = await page.evaluate(async ({ repositoryPath, relationId }) => {
				const { localRepository } = await import(repositoryPath);
				return (await localRepository()).get("relation", relationId);
			}, { repositoryPath, relationId });
			expect(relation).toMatchObject({ id: relationId, from: accountId, label: "manages", verifiedAt: "2026-10-01", deleted: false });
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await capture("saved-detail");
			await page.goto("/accounts");
			await page.getByRole("button", { name: copy.add, exact: true }).click();
			await dialog.locator("#name").fill("QA Mail backup");
			await selectChoice(dialog.locator("#category"), "email");
			await dialog.locator("#username").fill("qa.backup@example.test");
			await dialog.locator("#accountProvider").fill("QA Mail updated");
			await dialog.locator("#tags").fill("personal");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const cards = page.locator("a.asset-account-card");
			const search = page.getByRole("searchbox", { name: copy.search, exact: true });
			await expect(cards).toHaveCount(2);
			await search.fill("QA Mail updated");
			await expect(cards).toHaveCount(2);
			await search.fill("qa.owner@example.test");
			await expect(cards.locator("strong")).toHaveText([name]);
			await search.fill("QA Mail");
			await page.locator(".asset-category-scroll").getByRole("button", { name: /^(邮箱|Email)$/, exact: true }).click();
			await selectChoice(page.locator("#asset-tag-filter"), "qa-work");
			await expect(cards.locator("strong")).toHaveText([name]);
			await search.fill("backup");
			await expect(cards).toHaveCount(0);
			await page.getByRole("button", { name: copy.clear, exact: true }).click();
			await expect(search).toHaveValue("");
			await expect(cards.locator("strong")).toHaveText([name]);
			await selectChoice(page.locator("#asset-tag-filter"), "");
			await page.locator(".asset-category-scroll").getByRole("button", { name: /^(全部|All)$/, exact: true }).click();
			await expect(cards).toHaveCount(2);
			await capture("same-platform-accounts");
			expect(errors).toEqual([]);
			if (evidence) writeFileSync(join(evidence, `T03-${locale}-${width}-observations.json`), JSON.stringify({ locale, width, accountId, relationId, accountCount: (await readAccounts()).length, spacing, pageErrors: errors,
				checks: ["empty name rejected without write", "invalid URL focused without write", "double-click creates one account", "category and all fields persist after reload", "cancel preserves existing fields", "provider-only edit preserves notes and relation", "same-provider distinct usernames remain separate", "category/tag/search intersection and clear preserve remaining filters"] }, null, 2));
		} finally { await context.close(); }
	});
}
