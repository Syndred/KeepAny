import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

test.setTimeout(120_000);

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-10-01/english-demo";
mkdirSync(evidence, { recursive: true });

async function englishOnly(page: Page) {
	const nativeLinks = await page.locator("a[href]").evaluateAll(links => links
		.filter(link => link.getClientRects().length > 0 && ["rgb(0, 0, 238)", "rgb(85, 26, 139)", "rgb(0, 0, 255)"].includes(getComputedStyle(link).color))
		.map(link => link.textContent));
	expect(nativeLinks, "Visible links use the application theme").toEqual([]);
	// Inspect rendered copy and form/accessibility text, including menus and placeholders.
	const text = await page.locator("body").evaluate(body => [
		(body as HTMLElement).innerText,
		...[...body.querySelectorAll<HTMLElement>("input, textarea, [aria-label], [title]")]
			.filter(element => element.getClientRects().length > 0)
			.flatMap(element => [element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.getAttribute("title"),
				 element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : ""]),
	].filter(Boolean).join("\n"));
	expect(text).not.toMatch(/\p{Script=Han}/u);
}

for (const width of [390, 1280]) {
	test(`English sample records stay English across pages, details, menus and refresh at ${width}`, async ({ browser }) => {
		const context = await browser.newContext({ locale: "zh-CN", viewport: { width, height: 844 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		try {
			await page.goto("/settings");
			await selectChoice(page.getByRole("combobox", { name: "语言", exact: true }), { value: "en" });
			await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
			await page.getByRole("combobox", { name: "Language", exact: true }).click();
			await expect(page.getByRole("option", { name: "Simplified Chinese", exact: true })).toBeVisible();
			await englishOnly(page);
			await page.keyboard.press("Escape");
			await page.locator("#advanced-settings > summary").click();
			await page.getByRole("button", { name: "Add sample records", exact: true }).click();
			await expect(page.getByText("Saved", { exact: true })).toBeVisible();
			await expect(page.getByRole("button", { name: "Add sample records", exact: true })).toBeDisabled();
			await page.goto("/");
			await expect(page.getByText("Mori Notes", { exact: true }).first()).toBeVisible();

			for (const [route, expected] of [
				["/", "Mori Notes"], ["/tasks", "Back up the work laptop"],
				["/assets/project", "Mori Notes"], ["/assets/account", "Studio Mail"],
				["/assets/item", "Work laptop"], ["/finance", "Cloud hosting"],
				["/assets/vault", "Studio Mail login"], ["/collections", "Studio essentials"],
				["/intake", "Import & backup"], ["/trash", "Trash"], ["/settings", "Settings"],
			] as const) {
				await page.goto(route);
				await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();
				await englishOnly(page);
				await page.reload();
				await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();
				await englishOnly(page);
				if (route === "/" || route === "/assets/vault" || route === "/finance")
					await page.screenshot({ path: join(evidence, `en-${width}-${route === "/" ? "overview" : route.split("/").at(-1)}.png`), fullPage: true });
			}
			for (const [kind, name] of [["project", "Mori Notes"], ["account", "Studio Mail"], ["item", "Work laptop"], ["vault", "Studio Mail login"]] as const) {
				await page.goto(`/assets/${kind}`);
				await page.locator(`main a[href^="/assets/${kind}/"]`).filter({ hasText: name }).first().click();
				await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
				await englishOnly(page);
				await page.getByRole("button", { name: "Edit", exact: true }).click();
				await expect(page.getByRole("dialog")).toBeVisible();
				await englishOnly(page);
				await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
			}
			await page.goto("/finance");
			await expect(page.locator("main")).toContainText("$12.00");
			await expect(page.locator("main")).toContainText("Monthly hosting bill");
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

test("Chinese sample records use Chinese copy and switching language preserves saved content", async ({ browser }) => {
	const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 844 } });
	const page = await context.newPage();
	try {
		await page.goto("/settings");
		await page.locator("#advanced-settings > summary").click();
		await page.getByRole("button", { name: "加入示例资料", exact: true }).click();
		await expect(page.getByText("工作室资料", { exact: true }).first()).toBeVisible();
		await page.goto("/");
		await expect(page.getByText("林间笔记", { exact: true }).first()).toBeVisible();
		await page.screenshot({ path: join(evidence, "zh-1280-overview.png"), fullPage: true });
		await page.goto("/settings");
		await selectChoice(page.getByRole("combobox", { name: "语言", exact: true }), { value: "en" });
		await page.goto("/assets/project");
		await expect(page.getByText("林间笔记", { exact: true }).first()).toBeVisible();
		await page.reload();
		await expect(page.getByText("林间笔记", { exact: true }).first()).toBeVisible();
	} finally { await context.close(); }
});
