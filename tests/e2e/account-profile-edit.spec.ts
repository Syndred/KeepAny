import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280]) {
		test(`${locale} account profile create, edit and reload at ${width}px`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const copy = locale === "zh-CN"
				? { add: "新增", save: "保存", edit: "编辑资料", provider: "服务商", profileDate: "账号资料核实日期", relationDate: "最近关系核验", paused: "已暂停", active: "使用中" }
				: { add: "Add", save: "Save", edit: "Edit profile", provider: "Provider", profileDate: "Account profile reviewed", relationDate: "Last connection verified", paused: "Paused", active: "Active" };
			try {
				await page.goto("/assets/account");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const dialog = page.getByRole("dialog");
				await dialog.locator("#name").fill("Work identity");
				await dialog.locator("#accountProvider").fill("Mail service");
				await dialog.locator("#username").fill("owner@example.test");
				await dialog.locator("#description").fill("Project access");
				await selectChoice(dialog.locator("#status"), "paused");
				await dialog.locator("#accountProfileVerifiedAt").fill("2026-02-14");
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				await page.locator(".asset-account-card").filter({ hasText: "Work identity" }).click();
				const id = page.url().split("/").at(-1);
				if (!id) throw Error("account id missing");
				const basic = page.locator(".account-facts-card").first();
				await expect(basic).toContainText("Mail service");
				await expect(basic).toContainText("Project access");
				await expect(basic).toContainText(copy.paused);
				await basic.getByRole("button", { name: copy.edit }).click();
				await expect(dialog.locator("#accountProvider")).toHaveValue("Mail service");
				await dialog.locator("#accountProvider").fill("Updated provider");
				await dialog.locator("#description").fill("Backup access");
				await selectChoice(dialog.locator("#status"), "active");
				await dialog.locator("#accountProfileVerifiedAt").fill("2026-03-15");
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				await page.evaluate(async ({ repositoryPath, domainPath, accountId }) => {
					const { saveBatch } = await import(repositoryPath);
					const { newAsset, relationSchema } = await import(domainPath);
					const project = { ...newAsset("project"), name: "Linked project" };
					const relation = relationSchema.parse({ id: crypto.randomUUID(), from: accountId, to: project.id,
						label: "manages", createdAt: new Date().toISOString(), verifiedAt: "2025-12-12" });
					await saveBatch([{ type: "asset", value: project }, { type: "relation", value: relation }]);
				}, { repositoryPath, domainPath, accountId: id });
				await page.reload();
				await expect(basic).toContainText("Updated provider");
				await expect(basic).toContainText("Backup access");
				await expect(basic).toContainText(copy.active);
				const security = page.locator(".account-security-card");
				const profileRow = security.locator("dl > div").filter({ has: page.locator("dt", { hasText: copy.profileDate }) });
				const relationRow = security.locator("dl > div").filter({ has: page.locator("dt", { hasText: copy.relationDate }) });
				await expect(profileRow).toContainText("2026");
				await expect(relationRow).toContainText("2025");
				await expect(basic.getByText(copy.provider, { exact: true })).toBeVisible();
				const stored = await page.evaluate(async ({ repositoryPath, accountId }) => {
					const { localRepository } = await import(repositoryPath);
					const account = await (await localRepository()).get("asset", accountId);
					return { provider: account.accountProvider, reviewed: account.accountProfileVerifiedAt, purpose: account.description, status: account.status };
				}, { repositoryPath, accountId: id });
				expect(stored).toEqual({ provider: "Updated provider", reviewed: "2026-03-15", purpose: "Backup access", status: "active" });
				await page.screenshot({ path: `/private/tmp/keepany-account-profile-${locale}-${width}.png`, fullPage: true });
				expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
				expect(errors).toEqual([]);
			} finally { await context.close(); }
		});
	}
}
