// 2026-10-29: user removed B1 backlinks and B2 promotional fields/materials.
// Prior expectations/evidence remain in Git and the private pre-change snapshot; retained core checks are unchanged.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";

const repositoryPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;
const domainPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/T10-retained-core";
mkdirSync(evidence, { recursive: true });

async function readAsset(page: Page, id: string) {
	return page.evaluate(async ({ repositoryPath, id }) => (await (await import(repositoryPath)).localRepository()).get("asset", id), { repositoryPath, id });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`T10-01..04 ${locale} ${width}px project profiles, domain ownership and editing preservation`, async ({ browser }) => {
		test.setTimeout(150_000);
		const context = await browser.newContext({ locale: locale === "en" ? "en-US" : locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
			await page.goto("/assets");
			await page.getByRole("button", { name: t("workspaceAddAsset"), exact: true }).click();
			await selectChoice(page.locator("#workspace-create-kind"), "project");
			await page.getByRole("dialog").getByRole("button", { name: t("workspaceContinue"), exact: true }).click();
			let editor = page.getByRole("dialog");
			await editor.locator("#name").fill("T10 Project");
			await editor.locator("#url").fill("https://t10.example.test");
			await editor.locator("#description").fill("T10 short description");
			await editor.locator("#tags").fill("alpha, beta");
			await editor.locator("#notes").fill("T10 preserved notes");
			await editor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(editor).toBeHidden();
			await page.reload();
			await expect(page.locator(".asset-project-card").filter({ hasText: "T10 Project" })).toBeVisible();
			const project = await page.evaluate(async (path) => (await (await import(path)).localRepository()).list("asset").then((rows: { name: string }[]) => rows.find((row) => row.name === "T10 Project")), repositoryPath);
			expect(project).toMatchObject({ kind: "project", url: "https://t10.example.test", description: "T10 short description", tags: ["alpha", "beta"], notes: "T10 preserved notes" });
			await page.locator(".asset-project-card").filter({ hasText: "T10 Project" }).click();
			await expect(page.locator(".asset-project-profile-card")).toContainText("t10.example.test");

			// Independent existing project makes an incorrect domain association observable.
			const otherId = await page.evaluate(async ({ repositoryPath, domainPath }) => {
				const other = { ...(await import(domainPath)).newAsset("project"), name: "Other domain owner" };
				await (await import(repositoryPath)).save("asset", other);
				return other.id as string;
			}, { repositoryPath, domainPath });
			await page.goto("/assets/domains");
			await page.getByRole("button", { name: t("workspaceAddAsset"), exact: true }).click();
			await selectChoice(page.locator("#workspace-domain-project"), project.id);
			await page.getByRole("dialog").getByRole("button", { name: t("workspaceManageDomain"), exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/project/${project.id}#project-domains$`));
			for (const [name, fee] of [["one.t10.test", "12.34"], ["two.t10.test", "50.00"], ["unknown.t10.test", ""]]) {
				await page.getByRole("button", { name: t("projectAddDomain"), exact: true }).click();
				const dialog = page.getByRole("dialog");
				await dialog.getByLabel(t("projectDomain"), { exact: true }).fill(name);
				await dialog.getByLabel(t("projectRegistrar")).fill("T10 Registrar");
				await dialog.getByLabel(t("projectExpiry")).fill("2026-11-18");
				await selectChoice(dialog.getByRole("combobox", { name: t("currency"), exact: true }), "USD");
				await dialog.getByLabel(t("projectAnnualFee")).fill(fee);
				await dialog.getByRole("button", { name: t("save"), exact: true }).click();
				await expect(dialog).toBeHidden();
				await expect(page.locator(".asset-project-domain-row").filter({ hasText: name })).toBeVisible();
			}
			await page.reload();
			const domainsBefore = (await readAsset(page, project.id)).projectDomains;
			expect(domainsBefore).toHaveLength(3);
			expect((await readAsset(page, otherId)).projectDomains).toEqual([]);
			await page.goto("/assets");
			await expect(page.locator(".workspace-domain-card")).toHaveCount(3);
			await page.locator(".workspace-domain-card").filter({ hasText: "one.t10.test" }).click();
			await expect(page).toHaveURL(new RegExp(`#project-domain-${domainsBefore[0].id}$`));
			const targetRow = page.locator(`#project-domain-${domainsBefore[0].id}`);
			await expect(targetRow).toBeInViewport();
			await targetRow.getByRole("button", { name: t("edit"), exact: true }).click();
			const domainEditor = page.getByRole("dialog");
			await domainEditor.getByLabel(t("projectRegistrar")).fill("Updated Registrar");
			await domainEditor.getByLabel(t("projectExpiry")).fill("2026-10-29");
			await selectChoice(domainEditor.getByRole("combobox", { name: t("currency"), exact: true }), "EUR");
			await domainEditor.getByLabel(t("projectAnnualFee")).fill("23.45");
			await domainEditor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(domainEditor).toBeHidden();
			await page.reload();
			const domainsAfter = (await readAsset(page, project.id)).projectDomains;
			expect(domainsAfter[0]).toMatchObject({ id: domainsBefore[0].id, name: "one.t10.test", registrar: "Updated Registrar", expiryDate: "2026-10-29", annualAmount: 2345, currency: "EUR" });
			expect(domainsAfter.slice(1)).toEqual(domainsBefore.slice(1));
			await page.goto("/assets");
			const targetCard = page.locator(".workspace-domain-card").filter({ hasText: "one.t10.test" });
			await expect(targetCard).toContainText(locale === "en" ? "2 days left" : "剩余 2 天");
			await expect(targetCard).toContainText("23.45");
			await expect(targetCard).toContainText("Updated Registrar");
			await expect(page.locator(".workspace-domain-card").filter({ hasText: "unknown.t10.test" })).toContainText(t("workspaceAmountMissing"));
			await expect(page.locator(".workspace-domain-card").filter({ hasText: "unknown.t10.test" })).not.toContainText("0.00");

			const fixtureIds = await page.evaluate(async ({ repositoryPath, domainPath, id }) => {
				const { newAsset, relationSchema } = await import(domainPath);
				const { localRepository, save, saveBatch } = await import(repositoryPath);
				const project = await (await localRepository()).get("asset", id);
				const account = { ...newAsset("account"), name: "T10 linked account", username: "linked@example.test" };
				const subscription = { ...newAsset("subscription"), name: "T10 linked subscription", amount: 1200, currency: "USD" };
				const relations = [account, subscription].map((asset) => relationSchema.parse({ id: crypto.randomUUID(), from: id, to: asset.id, label: "T10 relation", createdAt: project.createdAt }));
				await save("asset", { ...project, contact: "Hidden contact retained", location: "Hidden location retained" });
				await saveBatch([{ type: "asset", value: account }, { type: "asset", value: subscription }, ...relations.map((value) => ({ type: "relation", value }))]);
				return { account: account.id, subscription: subscription.id, relations };
			}, { repositoryPath, domainPath, id: project.id });
			await page.goto(`/assets/project/${project.id}`);
			await expect(page.locator(".asset-project-profile-card")).toContainText("T10 linked account");
			await expect(page.locator(".asset-project-profile-card")).toContainText("T10 linked subscription");
			const beforeEdit = await readAsset(page, project.id);
			await page.locator(".asset-project-action-bar").getByRole("button", { name: t("edit"), exact: true }).click();
			editor = page.getByRole("dialog");
			await editor.locator("#name").fill("Cancelled T10 name");
			await editor.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(editor).toBeHidden();
			expect(await readAsset(page, project.id)).toEqual(beforeEdit);
			await page.reload();
			await expect(page.getByRole("heading", { name: "T10 Project", exact: true })).toBeVisible();
			await page.locator(".asset-project-action-bar").getByRole("button", { name: t("edit"), exact: true }).click();
			editor = page.getByRole("dialog");
			await editor.locator("#name").fill("T10 Project renamed");
			await editor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(editor).toBeHidden();
			await page.reload();
			await expect(page.getByRole("heading", { name: "T10 Project renamed", exact: true })).toBeVisible();
			const renamed = await readAsset(page, project.id);
			const { name: oldName, updatedAt: oldUpdatedAt, ...retainedBefore } = beforeEdit;
			const { name: newName, updatedAt: newUpdatedAt, ...retainedAfter } = renamed;
			expect(newName).toBe("T10 Project renamed");
			expect(retainedAfter).toEqual(retainedBefore);
			const relationsAfter = await page.evaluate(async (path) => (await (await import(path)).localRepository()).list("relation"), repositoryPath);
			expect(relationsAfter.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)))
				.toEqual(fixtureIds.relations.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)));
			await expect(page.locator(".asset-project-related-card")).toHaveCount(2);
			await expect(page.locator(".asset-project-related-card").filter({ hasText: "T10 linked account" })).toHaveAttribute("href", `/assets/account/${fixtureIds.account}`);
			await expect(page.locator(".asset-project-related-card").filter({ hasText: "T10 linked subscription" })).toHaveAttribute("href", `/assets/subscription/${fixtureIds.subscription}`);
			await expect(page.locator(".asset-project-domain-row")).toHaveCount(3);
			await page.goto("/assets");
			await expect(page.locator(".asset-project-card").filter({ hasText: "T10 Project renamed" })).toBeVisible();
			await expect(targetCard).toContainText("T10 Project renamed");
			for (const card of await page.locator(".asset-project-card").all()) {
				const cover = await card.locator(".asset-project-cover").boundingBox();
				const preview = await card.locator(".asset-browser-body").boundingBox();
				if (cover && preview) expect(preview.y + preview.height).toBeLessThanOrEqual(cover.y + cover.height);
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T10-${locale}-${width}.png`), fullPage: true });
			expect(errors).toEqual([]);
			await test.info().attach("T10-readback", { body: JSON.stringify({ projectId: project.id, domainsBefore, domainsAfter, preserved: retainedAfter, relations: relationsAfter }, null, 2), contentType: "application/json" });
		} finally { await context.close(); }
	});
}
