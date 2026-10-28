import { expect, test, type Locator, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

async function assertPopup(page: Page, trigger: Locator) {
	await expect(trigger).toHaveJSProperty("tagName", "BUTTON");
	await trigger.click();
	const popup = page.getByRole("listbox");
	await expect(popup).toBeVisible();
	const surface = popup.locator("..");
	const bounds = await surface.boundingBox();
	if (!bounds) throw Error("select-popup-bounds-missing");
	const viewport = page.viewportSize();
	if (!viewport) throw Error("select-viewport-missing");
	expect(bounds.x).toBeGreaterThanOrEqual(7);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7);
	expect(bounds.y).toBeGreaterThanOrEqual(7);
	expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7);
	const theme = await surface.evaluate((element) => {
		const style = getComputedStyle(element);
		const root = getComputedStyle(document.documentElement);
		return {
			background: style.backgroundColor,
			border: style.borderTopWidth,
			paper: root.getPropertyValue("--paper").trim(),
			zIndex: style.zIndex,
		};
	});
	expect(theme.border).toBe("2px");
	expect(Number(theme.zIndex)).toBeGreaterThan(31);
	expect(theme.background).not.toBe("rgba(0, 0, 0, 0)");
	return popup;
}

for (const zh of [true, false]) {
	for (const width of [390, 1280]) {
		test(`${zh ? "zh-CN" : "en-US"} ${width}: themed choices preserve keyboard, clearing, required fields and long labels`, async ({ page }, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto("/settings");
			let language = page.getByRole("combobox", { name: /^(Language|语言)$/ });
			await selectChoice(language, zh ? "zh-CN" : "en");
			language = page.getByRole("combobox", { name: zh ? "语言" : "Language", exact: true });
			const pointerValue = zh ? "en" : "zh-CN";
			const pointerPopup = await assertPopup(page, language);
			await pointerPopup
				.getByRole("option")
				.and(page.locator(`[role="option"][data-value="${pointerValue}"]`))
				.click();
			language = page.getByRole("combobox", {
				name: pointerValue === "en" ? "Language" : "语言",
				exact: true,
			});
			await expect(language).toHaveAttribute("data-value", pointerValue);
			await expect(language).toHaveAttribute("aria-expanded", "false");
			await expect(pointerPopup).toBeHidden();
			await selectChoice(language, zh ? "zh-CN" : "en");
			language = page.getByRole("combobox", {
				name: zh ? "语言" : "Language",
				exact: true,
			});
			const before = await language.getAttribute("data-value");
			await assertPopup(page, language);
			await page.getByRole("listbox").press("Escape");
			await expect(page.getByRole("listbox")).toBeHidden();
			await expect(language).toBeFocused();
			await expect(language).toHaveCSS("outline-color", "rgb(255, 210, 76)");
			await expect(language).toHaveAttribute("data-value", before ?? "");
			await language.press("ArrowDown");
			const languagePopup = page.getByRole("listbox");
			const selectedLanguageOption = languagePopup.getByRole("option", { selected: true });
			await expect(selectedLanguageOption).toBeFocused();
			await expect(selectedLanguageOption).toHaveCSS("background-color", "rgb(255, 210, 76)");
			await expect(selectedLanguageOption.locator(".themed-select-item-indicator")).toHaveCSS("color", "rgb(23, 36, 58)");
			await selectedLanguageOption.press("End");
			const englishOption = languagePopup
				.getByRole("option")
				.and(page.locator('[role="option"][data-value="en"]'));
			await expect(englishOption).toBeFocused();
			await englishOption.press("Enter");
			await expect(page.getByRole("combobox", { name: "Language", exact: true })).toHaveAttribute("data-value", "en");
			await selectChoice(page.getByRole("combobox", { name: "Language", exact: true }), zh ? "zh-CN" : "en");
			await expect(page.locator('select:not([aria-hidden="true"])')).toHaveCount(0);

			const account = `${zh ? "旅行项目通知邮箱" : "Travel mailbox"} ${"L".repeat(110)}`;
			await page.goto("/assets/account");
			await page.getByRole("main").getByRole("button", { name: zh ? "新增" : "Add", exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.getByLabel(zh ? "名称" : "Name", { exact: true }).fill(account);
			await selectChoice(dialog.getByLabel(zh ? "分类" : "Category", { exact: true }), "email");
			await dialog.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
			await expect(dialog).toBeHidden();
			const card = page.locator("main .asset-account-card").filter({ hasText: account });
			await expect(card).toHaveCount(1);
			const href = await card.getAttribute("href");
			const id = href?.split("/").at(-1);
			if (!id) throw Error("select-test-account-id-missing");

			await page.goto("/tasks");
			await page.getByRole("button", { name: zh ? "新建维护计划" : "New maintenance plan", exact: true }).click();
			dialog = page.getByRole("dialog");
			const plan = zh ? "检查邮箱资料" : "Review mailbox details";
			await dialog.getByLabel(zh ? "计划名称" : "Plan name").fill(plan);
			const target = dialog.getByLabel(zh ? "关联资产" : "Linked asset", { exact: true });
			const submit = dialog.getByRole("button", { name: zh ? "创建计划" : "Create plan", exact: true });
			await expect(target).toHaveAttribute("data-value", "");
			await submit.click();
			await expect(dialog).toBeVisible();
			await expect(page.locator(".maintenance-task-row")).toHaveCount(0);
			await expect(target).toBeFocused();
			await expect(target).toHaveAttribute("aria-invalid", "true");
			await expect(dialog.locator(".themed-select-error")).toBeVisible();
			await selectChoice(target, id);
			await expect(target).toContainText(account);
			const selectedValue = target.locator(".themed-select-value");
			await expect(selectedValue).toHaveAttribute("title", `${account} · ${zh ? "账号" : "Accounts"}`);
			expect(await target.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Continuous long values fit inside the picker").toBe(true);
			await selectChoice(target, "");
			await expect(target).toContainText(zh ? "选择资产" : "Select an asset");
			await submit.click();
			await expect(dialog).toBeVisible();
			await expect(target).toBeFocused();
			await selectChoice(target, id);
			const popup = await assertPopup(page, target);
			const longOption = popup.getByRole("option", { name: `${account} · ${zh ? "账号" : "Accounts"}`, exact: true });
			await expect(longOption).toBeVisible();
			expect(await longOption.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Continuous long option labels fit inside the menu").toBe(true);
			expect(await longOption.locator(".themed-select-item-text").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
			await page.screenshot({ path: testInfo.outputPath(`select-${zh ? "zh" : "en"}-${width}.png`) });
			await popup.press("Escape");
			await dialog.getByLabel(zh ? "下次日期" : "Next date").fill("2026-10-05");
			await submit.click();
			await expect(dialog).toBeHidden();
			await expect(page.locator(".maintenance-task-row")).toContainText(plan);
			await page.reload();
			await expect(page.locator(".maintenance-task-row")).toContainText(plan);
			await expect(page.locator(".maintenance-task-row")).toContainText(account);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			expect(errors).toEqual([]);
		});
	}
}
