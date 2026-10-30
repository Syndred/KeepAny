import { openBackupPage } from "./helpers/backup-restore";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/evidence/2026-09-29";

test("local release keeps edited project and restores its downloaded backup", async ({
	browser,
}) => {
	test.setTimeout(90_000);
	mkdirSync(evidence, { recursive: true });
	const source = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 900 },
	});
	const page = await source.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const name = `Release UI ${crypto.randomUUID().slice(0, 8)}`;
	const edited = `${name} edited`;
	const password = `KeepAny!${crypto.randomUUID()}`;
	try {
		await page.goto("/assets/project");
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await page
			.getByRole("dialog")
			.getByLabel("Name", { exact: true })
			.fill(name);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await page.locator(".asset-project-card").filter({ hasText: name }).click();
		await page
			.locator(".asset-project-action-bar")
			.getByRole("button", { name: "Edit" })
			.click();
		await page
			.getByRole("dialog")
			.getByLabel("Name", { exact: true })
			.fill(edited);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(page.getByRole("heading", { name: edited })).toBeVisible();
		await page.reload();
		await expect(page.getByRole("heading", { name: edited })).toBeVisible();
		await page.screenshot({
			path: `${evidence}/ui-restoration-release-en-US-1280-project-detail.png`,
			fullPage: true,
		});
		await page.goto("/intake");
		await openBackupPage(page); await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const downloaded = await downloadEvent;
		expect(downloaded.suggestedFilename()).toMatch(/\.ka1$/);
		const backupPath = await downloaded.path();
		if (!backupPath) throw Error("No .ka1 file was saved");
		const destination = await browser.newContext({
			locale: "zh-CN",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/intake");
			await openBackupPage(restored); await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored.getByRole("button", { name: "预览", exact: true }).click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.goto("/assets/project");
			await expect(
				restored.locator(".asset-project-card").filter({ hasText: edited }),
			).toBeVisible();
			await restored.reload();
			await expect(
				restored.locator(".asset-project-card").filter({ hasText: edited }),
			).toBeVisible();
			await restored.screenshot({
				path: `${evidence}/ui-restoration-release-zh-CN-390-restored-project.png`,
				fullPage: true,
			});
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(390);
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});
