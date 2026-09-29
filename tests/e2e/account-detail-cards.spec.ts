import { expect, test, type Page } from "@playwright/test";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

async function seedAccount(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset, relationSchema } = await import(domainPath);
		const account = { ...newAsset("account"), name: "Work email", username: "owner@example.test", category: "email", description: "Project login", contact: "Operations", url: "https://example.test/account", tags: ["work"], notes: "Check owner quarterly", longDescription: "Record kept locally" };
		const project = { ...newAsset("project"), name: "Example project" };
		const vault = { ...newAsset("vault"), name: "Team vault" };
		const relation = relationSchema.parse({ id: crypto.randomUUID(), from: account.id, to: project.id, label: "manages", createdAt: new Date().toISOString(), verifiedAt: "2026-09-28" });
		const vaultRelation = relationSchema.parse({ id: crypto.randomUUID(), from: account.id, to: vault.id, label: "vault reference", createdAt: new Date().toISOString() });
		await saveBatch([{ type: "asset", value: account }, { type: "asset", value: project }, { type: "asset", value: vault }, { type: "relation", value: relation }, { type: "relation", value: vaultRelation }]);
		return account.id;
	}, { repositoryPath, domainPath });
}

for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} account cards show recorded data at 390px`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/assets/account");
			const id = await seedAccount(page);
			await page.goto(`/assets/account/${id}`);
			const headings = locale === "zh-CN" ? ["基本信息", "绑定与管理", "记录与安全"] : ["Basic information", "Links and management", "Records and security"];
			for (const name of headings) await expect(page.getByRole("heading", { name })).toBeVisible();
			const cards = page.locator(".account-facts-grid");
			await expect(cards).toContainText("owner@example.test");
			await expect(cards).toContainText("Project login");
			await expect(cards).toContainText("Operations");
			await expect(cards).toContainText("Example project");
			await expect(cards).toContainText("Team vault");
			await expect(cards).toContainText("2026");
			await page.reload();
			await expect(cards).toContainText("owner@example.test");
			await page.screenshot({ path: `/private/tmp/keepany-account-detail-${locale}.png`, fullPage: true });
			expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
