import { expect, type Page } from "@playwright/test";
/** Open the visible disclosures before using the controls they contain. */
export async function openOriginalProjectPage(page: Page) {
	await expect(
		page.locator("main.asset-detail-project, main.catalog-record-detail"),
	).toBeVisible();
	const original = page.getByRole("link", {
		name: /^(原有详细资料|Original details)$/,
		exact: true,
	});
	if (await original.isVisible()) await original.click();
}
export async function openProjectDetails(page: Page) {
	await openOriginalProjectPage(page);
	if (!/\/assets\/project\/[^/]+$/.test(new URL(page.url()).pathname)) return;
	await expect(page.locator("main.asset-detail-project")).toBeVisible();
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
