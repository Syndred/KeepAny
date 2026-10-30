import { expect, type Page } from "@playwright/test";

/** Navigate through a visible application entry, keeping the unlocked session. */
export async function openBackupPage(page: Page) {
	await expect(page.locator("main")).toBeVisible();
	if (new URL(page.url()).pathname !== "/backup") {
        const shortcut = page.locator('main a[href="/backup"]');
        if (await shortcut.isVisible()) await shortcut.click();
        else {
            if (await page.locator('.mobile-menu').isVisible() && !(await page.locator('.sidebar.open').count())) await page.locator('.mobile-menu').click();
            await page.locator('.sidebar a[href="/backup"]').click();
        }
		await expect(page).toHaveURL(/\/backup$/);
	}
	await expect(page.locator(".intake-backup-card")).toBeVisible();
}

/** Open the restore disclosure inside the visible data/backup card. */
export async function openBackupRestorePanel(page: Page) {
	await openBackupPage(page);
	const card = page.locator(".intake-backup-card");
	await expect(card).toBeVisible();
	const section = card
		.locator("details")
		.filter({ has: page.locator("#restore-file") });
	await expect(section).toBeAttached();
	if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open)))
		await section.locator(":scope > summary").click();
	await expect(section).toHaveJSProperty("open", true);
	await expect(section.locator("#restore-file")).toBeVisible();
	return section;
}
