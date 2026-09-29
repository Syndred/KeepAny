import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

test("all three impact scenarios save and reopen their work on the same page", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
	const { firstProjectId, secondProjectId } = await page.evaluate(
		async ([domainPath, repositoryPath]) => {
			const { newAsset } = await import(domainPath);
			const { saveBatch } = await import(repositoryPath);
			const phone = {
				...newAsset("account"),
				name: "Phone for tests",
				category: "phone",
			};
			const firstProject = {
				...newAsset("project"),
				name: "Project for tests",
			};
			const secondProject = { ...newAsset("project"), name: "Second project" };
			const relation = {
				id: crypto.randomUUID(),
				from: phone.id,
				to: firstProject.id,
				label: "owner",
				createdAt: new Date().toISOString(),
				verifiedAt: "",
				deleted: false,
			};
			await saveBatch([
				{ type: "asset", value: phone },
				{ type: "asset", value: firstProject },
				{ type: "asset", value: secondProject },
				{ type: "relation", value: relation },
			]);
			return {
				firstProjectId: firstProject.id,
				secondProjectId: secondProject.id,
			};
		},
		[domainUrl, repositoryUrl],
	);
	await page.goto("/change-impact");
	await expect(
		page.getByRole("button", { name: /Change phone number/ }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator(".change-impact-snapshot strong")).toHaveText(
		"Phone for tests",
	);
	await page.getByRole("button", { name: /Create checklist/ }).click();
	await expect(page.locator(".impact-task-row")).toHaveCount(1);
	await page
		.locator(".impact-task-row")
		.getByRole("button", { name: /Complete/ })
		.click();
	await expect(page.locator(".impact-task-row .chip")).toHaveText("Completed");
	await page.reload();
	await expect(page.locator(".impact-task-row .chip")).toHaveText("Completed");
	await expect(page).toHaveURL(/\/change-impact$/);

	await page.getByRole("button", { name: /Update project profile/ }).click();
	await expect(page.getByLabel("Choose project")).toHaveValue(firstProjectId);
	await page.getByLabel("Choose project").selectOption(secondProjectId);
	await expect(page.locator(".project-workflow-hero")).toContainText(
		"Second project",
	);
	await page.getByLabel("Choose project").selectOption(firstProjectId);
	await expect(
		page.getByRole("heading", { name: "Review profile change impact" }),
	).toBeVisible();
	await page.getByLabel("Other change details").fill("Refresh product listing");
	await page.getByRole("button", { name: "Create action plan" }).click();
	await expect(page.locator(".project-workflow-task")).not.toHaveCount(0);
	await expect(page).toHaveURL(/\/change-impact$/);
	await page
		.locator(".project-workflow-task")
		.first()
		.getByRole("button", { name: "Record result" })
		.click();
	await page
		.locator(".project-workflow-task")
		.first()
		.getByLabel("Evidence or note")
		.fill("Reviewed local project profile");
	await page
		.locator(".project-workflow-task")
		.first()
		.getByRole("button", { name: "Save result" })
		.click();
	await page.getByRole("button", { name: "Review records" }).click();
	await expect(page.locator(".project-workflow-report")).toContainText(
		"Reviewed local project profile",
	);
	await page.reload();
	await page.getByRole("button", { name: /Update project profile/ }).click();
	await expect(page.locator(".project-workflow-task")).not.toHaveCount(0);
	await expect(page).toHaveURL(/\/change-impact$/);

	await page.getByRole("button", { name: /Close and hand over/ }).click();
	await expect(
		page.getByRole("heading", { name: "Close or hand over project" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Create action plan" }).click();
	await expect(page.locator(".project-workflow-task")).not.toHaveCount(0);
	await expect(page).toHaveURL(/\/change-impact$/);
	await page.getByRole("button", { name: "Review records" }).click();
	await expect(page.locator(".project-workflow-report")).toContainText(
		"This record does not confirm completion",
	);
	await page.getByRole("button", { name: "Back to actions" }).click();
	await expect(
		page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).resolves.toBe(true);
	await expect(page.locator(".toast")).toHaveCount(0);
	mkdirSync("docs/evidence/2026-09-29", { recursive: true });
	await page.screenshot({
		path: "docs/evidence/2026-09-29/change-impact-en-390.png",
		fullPage: true,
	});
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	await page.goto("/change-impact");
	await page.getByRole("button", { name: /更新站点资料/ }).click();
	await expect(
		page.getByRole("heading", { name: "检查资料更新影响" }),
	).toBeVisible();
	await expect(page.locator(".toast")).toHaveCount(0);
	await page.screenshot({
		path: "docs/evidence/2026-09-29/change-impact-zh-390.png",
		fullPage: true,
	});
	await expect(
		page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth + 1,
		),
	).resolves.toBe(true);
});
