import { openProjectDetails } from "./helpers/project-details";
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const evidenceDir = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/evidence/2026-09-29";

type Copy = {
	language: "zh-CN" | "en";
	add: string;
	name: string;
	save: string;
	addRelation: string;
	target: string;
	label: string;
	deleteRelation: string;
	cancel: string;
	restore: string;
	error: string;
};

const copies: Copy[] = [
	{
		language: "zh-CN",
		add: "新增",
		name: "名称",
		save: "保存",
		addRelation: "添加关联",
		target: "关联至",
		label: "关联用途",
		deleteRelation: "删除关系",
		cancel: "取消",
		restore: "恢复",
		error: "操作未完成，请重试。",
	},
	{
		language: "en",
		add: "Add",
		name: "Name",
		save: "Save",
		addRelation: "Add connection",
		target: "Connect to",
		label: "Connection label",
		deleteRelation: "Delete connection",
		cancel: "Cancel",
		restore: "Restore",
		error: "Could not finish. Please try again.",
	},
];

async function relations(page: Page) {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).list("relation", true)) as {
			id: string;
			label: string;
			deleted: boolean;
		}[];
	}, repositoryModuleUrl);
}

async function addAsset(
	page: Page,
	copy: Copy,
	kind: "project" | "account",
	name: string,
) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog.getByRole("button", { name: copy.save }).click();
	await expect(dialog).toBeHidden();
}

async function addRelation(
	page: Page,
	copy: Copy,
	target: string,
	label: string,
) {
	await openProjectDetails(page);
	await page.getByRole("button", { name: copy.addRelation }).click();
	const dialog = page.getByRole("dialog");
	await selectChoice(dialog.getByLabel(copy.target), { label: target });
	await dialog.getByLabel(copy.label).fill(label);
	await dialog.getByRole("button", { name: copy.save }).click();
	await expect(dialog).toBeHidden();
}

