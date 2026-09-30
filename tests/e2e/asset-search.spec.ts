import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

for (const locale of ["en", "zh-CN"] as const) {
	test(`${locale} public fields and item location share global and filtered list search`, async ({
		page,
	}) => {
		await page.setViewportSize({
			width: locale === "en" ? 1280 : 390,
			height: 844,
		});
		await page.goto("/");
		await page.evaluate(
			(language) => localStorage.setItem("keepany-language", language),
			locale,
		);
		const fixture = await page.evaluate(
			async ([repositoryPath, domainPath]) => {
				const { newAsset } = await import(domainPath);
				const { saveBatch } = await import(repositoryPath);
				const item = {
					...newAsset("item"),
					name: "Search camera NameProbe",
					category: "Search shelf",
					tags: ["FieldProbe"],
					url: "https://search.example/UrlProbe",
					username: "AccountProbe@example.test",
					location: "书房 → 工作桌 → DrawerProbe",
					notes: "hidden-note-probe",
					lastItemEventId: "hidden-marker-probe",
				};
				const wrongCategory = {
					...newAsset("item"),
					name: "Other category",
					tags: item.tags,
					location: item.location,
				};
				const wrongTag = {
					...newAsset("item"),
					name: "Other tag",
					category: item.category,
					tags: ["OtherProbe"],
					location: item.location,
				};
				const account = {
					...newAsset("account"),
					name: "Other asset kind",
					location: item.location,
				};
				const deleted = {
					...newAsset("item"),
					name: "DeletedSearchProbe",
					category: item.category,
					tags: item.tags,
					location: item.location,
					deleted: true,
				};
				await saveBatch([
					{
						type: "category",
						value: {
							id: crypto.randomUUID(),
							kind: "item",
							name: item.category,
							order: 0,
							deleted: false,
						},
					},
					...[item, wrongCategory, wrongTag, account, deleted].map((value) => ({
						type: "asset",
						value,
					})),
				]);
				return {
					id: item.id as string,
					name: item.name,
					category: item.category,
				};
			},
			[repositoryUrl, domainUrl],
		);
		await page.reload();
		const trigger = page.locator(".top-search-trigger");
		const input = page.locator("#top-search-query");
		const results = page.locator(".top-search-panel .search-results a");
		await trigger.click();
		for (const query of [
			"nameprobe",
			"FIELDPROBE",
			"SEARCH.EXAMPLE/URLPROBE",
			"accountprobe@",
			"  drawerprobe  ",
			"书房",
		]) {
			await input.fill(query);
			await expect(results.filter({ hasText: fixture.name })).toHaveCount(1);
		}
		for (const query of [
			"DeletedSearchProbe",
			"hidden-note-probe",
			"hidden-marker-probe",
			"does-not-exist",
		]) {
			await input.fill(query);
			await expect(results).toHaveCount(0);
		}
		await input.fill("DrawerProbe");
		await expect(results).toHaveCount(4);
		await results.filter({ hasText: fixture.name }).click();
		await expect(page).toHaveURL(new RegExp(`/assets/item/${fixture.id}$`));
		await expect(
			page.getByRole("heading", { name: fixture.name, exact: true }),
		).toBeVisible();

		await page.goto("/assets/item");
		await page
			.locator("main .asset-category-scroll")
			.getByRole("button", { name: fixture.category, exact: true })
			.click();
		await selectChoice(page.locator("#asset-tag-filter"), "FieldProbe");
		await trigger.click();
		await input.fill("  DRAWERPROBE  ");
		const cards = page.locator("main .asset-library-card");
		await expect(cards).toHaveCount(1);
		await expect(cards).toContainText(fixture.name);
		await expect(results).toHaveCount(4);
		for (const query of [
			"nameprobe",
			"fieldprobe",
			"search.example/urlprobe",
			"accountprobe@",
			"书房",
		]) {
			await input.fill(query);
			await expect(cards).toHaveCount(1);
			await expect(cards).toContainText(fixture.name);
		}
		await input.fill("hidden-marker-probe");
		await expect(cards).toHaveCount(0);
		await expect(results).toHaveCount(0);
		await input.fill("DrawerProbe");
		await expect(cards).toHaveCount(1);
		await page.reload();
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute("data-value", "FieldProbe");
		await expect(
			page
				.locator("main .asset-category-scroll")
				.getByRole("button", { name: fixture.category, exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(cards).toHaveCount(1);
		await expect(
			page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).resolves.toBe(true);
	});
}
