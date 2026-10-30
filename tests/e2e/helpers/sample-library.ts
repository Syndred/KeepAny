import { expect, type Page } from "@playwright/test";
export async function confirmSampleLibrary(page: Page) {
 const dialog = page.getByRole("dialog");
 await expect(dialog).toBeVisible();
 await dialog.getByRole("button", { name: /^(加入示例资料|Add sample records)$/, exact: true }).click();
 await expect(dialog).toBeHidden();
}
