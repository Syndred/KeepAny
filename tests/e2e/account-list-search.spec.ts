import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence = process.env.KEEPANY_EVIDENCE_DIR;

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1536]) {
	test(`${locale} ${width}px account search combines filters, clears and survives returning from detail`, async ({ browser }) => {
		test.setTimeout(120_000);
		const zh = locale === "zh-CN";
		const copy = zh ? { add: "新增", save: "保存", search: "搜索账号", clear: "清空账号搜索", noMatches: "没有匹配的记录", all: "全部", other: "其他", phone: "手机", global: "搜索全部资料", close: "关闭" }
			: { add: "Add", save: "Save", search: "Search accounts", clear: "Clear account search", noMatches: "No matching records", all: "All", other: "Other", phone: "Phone", global: "Search all records", close: "Close" };
		const context = await browser.newContext({ locale, viewport: { width, height: 960 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const fixtures = [
			{ name: "North Studio", username: "studio.owner@example.test", provider: "Example Identity", category: "other", tags: "work", notes: "private-search-needle" },
			{ name: "云端邮箱", username: "mail.owner@example.test", provider: "Example Mail", category: "email", tags: "work", notes: "" },
			{ name: "Mobile", username: "+447700900123", provider: "Example Mobile", category: "phone", tags: "personal", notes: "" },
			{ name: "North Backup", username: "backup.owner@example.test", provider: "Archive Identity", category: "other", tags: "personal", notes: "" },
		];
		try {
			for (const fixture of fixtures) {
				await page.goto("/assets/account");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const dialog = page.getByRole("dialog");
				await dialog.locator("#name").fill(fixture.name);
				await selectChoice(dialog.locator("#category"), fixture.category);
				await dialog.locator("#username").fill(fixture.username);
				await dialog.locator("#accountProvider").fill(fixture.provider);
				await dialog.locator("#tags").fill(fixture.tags);
				await dialog.locator("#notes").fill(fixture.notes);
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
			}
			const search = page.getByRole("searchbox", { name: copy.search, exact: true });
			const cards = page.locator("a.asset-account-card");
			await expect(search).toHaveCount(1);
			await expect(cards).toHaveCount(4);
			for (const [query, names] of [
				["  NORTH  ", ["North Studio", "North Backup"]],
				["STUDIO.OWNER@EXAMPLE.TEST", ["North Studio"]],
				["example identity", ["North Studio"]],
				["云端", ["云端邮箱"]],
				["900123", ["Mobile"]],
				["private-search-needle", []],
				["does-not-exist", []],
			] as [string, string[]][]) {
				await search.fill(query);
				await expect.poll(async () => (await cards.locator("strong").allTextContents()).sort()).toEqual([...names].sort());
				if (!names.length) await expect(page.getByText(copy.noMatches, { exact: true })).toBeVisible();
			}
			await page.getByRole("button", { name: copy.clear, exact: true }).click();
			await expect(search).toHaveValue("");
			await expect(search).toBeFocused();
			await expect(cards).toHaveCount(4);
			await search.fill("north");
			await page.locator(".asset-category-scroll").getByRole("button", { name: copy.phone, exact: true }).click();
			await expect(cards).toHaveCount(0);
			await page.locator(".asset-category-scroll").getByRole("button", { name: copy.other, exact: true }).click();
			await expect(cards).toHaveCount(2);
			await selectChoice(page.locator("#asset-tag-filter-account"), "work");
			await expect(cards.locator("strong")).toHaveText(["North Studio"]);
			await cards.click();
			await expect(page.getByRole("heading", { name: "North Studio", exact: true })).toBeVisible();
			await page.locator(".topbar-back-link").click();
			await expect(search).toHaveValue("north");
			await expect(cards.locator("strong")).toHaveText(["North Studio"]);
			await page.reload();
			await expect(search).toHaveValue("north");
			await expect(cards.locator("strong")).toHaveText(["North Studio"]);
			await search.press("Escape");
			await expect(search).toHaveValue("");
			await expect(cards.locator("strong")).toHaveText(["North Studio"]);
			await selectChoice(page.locator("#asset-tag-filter-account"), "");
			await page.locator(".asset-category-scroll").getByRole("button", { name: copy.all, exact: true }).click();
			await expect(cards).toHaveCount(4);
			await search.fill("north");
			await page.getByRole("button", { name: copy.global, exact: true }).click();
			await page.locator("#top-search-query").fill("mail.owner");
			await expect(page.locator(".top-search-panel .search-results a")).toHaveCount(1);
			await page.locator(".top-search-panel-input").getByRole("button", { name: copy.close, exact: true }).click();
			await expect(search).toHaveValue("north");
			await expect(cards).toHaveCount(2);
			await page.getByRole("button", { name: copy.clear, exact: true }).click();
			const geometry = await page.locator(".asset-category-toolbar--search").evaluate(toolbar => {
				const field = toolbar.querySelector(".asset-account-search")?.getBoundingClientRect();
				const categories = toolbar.querySelector(".asset-category-scroll")?.getBoundingClientRect();
				return { field: field && { x: field.x, y: field.y, width: field.width, height: field.height }, categories: categories && { x: categories.x, y: categories.y, bottom: categories.bottom }, overflow: document.documentElement.scrollWidth > innerWidth };
			});
			expect(geometry.overflow).toBe(false);
			expect(geometry.field?.height).toBeGreaterThanOrEqual(44);
			if (width === 390) expect(geometry.categories?.y).toBeGreaterThanOrEqual((geometry.field?.y ?? 0) + (geometry.field?.height ?? 0) + 11);
			else expect(Math.abs((geometry.field?.y ?? 0) - (geometry.categories?.y ?? 0))).toBeLessThan(10);
			if (evidence) {
				mkdirSync(evidence, { recursive: true });
				await page.screenshot({ path: join(evidence, `account-search-${locale}-${width}.png`), fullPage: true });
			}
			await search.fill("north");
			const clearBounds = await page.getByRole("button", { name: copy.clear, exact: true }).boundingBox();
			expect(clearBounds?.width).toBeGreaterThanOrEqual(44);
			expect(clearBounds?.height).toBeGreaterThanOrEqual(44);
			if (evidence) await page.screenshot({ path: join(evidence, `account-search-filtered-${locale}-${width}.png`), fullPage: true });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
