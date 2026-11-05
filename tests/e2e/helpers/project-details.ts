import { expect, type Page } from "@playwright/test";
/** Open the visible disclosures before using the controls they contain. */
export async function openOriginalProjectPage(page: Page) {
	await expect(
		page.locator("main.asset-detail-project, main.catalog-record-detail"),
	).toBeVisible();
    const info = page.locator('.unified-detail-project-info');
    if (await page.locator('main.catalog-record-detail').count()) await expect(info).toBeVisible();
}
export async function openProjectDetails(page: Page) {
	await openOriginalProjectPage(page);
	if (!/\/assets\/project\/[^/]+$/.test(new URL(page.url()).pathname)) return;
	await expect(page.locator("main.catalog-record-detail")).toBeVisible();
	for (const selector of [
		"#account-relations.detail-disclosure",
		".asset-project-media-disclosure",
	]) {
		const disclosure = page.locator(selector);
		if (
			(await disclosure.count()) &&
			!(await disclosure.evaluate((node) => (node as HTMLDetailsElement).open))
		)
			await disclosure.locator(":scope > summary").click();
	}
}
