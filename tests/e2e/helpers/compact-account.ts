import { expect, type Locator, type Page } from "@playwright/test";

type Copy = (key: string) => string;

export async function openCompactLoginDetails(page: Page, card: Locator, t: Copy) {
	await card.getByRole("button", { name: t("moreActions"), exact: true }).click();
	await page.getByRole("menuitem", { name: t("compactAccountLoginDetails"), exact: true }).click();
	const dialog = page.getByRole("dialog", { name: t("compactAccountLoginDetails"), exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

export async function closeCompactLoginDetails(page: Page, t: Copy) {
	const dialog = page.getByRole("dialog", { name: t("compactAccountLoginDetails"), exact: true });
	if (await dialog.count()) await dialog.getByRole("button", { name: t("close"), exact: true }).click();
}

/** Count distinct business entries through the visible card's real switch control. */
export async function compactEntryIds(page: Page) {
	const ids = new Set<string>();
	for (const card of await page.locator(".compact-account-card").all()) {
		const switcher = card.locator(".compact-account-switch");
		const count = await switcher.count() ? Number((await switcher.innerText()).split("/").at(-1)) : 1;
		for (let step = 0; step < count; step++) {
			const id = await card.getAttribute("data-entry-id");
			if (id) ids.add(id);
			if (count > 1) await switcher.click();
		}
	}
	for (const id of await page.locator(".workspace-password-only .password-vault-entry").evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.entryId))) if (id) ids.add(id);
	return [...ids].sort();
}
