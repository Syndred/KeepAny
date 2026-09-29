import { expect, test } from "@playwright/test";

const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

test("AI impact entry offers all three scenarios and opens the real selected workflow", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
	await page.evaluate(async ([domainPath, repositoryPath]) => {
		const { newAsset } = await import(domainPath);
		const { save } = await import(repositoryPath);
		await save("asset", { ...newAsset("account"), name: "Phone for tests", category: "phone" });
		await save("asset", { ...newAsset("project"), name: "Project for tests" });
	}, [domainUrl, repositoryUrl]);
	await page.goto("/change-impact");
	await expect(page.getByRole("button", { name: /Change phone number/ })).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".change-impact-snapshot strong")).toHaveText("Phone for tests");
	await page.getByRole("button", { name: /Update project profile/ }).click();
	await expect(page.locator(".change-impact-snapshot strong")).toHaveText("Project for tests");
	await expect(page.getByText("01 Review impact")).toBeVisible();
	await expect(page.getByText("02 Act and record")).toBeVisible();
	await expect(page.getByText("03 Review record")).toBeVisible();
	await page.getByRole("link", { name: "Create action plan" }).click();
	await expect(page.getByRole("heading", { name: "Review profile change impact" })).toBeVisible();
	await page.goto("/change-impact");
	await page.getByRole("button", { name: /Close and hand over/ }).click();
	await page.getByRole("link", { name: "Create action plan" }).click();
	await expect(page.getByRole("heading", { name: "Close or hand over project" })).toBeVisible();
	await page.goto("/change-impact");
	await page.getByRole("link", { name: "Open account checklist" }).click();
	await expect(page.getByRole("heading", { name: "Phone for tests" })).toBeVisible();
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
});
