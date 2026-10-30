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
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	const ids = new Set<string>();
	for (const card of await page.locator(".compact-account-card").all()) {
		const switcher = card.locator(".compact-account-switch");
		const position = await switcher.count() ? (await switcher.innerText()).split("/").map(Number) : [1, 1];
		const [start, count] = position;
		for (let step = 0; step < count; step++) {
			const id = await card.getAttribute("data-entry-id");
			if (id) ids.add(id);
			if (count > 1) { await switcher.click(); await expect(switcher).toHaveText(`${(start + step) % count + 1}/${count}`); }
		}
	}
	for (const id of await page.locator(".workspace-password-only .password-vault-entry").evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.entryId))) if (id) ids.add(id);
	return [...ids].sort();
}
