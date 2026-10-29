import { expect, type Page } from "@playwright/test";

/** Open the user-visible access disclosure before entering a synthetic master. */
export async function openVaultAccess(page: Page) {
	await expect(
		page
			.locator("#password-vault-master")
			.or(page.locator("#password-vault-unlock-master")),
	).toBeAttached();
	const access = page.locator(".unified-vault-access");
	// Detail embeds have a direct form; the unified workspace adds a disclosure.
	if ((await access.count()) === 0) return;
	await expect(access).toBeVisible();
	if (!(await access.evaluate((node) => (node as HTMLDetailsElement).open)))
		await access.locator(":scope > summary").click();
	await expect(access).toHaveJSProperty("open", true);
}

/** Legacy password routes now expose saved logins inside account disclosures. */
export async function revealPasswordEntries(page: Page) {
	for (const section of await page
		.locator(".unified-account-passwords")
		.all()) {
		if (!(await section.evaluate((node) => (node as HTMLDetailsElement).open)))
			await section.locator(":scope > summary").click();
		await expect(section).toHaveJSProperty("open", true);
	}
}

/** Wait for the actual workspace, then use its visible disclosure controls. */
export async function prepareVaultWorkspace(page: Page) {
	await expect(
		page
			.locator(
				".unified-vault-access, .password-vault-toolbar, #password-vault-master, #password-vault-unlock-master",
			)
			.first(),
	).toBeAttached();
	const access = page.locator(".unified-vault-access");
	if (await access.count()) await openVaultAccess(page);
	else await revealPasswordEntries(page);
}

export async function openVaultReferences(page: Page) {
	const references = page.locator(".unified-vault-references");
	await expect(references).toBeVisible();
	if (!(await references.evaluate((node) => (node as HTMLDetailsElement).open)))
		await references.locator(":scope > summary").click();
	await expect(references).toHaveJSProperty("open", true);
}