for (const copy of copies) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${copy.language} ${width}px relation delete confirms only target and restores`, async ({
			browser,
		}, testInfo) => {
			test.setTimeout(90_000);
			mkdirSync(evidenceDir, { recursive: true });
			const context = await browser.newContext({
				viewport: { width, height: 844 },
				locale: copy.language === "en" ? "en-US" : "zh-CN",
			});
			await context.addInitScript(
				(language) => localStorage.setItem("keepany-language", language),
				copy.language,
			);
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.on("pageerror", (error) => pageErrors.push(error.message));
			const suffix = crypto.randomUUID().slice(0, 8);
			const project = `Project ${suffix}`;
			const longAccount = `Account${"A".repeat(145)}`;
			const otherAccount = `Other ${suffix}`;
			const longLabel = `L${"x".repeat(94)}`;
			const otherLabel = `other ${suffix}`;
			try {
				await addAsset(page, copy, "project", project);
				await addAsset(page, copy, "account", longAccount);
				await addAsset(page, copy, "account", otherAccount);
				await page.goto("/assets/project");
				await page.getByText(project, { exact: true }).first().click();
				await addRelation(page, copy, longAccount, longLabel);
				await addRelation(page, copy, otherAccount, otherLabel);
				const before = await relations(page);
				const target = before.find((row) => row.label === longLabel);
				const survivor = before.find((row) => row.label === otherLabel);
				expect(target).toBeTruthy();
				expect(survivor).toBeTruthy();
				const trigger = page.getByRole("button", {
					name: `${copy.deleteRelation} · ${longLabel} · ${longAccount}`,
				});
				await trigger.click();
				const dialog = page.getByRole("dialog", { name: copy.deleteRelation });
				await expect(dialog).toContainText(longLabel);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				expect(
					await dialog.evaluate((element) => element.scrollWidth),
				).toBeLessThanOrEqual(
					await dialog.evaluate((element) => element.clientWidth + 1),
				);
				await expect(
					dialog.getByRole("button", { name: copy.cancel }),
				).toBeInViewport({ ratio: 1 });
				await expect(
					dialog.getByRole("button", { name: copy.deleteRelation }),
				).toBeInViewport({ ratio: 1 });
				await expect
					.poll(() =>
						page.evaluate(() =>
							Boolean(document.activeElement?.closest('[role="dialog"]')),
						),
					)
					.toBe(true);
				for (let index = 0; index < 5; index++) {
					await page.keyboard.press("Tab");
					expect(
						await page.evaluate(() =>
							Boolean(document.activeElement?.closest('[role="dialog"]')),
						),
					).toBe(true);
				}
				const shot = `${evidenceDir}/relation-delete-${copy.language}-${width}.png`;
				await testInfo.attach(`${copy.language}-${width}-relation-delete`, {
					body: await page.screenshot({ path: shot }),
					contentType: "image/png",
				});
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				expect(
					(await relations(page)).find((row) => row.id === target?.id)?.deleted,
				).toBe(false);
				await trigger.click();
				await dialog.getByRole("button", { name: copy.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				expect(
					(await relations(page)).find((row) => row.id === target?.id)?.deleted,
				).toBe(false);
				await trigger.click();
				await dialog.getByRole("button", { name: copy.deleteRelation }).click();
				await expect(dialog).toBeHidden();
				await expect(trigger).toHaveCount(0);
				await page.reload();
				const after = await relations(page);
				expect(after.find((row) => row.id === target?.id)?.deleted).toBe(true);
				expect(after.find((row) => row.id === survivor?.id)?.deleted).toBe(
					false,
				);
				await expect(page.locator(".relation-row")).toHaveCount(1);
				await page.goto("/trash");
				const trash = page
					.locator(".relation-row")
					.filter({ hasText: longLabel });
				await expect(trash).toBeVisible();
				await trash.getByRole("button", { name: copy.restore }).click();
				await expect(trash).toHaveCount(0);
				await page.goto("/assets/project");
				await page.getByText(project, { exact: true }).first().click();
				await expect(page.locator(".relation-row")).toHaveCount(2);
				expect(
					(await relations(page)).find((row) => row.id === target?.id)?.deleted,
				).toBe(false);
				expect(pageErrors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}

	test(`${copy.language} relation delete error remains in dialog and can close`, async ({
		browser,
	}, testInfo) => {
		test.setTimeout(60_000);
		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			locale: copy.language === "en" ? "en-US" : "zh-CN",
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			copy.language,
		);
		const page = await context.newPage();
		const suffix = crypto.randomUUID().slice(0, 8);
		const project = `Project ${suffix}`;
		const account = `Account ${suffix}`;
		const label = `remove ${suffix}`;
		try {
			await addAsset(page, copy, "project", project);
			await addAsset(page, copy, "account", account);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await addRelation(page, copy, account, label);
			await page
				.getByRole("button", {
					name: `${copy.deleteRelation} · ${label} · ${account}`,
				})
				.click();
			const dialog = page.getByRole("dialog", { name: copy.deleteRelation });
			const relation = (await relations(page)).find(
				(row) => row.label === label,
			);
			if (!relation) throw new Error("created relation missing");
			await page.evaluate(
				async ({ modulePath, id }) => {
					const { localRepository } = await import(modulePath);
					const repository = await localRepository();
					await (
						await repository.db.records.findOne(`relation:${id}`).exec()
					)?.remove();
				},
				{ modulePath: repositoryModuleUrl, id: relation.id },
			);
			await dialog.getByRole("button", { name: copy.deleteRelation }).click();
			await expect(dialog.getByRole("alert")).toHaveText(copy.error);
			await expect(dialog).toBeVisible();
			mkdirSync(evidenceDir, { recursive: true });
			await testInfo.attach(`${copy.language}-relation-delete-error`, {
				body: await page.screenshot({
					path: `${evidenceDir}/relation-delete-${copy.language}-error.png`,
				}),
				contentType: "image/png",
			});
			await dialog.getByRole("button", { name: copy.cancel }).click();
			await expect(dialog).toBeHidden();
		} finally {
			await context.close();
		}
	});
}

for (const [index, width] of [390, 1280].entries()) {
	const copy = copies[index];
	test(`${copy.language} production-safe relation delete dialog at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport: { width, height: 844 },
			locale: copy.language === "en" ? "en-US" : "zh-CN",
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			copy.language,
		);
		const page = await context.newPage();
		const suffix = crypto.randomUUID().slice(0, 8);
		const project = `Preview project ${suffix}`;
		const account = `Preview account ${suffix}`;
		const label = `Preview relation ${suffix}`;
		try {
			await addAsset(page, copy, "project", project);
			await addAsset(page, copy, "account", account);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await addRelation(page, copy, account, label);
			const trigger = page.getByRole("button", {
				name: `${copy.deleteRelation} · ${label} · ${account}`,
			});
			await trigger.click();
			const dialog = page.getByRole("dialog", { name: copy.deleteRelation });
			await dialog.getByRole("button", { name: copy.cancel }).click();
			await expect(trigger).toBeFocused();
			await page.reload();
			await expect(trigger).toBeVisible();
			await trigger.click();
			await dialog.getByRole("button", { name: copy.deleteRelation }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await expect(
				page.locator(".relation-row").filter({ hasText: label }),
			).toHaveCount(0);
			await page.goto("/trash");
			const trash = page.locator(".relation-row").filter({ hasText: label });
			await expect(trash).toBeVisible();
			await trash.getByRole("button", { name: copy.restore }).click();
			await expect(trash).toHaveCount(0);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await expect(
				page.locator(".relation-row").filter({ hasText: label }),
			).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
		} finally {
			await context.close();
		}
	});
}
