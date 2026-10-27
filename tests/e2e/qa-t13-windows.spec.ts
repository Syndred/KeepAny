import { expect, test } from "@playwright/test";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repository = sourceModuleUrl("packages/local-db/src/index.ts");
const domain = sourceModuleUrl("packages/domain/src/index.ts");
for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} T13 annual renewal keeps the original leap-day anchor through four UI renewals`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width: locale === "zh-CN" ? 390 : 1280, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), locale === "zh-CN" ? "zh-CN" : "en");
		const page = await context.newPage();
		try {
			await page.goto("/");
			const id = await page.evaluate(async ([repositoryPath, domainPath]) => {
				const { newAsset } = await import(domainPath);
				const { save } = await import(repositoryPath);
				const asset = { ...newAsset("subscription"), name: "T13 leap-day", amount: 1200, currency: "USD", cycle: "year", interval: 1, dueDate: "2024-02-29", billingAnchor: "2024-02-29", renewalCount: 0 };
				await save("asset", asset);
				return asset.id;
			}, [repository, domain]);
			await page.goto(`/assets/subscription/${id}`);
			for (const [index, next] of ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"].entries()) {
				await page.getByRole("button", { name: locale === "zh-CN" ? "记录续费" : "Record renewal", exact: true }).click();
				await expect.poll(async () => page.evaluate(async ({ repositoryPath, id }) => {
					const db = await (await import(repositoryPath)).localRepository();
					const asset = await db.get("asset", id);
					const history = (await db.list("history")).filter((row: { assetId: string; action: string }) => row.assetId === id && row.action === "renew");
					return { anchor: asset.billingAnchor, due: asset.dueDate, count: history.length };
				}, { repositoryPath: repository, id })).toEqual({ anchor: "2024-02-29", due: next, count: index + 1 });
			}
			await page.reload();
			await expect(page.getByRole("heading", { name: "T13 leap-day", exact: true })).toBeVisible();
		} finally { await context.close(); }
	});
}
