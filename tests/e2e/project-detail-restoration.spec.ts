import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const evidenceDirectory = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp";
mkdirSync(evidenceDirectory, { recursive: true });

async function projectFixture(page: Page, submissionName: string) {
	return page.evaluate(async ({ domainModuleUrl, repositoryModuleUrl, submissionName }) => {
		const { newAsset, relationSchema, submissionSchema } = await import(domainModuleUrl);
		const { saveBatch } = await import(repositoryModuleUrl);
		const project = {
			...newAsset("project"), name: "Mori Notes", category: "website",
			url: "https://example.com", description: "A quiet place for ideas",
		};
		const account = { ...newAsset("account"), name: "Studio Mail", category: "email", username: "hello@example.com" };
		const hosting = {
			...newAsset("subscription"), name: "Cloud hosting", category: "service",
			amount: 9800, currency: "CNY" as const, dueDate: "2026-10-22",
		};
		const createdAt = new Date().toISOString();
		const relations = [
			relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: account.id, label: "Contact email", createdAt }),
			relationSchema.parse({ id: crypto.randomUUID(), from: hosting.id, to: project.id, label: "Hosting", createdAt }),
		];
		const submission = submissionSchema.parse({
			id: crypto.randomUUID(), assetId: project.id, name: submissionName,
			url: "https://directory.example/project", status: "verify", submittedAt: "2026-09-20",
			verifiedAt: "", evidence: "https://directory.example/project", deleted: false,
		});
		await saveBatch([
			...[project, account, hosting].map(value => ({ type: "asset" as const, value })),
			...relations.map(value => ({ type: "relation" as const, value })),
			{ type: "submission", value: submission },
		]);
		return project.id as string;
	}, { domainModuleUrl, repositoryModuleUrl, submissionName });
}

for (const width of [360, 390, 1280]) {
	test(`project detail uses recorded relationships, domain costs and collapsible materials at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 850 });
		await page.goto("/");
		await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
		const projectId = await projectFixture(page, "Directory record");
		await page.goto(`/assets/project/${projectId}`);
		await expect(page.getByRole("heading", { name: "Mori Notes", exact: true })).toBeVisible();
		await expect(page.locator(".asset-project-action-bar")).toBeVisible();
		await expect(page.locator(".asset-project-profile-card")).toContainText("Studio Mail");
		await expect(page.locator(".asset-project-profile-card")).toContainText("Cloud hosting");
		await expect(page.locator(".asset-project-reminders")).toContainText("Backlinks to verify: 1");
		await expect(page.locator(".asset-project-costs")).toContainText("Cloud hosting");
		await page.locator(".asset-project-action-bar").getByRole("button", { name: "Edit" }).click();
		const editor = page.getByRole("dialog");
		await editor.getByLabel("Launch month").fill("2025-11");
		await editor.getByLabel("Next inspection").fill("2026-10-05");
		await editor.getByRole("button", { name: "Save" }).click();
		await expect(editor).toBeHidden();
		await expect(page.locator(".asset-project-profile-card")).toContainText("November 2025");
		await expect(page.locator(".asset-project-reminders")).toContainText("Oct 5, 2026");
		await expect(page.locator(".asset-project-materials")).not.toHaveAttribute("open", "");
		await page.getByRole("button", { name: "View submission materials" }).click();
		await expect(page.locator(".asset-project-materials")).toHaveAttribute("open", "");
		await expect(page.locator(".asset-project-materials")).toContainText("A quiet place for ideas");
		await page.getByRole("button", { name: "View backlinks", exact: true }).click();
		await expect(page.locator(".asset-backlinks-card")).toHaveAttribute("open", "");
		await expect(page.locator(".asset-backlinks-card")).toContainText("Directory record");
		await page.locator(".asset-project-costs").getByRole("button", { name: "Add domain" }).click();
		const domain = page.getByRole("dialog");
		await domain.getByLabel("Domain", { exact: true }).fill("mori-notes.com");
		await domain.getByLabel("Registrar").fill("Example Registrar");
		await domain.getByLabel("Expiry date").fill("2027-10-01");
		await domain.getByLabel("Annual fee").fill("120.00");
		await page.screenshot({ path: test.info().outputPath(`domain-dialog-en-${width}.png`), fullPage: true });
		await domain.getByRole("button", { name: "Save" }).click();
		await expect(domain).toBeHidden();
		await expect(page.locator(".asset-project-costs")).toContainText("mori-notes.com");
		await expect(page.locator(".asset-project-costs")).toContainText("1,296.00");
		await page.reload();
		await expect(page.locator(".asset-project-costs")).toContainText("mori-notes.com");
		await expect(page.locator(".asset-project-costs")).toContainText("1,296.00");
		await expect(page.locator(".asset-project-profile-card")).toContainText("Studio Mail");
		await expect(page.locator(".asset-project-profile-card")).toContainText("Cloud hosting");
		await expect(page.locator(".asset-project-profile-card")).toContainText("November 2025");
		await expect(page.locator(".asset-project-reminders")).toContainText("Oct 5, 2026");
		await expect(page.locator(".asset-project-costs")).toContainText("2027");
		await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
		await page.screenshot({ path: join(evidenceDirectory, `keepany-project-detail-restored-${width}.png`), fullPage: true });
		await page.locator(".asset-project-domain-row").getByRole("button", { name: "Edit" }).click();
		await domain.getByLabel("Annual fee").fill("130.00");
		await selectChoice(domain.getByLabel("Auto renew"), "on");
		await domain.getByRole("button", { name: "Save" }).click();
		await expect(page.locator(".asset-project-costs")).toContainText("1,306.00");
		await page.locator(".asset-project-domain-row").getByRole("button", { name: "Edit" }).click();
		await domain.getByRole("button", { name: "Delete domain" }).click();
		await expect(domain).toBeHidden();
		await expect(page.locator(".asset-project-costs")).toContainText("No domains recorded");
		await expect(page.locator(".asset-project-costs")).toContainText("1,176.00");
	});
}

test("project detail labels and recorded relationships render in Chinese at 390px", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 850 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	const projectId = await projectFixture(page, "目录记录");
	await page.goto(`/assets/project/${projectId}`);
	await expect(page.locator(".topbar-back-link")).toContainText("返回列表");
	await expect(page.locator(".asset-project-profile-card")).toContainText("官方地址");
	await expect(page.locator(".asset-project-profile-card")).toContainText("Studio Mail");
	await expect(page.locator(".asset-project-reminders")).toContainText("1 条需要核验");
	await expect(page.locator(".asset-project-costs")).toContainText("域名与持有成本");
	await page.getByRole("button", { name: "添加域名" }).click();
	const domain = page.getByRole("dialog");
	await domain.getByLabel("域名", { exact: true }).fill("example.test");
	await domain.getByLabel("注册商").fill("Example Registrar");
	await domain.getByLabel("到期日").fill("2027-10-01");
	await domain.getByLabel("年费").fill("120.00");
	await page.screenshot({ path: test.info().outputPath("domain-dialog-zh-CN-390.png"), fullPage: true });
	await domain.getByRole("button", { name: "保存", exact: true }).click();
	await expect(domain).toBeHidden();
	await page.reload();
	await expect(page.locator(".asset-project-domain-row")).toContainText("example.test");
	await page.getByRole("button", { name: "查看投递素材" }).click();
	await expect(page.locator(".asset-project-materials")).toHaveAttribute("open", "");
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
	await page.screenshot({ path: join(evidenceDirectory, "keepany-project-detail-restored-zh-CN-390.png"), fullPage: true });
});
