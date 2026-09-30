import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Asset, Category } from "../../packages/domain/src";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
type Kind = "project" | "account";
const copy = (locale: string) =>
	locale === "zh-CN"
		? {
				category: "分类",
				name: "分类名称",
				add: "新增分类",
				manage: "管理",
				save: "保存分类",
				collapse: "收起",
				remove: "移除",
				edit: "编辑",
				restore: "恢复",
				backup: "创建备份",
				download: "保存备份文件",
				preview: "预览",
				confirm: /确认 ·/,
				restored: /已恢复 \d+ 条记录/,
				duplicate: "该分类已存在。",
				stale: "资料已变化，请收起后重新编辑。",
			}
		: {
				category: "Category",
				name: "Category name",
				add: "New category",
				manage: "Manage",
				save: "Save collection",
				collapse: "Collapse",
				remove: "Remove",
				edit: "Edit",
				restore: "Restore",
				backup: "Create backup",
				download: "Save backup file",
				preview: "Preview",
				confirm: /Confirm ·/,
				restored: /Restored \d+ records/,
				duplicate: "This category already exists.",
				stale: "Records changed. Close this editor and open it again.",
			};

async function fixture(page: Page, kind: Kind, category: string) {
	return page.evaluate(
		async ({ repositoryPath, domainPath, kind, category }) => {
			const { newAsset } = await import(domainPath);
			const { saveBatch } = await import(repositoryPath);
			const assets = ["Keep", "Remove", "Add", "Recover"].map(
				(role, index) => ({
					...newAsset(kind),
					name: `${kind} ${role}`,
					category: index === 3 ? category : "",
					deleted: index === 3,
				}),
			);
			await saveBatch(
				assets.map((value) => ({ type: "asset" as const, value })),
			);
			return assets.map((asset) => asset.id) as string[];
		},
		{ repositoryPath, domainPath, kind, category },
	);
}
async function state(page: Page, kind: Kind) {
	return page.evaluate(
		async ({ repositoryPath, kind }) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			return {
				categories: (
					(await repository.list("category", true)) as Category[]
				).filter((category) => category.kind === kind),
				assets: ((await repository.list("asset", true)) as Asset[]).filter(
					(asset) => asset.kind === kind,
				),
			};
		},
		{ repositoryPath, kind },
	);
}
async function createCategoryUi(
	page: Page,
	locale: string,
	name: string,
	members: string[] = [],
) {
	const text = copy(locale);
	await page.getByRole("button", { name: text.add, exact: true }).click();
	const editor = page.getByRole("region", { name: text.category, exact: true });
	await editor.getByLabel(text.name, { exact: true }).fill(name);
	for (const member of members)
		await editor.getByRole("checkbox", { name: member, exact: true }).check();
	await editor.getByRole("button", { name: text.save, exact: true }).click();
	await expect(editor).toBeHidden();
}
async function sidebarCategory(page: Page, name: string) {
	const backToList = page
		.getByRole("banner")
		.getByRole("link", { name: /^(Back to list|返回列表)$/ });
	if ((await backToList.count()) > 0) {
		await backToList.click();
		await expect(page).toHaveURL(/\/assets\/(?:project|account)\/?$/);
	}
	await expect(page.locator(".asset-category-scroll")).toBeVisible();
	const mainCategory = page
		.getByRole("main")
		.getByRole("button", { name, exact: true });
	await expect(mainCategory).toBeVisible();
	await mainCategory.click();
}
async function fits(page: Page) {
	await expect(page.locator(".mobile-scrim")).toBeHidden();
	if ((page.viewportSize()?.width ?? 0) <= 760) {
		await expect
			.poll(() =>
				page
					.locator(".sidebar")
					.evaluate((sidebar) => sidebar.getBoundingClientRect().right),
			)
			.toBeLessThanOrEqual(0);
	}
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	for (const button of await page
		.locator(
			".asset-category-inline > .actions button, .asset-category-recovery button",
		)
		.all()) {
		const box = await button.boundingBox();
		expect(box).not.toBeNull();
		if (box)
			expect(
				box.x >= 0 &&
					box.x + box.width <= (page.viewportSize()?.width ?? 0) + 1,
			).toBe(true);
	}
}

