import { expect, type Page } from "@playwright/test";
import { openCompactLoginDetails } from "./compact-account";

type Copy = (key: string) => string;

/** The old global password-only create was removed. Start with the one actual account entry. */
export async function openStandaloneEntryDraft(page: Page, _t?: Copy) {
	await page.locator(".password-vault-header").getByRole("button", { name: /^(新增|Add)$/ }).click();
	await expect(page.getByRole("dialog").locator("#password-vault-entry-title")).toBeVisible();
}

/**
 * Preserve password-only lifecycle tests by saving through the new UI and then
 * explicitly unlinking its credential. The new ordinary account remains saved.
 * Return its identity so callers can account for the intentional extra record.
 */
export async function saveStandaloneEntryDraft(page: Page, t: Copy) {
	const dialog = page.getByRole("dialog");
	await expect(dialog.locator(".account-entry-form")).toBeVisible();
	const title = await dialog.locator("#password-vault-entry-title").inputValue();
	const explicitlyLinked = await dialog.locator(".password-vault-linked-chip").count();
	const before = await page.locator(".compact-account-title").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
	await dialog.getByRole("button", { name: /^(保存|Save)$/ }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator(".compact-account-title")).toHaveCount(before.length + 1);
	const after = await page.locator(".compact-account-title").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
	const added = after.filter(href => href && !before.includes(href));
	expect(added).toHaveLength(1);
	const accountHref = added[0]!;
	// This value came from the app's generated UUID URL, not from a user-provided title.
	const account = page.locator(".unified-account").filter({ has: page.locator(`.compact-account-title[href="${accountHref}"]`) });
	await expect(account.locator(".compact-account-title")).toContainText(title);
	const detail = await openCompactLoginDetails(page, account, t);
	const entry = detail.locator(".password-vault-entry");
	await expect(entry).toHaveCount(1);
	const entryId = await entry.getAttribute("data-entry-id");
	await entry.locator(".password-vault-linked-connection").filter({ has: page.locator(`a[href="${accountHref}#account-relations"]`) }).getByRole("button").click();
	await page.getByRole("dialog", { name: t("pwVaultUnlink"), exact: true }).getByRole("button", { name: t("pwVaultUnlink"), exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(account).not.toHaveAttribute("data-entry-id", /.+/);
	if (!explicitlyLinked) await expect(page.locator(`.workspace-password-only .password-vault-entry[data-entry-id="${entryId}"]`)).toBeVisible();
	return { accountHref, accountId: accountHref.split("/").at(-1)!, entryId: entryId! };
}
