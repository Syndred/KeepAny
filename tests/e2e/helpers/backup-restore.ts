import { expect, type Page } from "@playwright/test";

/** Open the restore disclosure inside the visible data/backup card. */
export async function openBackupRestorePanel(page: Page) {
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
