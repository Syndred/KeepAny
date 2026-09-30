import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

for (const locale of ["en", "zh-CN"] as const) {
	test(`${locale} vault reference links a real asset and appears in table`, async ({ page }) => {
		await page.setViewportSize({ width: locale === "en" ? 1144 : 390, height: 844 });
		await page.goto("/");
		await page.evaluate((language) => localStorage.setItem("keepany-language", language), locale);
		await page.goto("/assets/vault");
		const accountId = await page.evaluate(async ({ repositoryPath, domainPath }) => {
			const { save } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			const account = { ...newAsset("account"), name: "Studio account" };
			await save("asset", account);
			return account.id as string;
		}, { repositoryPath: repositoryModuleUrl, domainPath: domainModuleUrl });
		await page.getByRole("main").getByRole("button", { name: locale === "en" ? "Link vault entry" : "关联密码库条目", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel(locale === "en" ? "Entry name" : "条目名称").fill("Studio login reference");
		await dialog.getByLabel(locale === "en" ? "Stored in" : "保管位置").fill("Bitwarden personal vault");
		await selectChoice(dialog.getByLabel(locale === "en" ? "Used for" : "用于"), accountId);
		await dialog.getByLabel(locale === "en" ? "Verified" : "核实时间").fill("2026-09-20");
		await expect(dialog.getByLabel(/password|密码|恢复码/i)).toHaveCount(0);
		await dialog.getByRole("button", { name: locale === "en" ? "Save" : "保存", exact: true }).click();
		await expect(dialog).toBeHidden();
		await page.reload();
		const row = page.getByRole("row", { name: /Studio login reference/ });
		await expect(row).toContainText("Studio account");
		await expect(row).toContainText("Bitwarden personal vault");
		await expect(row).toContainText("2026");
		await expect(row).toContainText(locale === "en" ? "Linked" : "已关联");
		const records = await page.evaluate(async ({ repositoryPath, linkedId }) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			const vault = (await repository.list("asset") as Array<{ id: string; kind: string; name: string; location: string }>).find((asset) => asset.kind === "vault" && asset.name === "Studio login reference");
			const relation = (await repository.list("relation") as Array<{ from: string; to: string; verifiedAt: string }>).find((item) => item.from === vault?.id && item.to === linkedId);
			return { vault, relation };
		}, { repositoryPath: repositoryModuleUrl, linkedId: accountId });
		expect(records.vault?.location).toBe("Bitwarden personal vault");
		expect(records.relation?.verifiedAt).toBe("2026-09-20");
		await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
		await page.screenshot({ path: join(tmpdir(), `keepany-vault-reference-${locale}.png`), fullPage: true });
	});
}