for (const locale of ["en", "zh-CN"] as const) {
	for (const width of [390, 1280]) {
		test(`${locale} custom project and account category edits retain identity and backup at ${width}px`, async ({
			browser,
		}) => {
			const context = await browser.newContext({
				viewport: { width, height: 844 },
				locale: locale === "en" ? "en-US" : locale,
				acceptDownloads: true,
			});
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const text = copy(locale);
			const categoryIds: Partial<Record<Kind, string>> = {};
			try {
				await page.goto("/");
				await page.evaluate(
					(language) => localStorage.setItem("keepany-language", language),
					locale,
				);
				for (const kind of ["project", "account"] as const) {
					const before = `Studio ${kind}`;
					const after = `Archive ${kind}`;
					await page.goto(`/assets/${kind}`);
					const ids = await fixture(page, kind, before);
					await expect(page.locator("main .asset-list-content a")).toHaveCount(
						3,
					);
					await createCategoryUi(page, locale, before, [
						`${kind} Keep`,
						`${kind} Remove`,
					]);
					await expect(page.locator("main .asset-list-content a")).toHaveCount(
						2,
					);
					const original = (await state(page, kind)).categories[0];
					categoryIds[kind] = original.id;
					await page
						.getByRole("button", { name: text.manage, exact: true })
						.click();
					const editor = page.getByRole("region", {
						name: text.category,
						exact: true,
					});
					await expect(editor.getByLabel(text.name)).toHaveValue(before);
					await expect(editor.getByRole("checkbox")).toHaveCount(3);
					// Both translations of built-in names are reserved, even in the other language.
					await editor
						.getByLabel(text.name)
						.fill(
							kind === "project"
								? locale === "en"
									? "网站"
									: "Websites"
								: locale === "en"
									? "邮箱"
									: "Email",
						);
					await editor
						.getByRole("button", { name: text.save, exact: true })
						.click();
					await expect(editor.getByRole("alert")).toHaveText(text.duplicate);
					await editor.getByLabel(text.name).fill(after);
					await editor
						.getByRole("checkbox", { name: `${kind} Remove`, exact: true })
						.uncheck();
					await editor
						.getByRole("checkbox", { name: `${kind} Add`, exact: true })
						.check();
					await fits(page);
					if (kind === "project") {
						await expect(page.locator(".toast")).toBeHidden();
						await page.screenshot({
							path: join(
								tmpdir(),
								`keepany-category-edit-${locale}-${width}.png`,
							),
							fullPage: true,
						});
					}
					await editor
						.getByRole("button", { name: text.save, exact: true })
						.click();
					await expect(editor).toBeHidden();
					await expect(
						page
							.locator(".asset-category-scroll")
							.getByRole("button", { name: after, exact: true }),
					).toHaveAttribute("aria-pressed", "true");
					await expect(page.locator("main .asset-list-content a")).toHaveCount(
						2,
					);
					const saved = await state(page, kind);
					expect(saved.categories).toHaveLength(1);
					expect(saved.categories[0]).toMatchObject({
						id: original.id,
						name: after,
					});
					expect(
						saved.assets.find((asset) => asset.id === ids[1])?.category,
					).toBe("");
					expect(
						saved.assets.find((asset) => asset.id === ids[3]),
					).toMatchObject({ deleted: true, category: after });
					await page
						.locator("main .asset-list-content a")
						.filter({ hasText: `${kind} Keep` })
						.click();
					await expect(
						page.getByRole("main").getByText(after, { exact: true }).first(),
					).toBeVisible();
					await sidebarCategory(page, after);
					await expect(page.locator("main .asset-list-content a")).toHaveCount(
						2,
					);
					await page.reload();
					await expect(
						page
							.locator(".asset-category-scroll")
							.getByRole("button", { name: after, exact: true }),
					).toHaveAttribute("aria-pressed", "true");
					expect(
						await page.evaluate(
							(kind) => sessionStorage.getItem(`keepany-category-id-${kind}`),
							kind,
						),
					).toBe(original.id);
					await page.goto("/trash");
					await page
						.locator("main .list-row")
						.filter({ hasText: `${kind} Recover` })
						.getByRole("button", { name: text.restore, exact: true })
						.click();
					await expect
						.poll(
							async () =>
								(await state(page, kind)).assets.find(
									(asset) => asset.id === ids[3],
								)?.deleted,
						)
						.toBe(false);
					await page.goto(`/assets/${kind}`);
					await expect(page.locator("main .asset-list-content a")).toHaveCount(
						3,
					);
					await page
						.getByRole("button", { name: text.manage, exact: true })
						.click();
					await editor
						.locator(".asset-category-order")
						.getByRole("button", {
							name:
								kind === "project"
									? locale === "en"
										? "Websites"
										: "网站"
									: locale === "en"
										? "Email"
										: "邮箱",
							exact: true,
						})
						.click();
					await expect(editor.getByLabel(text.name)).toHaveCount(0);
					await editor
						.getByRole("button", { name: text.collapse, exact: true })
						.click();
				}
				const password = "category-local-backup-2026";
				await page.goto("/intake");
				await page.locator("#backup-password").fill(password);
				await page
					.getByRole("button", { name: text.backup, exact: true })
					.click();
				const link = page.getByRole("link", {
					name: text.download,
					exact: true,
				});
				await expect(link).toBeVisible();
				const downloadPromise = page.waitForEvent("download");
				await link.click();
				const backupPath = await (await downloadPromise).path();
				expect(backupPath).not.toBeNull();
				const destination = await browser.newContext({
					viewport: { width, height: 844 },
					locale: locale === "en" ? "en-US" : locale,
				});
				try {
					const restored = await destination.newPage();
					restored.on("pageerror", (error) => errors.push(error.message));
					await restored.goto("/");
					await restored.evaluate(
						(language) => localStorage.setItem("keepany-language", language),
						locale,
					);
					await restored.goto("/intake");
					await restored.locator("#backup-password").fill(password);
					await restored
						.locator("#restore-file")
						.setInputFiles(backupPath as string);
					await restored
						.getByRole("button", { name: text.preview, exact: true })
						.first()
						.click();
					await restored.getByRole("button", { name: text.confirm }).click();
					await expect(restored.getByText(text.restored)).toBeVisible();
					for (const kind of ["project", "account"] as const) {
						await restored.goto(`/assets/${kind}`);
						await sidebarCategory(restored, `Archive ${kind}`);
						await expect(
							restored.locator("main .asset-list-content a"),
						).toHaveCount(3);
						await restored.reload();
						await expect(
							restored.locator("main .asset-list-content a"),
						).toHaveCount(3);
						expect((await state(restored, kind)).categories[0]).toMatchObject({
							id: categoryIds[kind],
							name: `Archive ${kind}`,
						});
						await fits(restored);
					}
				} finally {
					await destination.close();
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

for (const locale of ["en", "zh-CN"] as const) {
	test(`${locale} category editor rejects duplicate names and stale opening snapshots`, async ({
		page,
	}) => {
		const text = copy(locale);
		await page.goto("/");
		await page.evaluate(
			(language) => localStorage.setItem("keepany-language", language),
			locale,
		);
		await page.goto("/assets/project");
		const ids = await fixture(page, "project", "Original");
		await createCategoryUi(page, locale, "Original", ["project Keep"]);
		await createCategoryUi(page, locale, "Existing");
		await page.getByRole("button", { name: text.add, exact: true }).click();
		const creation = page.getByRole("region", {
			name: text.category,
			exact: true,
		});
		await creation.getByLabel(text.name).fill(locale === "en" ? "全部" : "All");
		await creation
			.getByRole("button", { name: text.save, exact: true })
			.click();
		await expect(creation.getByRole("alert")).toHaveText(text.duplicate);
		await creation
			.getByRole("button", { name: text.collapse, exact: true })
			.click();
		await page
			.locator(".asset-category-scroll")
			.getByRole("button", { name: "Original", exact: true })
			.click();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		const editor = page.getByRole("region", {
			name: text.category,
			exact: true,
		});
		await editor.getByLabel(text.name).fill("  EXISTING  ");
		await editor.getByRole("button", { name: text.save, exact: true }).click();
		await expect(editor.getByRole("alert")).toHaveText(text.duplicate);
		await editor.getByLabel(text.name).fill("Edited");
		await page.evaluate(
			async ({ repositoryPath, id }) => {
				const { localRepository } = await import(repositoryPath);
				const repository = await localRepository();
				const asset = (await repository.get("asset", id)) as Asset;
				await repository.saveAssetIfCurrent(asset, {
					...asset,
					description: "newer description",
					updatedAt: new Date().toISOString(),
				});
			},
			{ repositoryPath, id: ids[0] },
		);
		await editor.getByRole("button", { name: text.save, exact: true }).click();
		await expect(editor.getByRole("alert")).toHaveText(text.stale);
		const saved = await state(page, "project");
		expect(saved.categories.map((category) => category.name).sort()).toEqual([
			"Existing",
			"Original",
		]);
		expect(saved.assets.find((asset) => asset.id === ids[0])).toMatchObject({
			category: "Original",
			description: "newer description",
		});
		await editor
			.getByRole("button", { name: text.collapse, exact: true })
			.click();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		await editor.getByLabel(text.name).fill("Edited");
		await editor.getByRole("button", { name: text.save, exact: true }).click();
		await expect(editor).toBeHidden();
		expect(
			(await state(page, "project")).categories.find(
				(category) => category.name === "Edited",
			),
		).toBeDefined();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		await page.evaluate(async (repositoryPath) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			const expectedCategory = (
				(await repository.list("category")) as Category[]
			).find((category) => category.name === "Edited");
			if (!expectedCategory) throw Error("fixture category missing");
			const expectedAssets = (
				(await repository.list("asset", true)) as Asset[]
			).filter((asset) => asset.kind === "project");
			await repository.editCustomCategory({
				expectedCategory,
				expectedAssets,
				name: "Newer",
				memberIds: expectedAssets
					.filter((asset) => !asset.deleted && asset.category === "Edited")
					.map((asset) => asset.id),
				reservedNames: ["website", "repository", "tool"],
			});
		}, repositoryPath);
		// A stale Edit action cannot turn a renamed category into a new or dangling category.
		await editor
			.locator(".list-row")
			.filter({ hasText: "Edited" })
			.getByRole("button", { name: text.edit, exact: true })
			.click();
		await expect(editor.getByRole("alert")).toHaveText(text.stale);
		await expect(editor.getByLabel(text.name)).toHaveValue("Edited");
		// A stale removal must reject before clearing members or tombstoning the renamed category.
		await editor
			.locator(".list-row")
			.filter({ hasText: "Edited" })
			.getByRole("button", { name: text.remove, exact: true })
			.click();
		await expect(editor.getByRole("alert")).toHaveText(text.stale);
		const newer = await state(page, "project");
		expect(
			newer.categories.find((category) => category.name === "Newer")?.deleted,
		).toBe(false);
		expect(newer.assets.find((asset) => asset.id === ids[0])?.category).toBe(
			"Newer",
		);
		// Client-side kind navigation must discard the old kind's category draft.
		if (await page.locator(".mobile-menu").isVisible())
			await page.locator(".mobile-menu").click();
		await page
			.locator("nav")
			.getByRole("link", {
				name: locale === "en" ? "Accounts" : "账号",
				exact: true,
			})
			.click();
		await expect(editor).toBeHidden();
		if (await page.locator(".mobile-menu").isVisible())
			await page.locator(".mobile-menu").click();
		await page
			.locator("nav")
			.getByRole("link", {
				name: locale === "en" ? "Projects" : "项目",
				exact: true,
			})
			.click();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		await editor
			.locator(".list-row")
			.filter({ hasText: "Newer" })
			.getByRole("button", { name: text.remove, exact: true })
			.click();
		await expect(editor).toBeHidden();
		const removed = await state(page, "project");
		expect(
			removed.categories.find((category) => category.name === "Newer")?.deleted,
		).toBe(true);
		expect(removed.assets.find((asset) => asset.id === ids[0])?.category).toBe(
			"",
		);
		expect(removed.assets.find((asset) => asset.id === ids[3])).toMatchObject({
			deleted: true,
			category: "",
		});
	});
}

for (const locale of ["en", "zh-CN"] as const) {
	for (const undo of [false, true]) {
		test(`${locale} interrupted category edit stays visible after reload and ${undo ? "undoes" : "retries"}`, async ({
			page,
		}) => {
			const width = locale === "en" ? 1280 : 390;
			await page.setViewportSize({ width, height: 844 });
			const text = copy(locale);
			// Reapply a storage fault before open-time recovery. The journal itself is created by the real UI save.
			await page.route("**/packages/local-db/src/index.ts*", async (route) => {
				const response = await route.fetch();
				const source = await response.text();
				await route.fulfill({
					response,
					body: `${source}\nconst categoryFixtureRecovery = LocalRepository.prototype.retryAllCategoryEdits;\nLocalRepository.prototype.retryAllCategoryEdits = async function(...args) {\n  const storage = this.db.records.storageInstance;\n  if (!storage.categoryFixturePatched) {\n    storage.categoryFixturePatched = true;\n    const write = storage.bulkWrite.bind(storage);\n    storage.bulkWrite = (rows, context) => sessionStorage.getItem('category-storage-fault') && context === 'category-edit'\n      ? Promise.reject(Error('fixture storage unavailable')) : write(rows, context);\n  }\n  return categoryFixtureRecovery.apply(this, args);\n};`,
				});
			});
			await page.goto("/");
			await page.evaluate(
				(language) => localStorage.setItem("keepany-language", language),
				locale,
			);
			await page.goto("/assets/project");
			await fixture(page, "project", "Original");
			await createCategoryUi(page, locale, "Original", [
				"project Keep",
				"project Remove",
			]);
			const originalId = (await state(page, "project")).categories[0].id;
			await page
				.getByRole("button", { name: text.manage, exact: true })
				.click();
			const editor = page.getByRole("region", {
				name: text.category,
				exact: true,
			});
			await editor.getByLabel(text.name).fill("Changed");
			await editor
				.getByRole("checkbox", { name: "project Remove", exact: true })
				.uncheck();
			await editor
				.getByRole("checkbox", { name: "project Add", exact: true })
				.check();
			await page.evaluate(async (repositoryPath) => {
				const { localRepository } = await import(repositoryPath);
				const storage = (await localRepository()).db.records.storageInstance;
				const write = storage.bulkWrite.bind(storage);
				let categoryWrites = 0;
				sessionStorage.setItem("category-storage-fault", "1");
				storage.bulkWrite = async (rows: unknown[], context: string) => {
					if (
						context === "category-edit" &&
						++categoryWrites > 1 &&
						sessionStorage.getItem("category-storage-fault")
					)
						throw Error("fixture storage unavailable");
					// The first category CAS succeeds, then the member write fails.
					if (context === "category-edit" && categoryWrites === 1) {
						sessionStorage.removeItem("category-storage-fault");
						try {
							return await write(rows, context);
						} finally {
							sessionStorage.setItem("category-storage-fault", "1");
						}
					}
					return write(rows, context);
				};
			}, repositoryPath);
			await editor
				.getByRole("button", { name: text.save, exact: true })
				.click();
			const recovery = page.locator(".asset-category-recovery");
			await expect(recovery).toBeVisible();
			await page.reload();
			await expect(recovery).toBeVisible();
			await expect(page.locator("main .asset-list-content a")).toHaveCount(2);
			await expect(
				page.getByRole("button", { name: text.add, exact: true }),
			).toBeDisabled();
			const retry = locale === "en" ? "Continue saving" : "继续保存";
			const cancel = locale === "en" ? "Undo changes" : "撤销改动";
			await recovery.getByRole("button", { name: retry, exact: true }).click();
			await expect(recovery.getByRole("alert")).toBeVisible();
			for (const recoveryWidth of [390, 1280]) {
				await page.setViewportSize({ width: recoveryWidth, height: 844 });
				await fits(page);
				await page.screenshot({
					path: join(
						tmpdir(),
						`keepany-category-recovery-${locale}-${undo ? "undo" : "retry"}-${recoveryWidth}.png`,
					),
					fullPage: true,
				});
			}
			await page.evaluate(() =>
				sessionStorage.removeItem("category-storage-fault"),
			);
			await recovery
				.getByRole("button", { name: undo ? cancel : retry, exact: true })
				.click();
			await expect(recovery).toBeHidden();
			await expect(
				page.locator(".asset-category-scroll").getByRole("button", {
					name: undo ? "Original" : "Changed",
					exact: true,
				}),
			).toHaveAttribute("aria-pressed", "true");
			const saved = await state(page, "project");
			expect(saved.categories).toHaveLength(1);
			expect(saved.categories[0]).toMatchObject({
				id: originalId,
				name: undo ? "Original" : "Changed",
			});
			expect(
				saved.assets.find((asset) => asset.name === "project Keep")?.category,
			).toBe(undo ? "Original" : "Changed");
			expect(
				saved.assets.find((asset) => asset.name === "project Remove")?.category,
			).toBe(undo ? "Original" : "");
			expect(
				saved.assets.find((asset) => asset.name === "project Add")?.category,
			).toBe(undo ? "" : "Changed");
			await page.reload();
			await expect(recovery).toBeHidden();
			expect((await state(page, "project")).categories[0].id).toBe(originalId);
		});
	}
}
