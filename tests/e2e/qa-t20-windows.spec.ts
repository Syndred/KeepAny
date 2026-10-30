import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { visualHarness, visualVaultContentFingerprint } from "./fixtures/password-smart-import-visual";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repository = sourceModuleUrl("packages/local-db/src/index.ts");
const domain = sourceModuleUrl("packages/domain/src/index.ts");
test.setTimeout(120_000);
for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} T20 wrong password, damaged KA1 and different KDBX preserve existing data`, async ({ browser }, info) => {
		const source = await visualHarness(browser, locale);
		const target = await visualHarness(browser, locale, { width: locale === "zh-CN" ? 390 : 1280, height: 1000 });
		const zh = locale === "zh-CN";
		const backupPassword = "Synthetic outer T20 backup!42";
		try {
			await source.page.goto("/assets/vault");
			await source.createVault();
			await source.seedExisting({ title: "Incoming vault", username: "source@example.test", password: "Synthetic-source!42" });
			await source.page.evaluate(async ([r, d]) => {
				const { newAsset } = await import(d);
				await (await import(r)).save("asset", { ...newAsset("project"), name: "Incoming project must not partially appear" });
			}, [repository, domain]);
			await source.page.goto("/intake");
			await openBackupPage(source.page);
			await openBackupPage(source.page); await source.page.locator("#backup-password").fill(backupPassword);
			await source.page.getByRole("button", { name: zh ? "创建备份" : "Create backup", exact: true }).click();
			const download = source.page.waitForEvent("download");
			await source.page.getByRole("link", { name: zh ? "保存备份文件" : "Save backup file", exact: true }).click();
			const path = info.outputPath("incoming.ka1");
			await (await download).saveAs(path);
			await target.page.goto("/assets/vault");
			await target.createVault();
			await target.seedExisting({ title: "Keep local vault", username: "local@example.test", password: "Synthetic-local!42" });
			const before = await visualVaultContentFingerprint(target.page);
			await target.page.goto("/intake");
			await target.page.locator("summary").filter({ hasText: zh ? "恢复备份" : "Restore backup" }).click();
			for (const kind of ["wrong-password", "damaged", "different-vault"]) {
				await openBackupPage(target.page);
				await openBackupPage(target.page); await target.page.locator("#backup-password").fill(kind === "wrong-password" ? "Definitely wrong synthetic password" : backupPassword);
				const damaged = Buffer.from(readFileSync(path));
				damaged[damaged.length - 1] ^= 1;
				await target.page.locator("#restore-file").setInputFiles(kind === "damaged" ? { name: "damaged.ka1", mimeType: "application/octet-stream", buffer: damaged } : path);
				await target.page.getByRole("button", { name: zh ? "预览" : "Preview", exact: true }).click();
				if (kind === "different-vault") {
					await target.page.getByRole("button", { name: /^(确认|Confirm) ·/ }).click();
					await expect(target.page.getByRole("status").filter({ hasText: zh ? "本机已有不同的密码库" : "A different password vault already exists" })).toBeVisible();
				} else {
					await expect(target.page.getByRole("status").filter({ hasText: zh ? "密码不正确或备份已损坏" : "Incorrect password or damaged backup" })).toBeVisible();
					await expect(target.page.getByRole("button", { name: /^(确认|Confirm) ·/ })).toHaveCount(0);
				}
				expect(await target.page.evaluate(async r => (await (await import(r)).localRepository()).allRecords(), repository)).toEqual([]);
				expect(await visualVaultContentFingerprint(target.page)).toEqual(before);
			}
		} finally { await source.close(); await target.close(); }
	});
}
