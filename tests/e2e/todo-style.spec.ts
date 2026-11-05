import {
	test,
	expect,
	type Page,
	type Locator,
	type TestInfo,
} from "@playwright/test";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { newAsset, taskSchema } from "../../packages/domain/src";
import { resources } from "../../apps/web/src/i18n";
import {
	prepareCompletionArchive,
	restoreCompletionArchive,
} from "./helpers/completion-archive";
import { acceptanceCandidate } from "./helpers/acceptance-candidate";

const password = "TS-fictional-only-2026",
	stamp = "2026-11-01T00:00:00.000Z";
const kinds = ["ordinary", "item", "subscription", "wallet"] as const;
const widths = [390, 768, 1280, 1920, 1991, 2262];
const paths = {
	ordinary: "/assets",
	item: "/assets/item",
	subscription: "/assets/subscription",
	wallet: "/cards",
};
type Locale = "zh-CN" | "en";
const text = (locale: Locale) => (key: string) =>
	(resources[locale].translation as Record<string, string>)[key];
const identity = () =>
	acceptanceCandidate().release.webFiles.find(
		(file) => file.path === "index.html",
	)!.sha256;
let archive: string;
test.beforeAll(async ({}, info) => {
	const dir = resolve(
		process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/todo-style",
		`fixture-${info.workerIndex}`,
	);
	archive = resolve(dir, "fixture.ka1");
	await prepareCompletionArchive(dir, password, async (db) => {
		const category = await db.saveCatalogCategory(null, {
			name: "TS Fictional / 虚构分类",
		});
		for (const kind of kinds) {
			const asset = {
				...newAsset(
					kind === "ordinary" || kind === "wallet" ? "project" : kind,
				),
				id: `ts-${kind}`,
				name: `TS ${kind} / 虚构资产`,
				catalogCategoryId: category.id,
				createdAt: stamp,
				updatedAt: stamp,
				...(kind === "wallet"
					? {
							walletCard: {
								type: "storedValue" as const,
								issuer: "Fictional",
								lastFour: "1234",
								balanceMinor: 12000,
								remainingUses: null,
							},
						}
					: {}),
			};
			await db.save("asset", asset);
			for (let index = 0; index < 4; index++)
				await db.save(
					"task",
					taskSchema.parse({
						id: `${asset.id}-${index}`,
						assetId: asset.id,
						name:
							`TS task ${index} / 虚构待办` +
							(index >= 2 ? " Long title / 长待办内容".repeat(9) : ""),
						dueDate: "2026-11-20",
						done: index % 2 === 1,
						completedAt: index % 2 === 1 ? "2026-10-28T02:00:00.000Z" : "",
						completionHistory:
							index % 2 === 1
								? ["2026-10-27T01:00:00.000Z", "2026-10-28T02:00:00.000Z"]
								: [],
						createdAt: stamp,
					}),
				);
		}
		for (const variant of ["empty", "single"]) {
			const asset = {
				...newAsset("project"),
				id: `ts-${variant}`,
				name: `TS ${variant}`,
				catalogCategoryId: category.id,
			};
			await db.save("asset", asset);
			if (variant === "single")
				await db.save(
					"task",
					taskSchema.parse({
						id: "ts-single-task",
						assetId: asset.id,
						name: "TS undated / 无日期",
						createdAt: stamp,
					}),
				);
		}
		await db.save(
			"task",
			taskSchema.parse({
				id: "ts-orphan",
				name: "TS standalone / 独立待办",
				dueDate: "2026-11-20",
				createdAt: stamp,
			}),
		);
		return {
			assets: 6,
			tasks: 18,
			kind: "synthetic-fixture-not-user-operation",
		};
	});
});
async function start(page: Page, locale: Locale) {
	await page.addInitScript(
		(language) => localStorage.setItem("keepany-language", language),
		locale,
	);
	await page.goto("/assets");
	expect(
		createHash("sha256")
			.update(await (await page.request.get("/")).body())
			.digest("hex"),
	).toBe(identity());
	await restoreCompletionArchive(page, password, archive);
}
async function enter(page: Page, kind: (typeof kinds)[number]) {
	await page.goto(paths[kind]);
	await page
		.locator(".asset-summary-card")
		.filter({ hasText: `TS ${kind} /` })
		.click();
	await expect(page.locator(".unified-detail-main")).toBeVisible();
	await page.evaluate(async () => {
		await document.fonts.ready;
	});
}
const row = (page: Page, kind: string, index: number) =>
	page.locator(`#task-ts-${kind}-${index}`);
async function shot(
	page: Page,
	info: TestInfo,
	name: string,
	region?: Locator,
) {
	const path = info.outputPath(`${name}.png`);
	if (region) await region.screenshot({ path, animations: "disabled" });
	else await page.screenshot({ path, fullPage: false, animations: "disabled" });
	await info.attach(`${name}.png`, { path, contentType: "image/png" });
}
async function receipt(
	info: TestInfo,
	locale: Locale,
	ids: string[],
	extra = {},
) {
	await info.attach("contract-results.json", {
		body: JSON.stringify({
			locale,
			ids,
			candidate: identity(),
			result: "passed",
			...extra,
		}),
		contentType: "application/json",
	});
}
async function geometry(page: Page, rows: Locator) {
	const result = await rows.evaluateAll((elements) =>
		elements.map((el) => {
			const box = el.getBoundingClientRect(),
				info = el.querySelector(".impact-task-info")!.getBoundingClientRect();
			const buttons = [...el.querySelectorAll("button")].map((b) => {
				const r = b.getBoundingClientRect();
				return {
					width: r.width,
					height: r.height,
					left: r.left,
					right: r.right,
				};
			});
			return {
				left: box.left,
				right: box.right,
				infoLeft: info.left,
				infoRight: info.right,
				buttons,
			};
		}),
	);
	for (const r of result) {
		expect(r.left).toBeGreaterThanOrEqual(0);
		expect(r.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
		expect(r.buttons).toHaveLength(3);
		for (const b of r.buttons) {
			expect(b.width).toBeGreaterThanOrEqual(44);
			expect(b.height).toBeGreaterThanOrEqual(44);
		}
		expect(r.buttons[0].right).toBeLessThanOrEqual(r.infoLeft);
		expect(r.infoRight).toBeLessThanOrEqual(r.buttons[1].left);
	}
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth + 1,
		),
	).toBe(true);
}
for (const locale of ["zh-CN", "en"] as const) {
	const t = text(locale);
	test(`${locale} TS04 responsive rows and action states`, async ({
		page,
	}, info) => {
		await start(page, locale);
		for (const width of widths) {
			await page.setViewportSize({ width, height: 1000 });
			for (const kind of kinds) {
				await enter(page, kind);
				await page.mouse.move(0, 0);
				await geometry(
					page,
					page.locator(".unified-detail-tasks .account-compact-task"),
				);
				const done = row(page, kind, 1).locator(".task-status-check");
				expect(
					await done.evaluate((el) => getComputedStyle(el).backgroundColor),
				).toBe(
					await done.evaluate((el) => {
						const probe = document.createElement("span");
						probe.style.background = "var(--accent)";
						el.append(probe);
						const color = getComputedStyle(probe).backgroundColor;
						probe.remove();
						return color;
					}),
				);
				await expect(done.locator("svg")).toHaveCount(1);
				await expect(row(page, kind, 1)).toContainText("2026");
				await shot(
					page,
					info,
					`${locale}-${width}-${kind}-rows`,
					page.locator(".unified-detail-tasks"),
				);
			}
			await enter(page, "ordinary");
			const target = row(page, "ordinary", 1),
				edit = target.getByRole("button", { name: t("editTask"), exact: true });
			await edit.hover();
			await shot(page, info, `${locale}-${width}-hover`, target);
			await edit.focus();
			await shot(page, info, `${locale}-${width}-focus`, target);
			await page.keyboard.down("Space");
			await shot(page, info, `${locale}-${width}-pressed`, target);
			await page.keyboard.up("Space");
			const dialog = page.getByRole("dialog");
			await expect(dialog.locator("#taskName")).toHaveValue(
				"TS task 1 / 虚构待办",
			);
			await shot(page, info, `${locale}-${width}-editor`);
			await dialog.locator("#taskName").fill("");
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog.locator("#taskName")).toHaveAttribute(
				"aria-invalid",
				"true",
			);
			await shot(page, info, `${locale}-${width}-error`);
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await target
				.getByRole("button", { name: t("moreActions"), exact: true })
				.click();
			await expect(page.getByRole("menu")).toBeVisible();
			await expect(
				page.getByRole("menuitem", { name: t("edit"), exact: true }),
			).toBeVisible();
			await shot(page, info, `${locale}-${width}-menu`);
			await page.keyboard.press("Escape");
			for (const variant of ["empty", "single"]) {
				await page.goto("/assets");
				await page
					.locator(".asset-summary-card")
					.filter({ hasText: `TS ${variant}` })
					.click();
				await expect(page.locator(".unified-detail-main")).toBeVisible();
				await expect(
					page.locator(".unified-detail-tasks .account-compact-task"),
				).toHaveCount(variant === "empty" ? 0 : 1);
				await shot(
					page,
					info,
					`${locale}-${width}-${variant}`,
					page.locator(".unified-detail-tasks"),
				);
			}
		}
		await receipt(info, locale, ["TS04"], {
			widths,
			kinds,
			states: [
				"default",
				"hover",
				"focus",
				"pressed",
				"menu",
				"editor",
				"error",
				"empty",
				"single",
			],
		});
	});
	test(`${locale} TS01 TS02 TS03 edit complete reschedule and reload`, async ({
		page,
	}, info) => {
		await start(page, locale);
		for (const [index, kind] of kinds.entries()) {
			await page.setViewportSize({
				width: index % 2 ? 1920 : 390,
				height: 1000,
			});
			await enter(page, kind);
			const completed = row(page, kind, 1),
				pending = row(page, kind, 0);
			const history = await completed.locator("small").last().innerText();
			const edit = completed.getByRole("button", {
				name: t("editTask"),
				exact: true,
			});
			await expect(edit).toHaveAttribute("title", t("editTask"));
			await edit.click();
			let dialog = page.getByRole("dialog");
			await expect(dialog.locator("#taskName")).toHaveValue(
				"TS task 1 / 虚构待办",
			);
			await dialog.locator("#taskName").fill("Cancelled");
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await expect(completed.locator("strong")).toHaveText(
				"TS task 1 / 虚构待办",
			);
			await page.reload();
			await expect(completed.locator("strong")).toHaveText(
				"TS task 1 / 虚构待办",
			);
			await edit.focus();
			await page.keyboard.press("Enter");
			dialog = page.getByRole("dialog");
			await dialog.locator("#taskName").fill("");
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toContainText(t("required"));
			await dialog.locator("#taskName").fill(`TS saved ${kind} / 已修改`);
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await expect(completed.locator("strong")).toHaveText(
				`TS saved ${kind} / 已修改`,
			);
			await page.reload();
			await expect(completed.locator("strong")).toHaveText(
				`TS saved ${kind} / 已修改`,
			);
			await expect(completed.locator("small").last()).toHaveText(history);
			await expect(completed.locator(".task-complete-toggle")).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			// Test preparation: hold the public browser lock used by the local repository.
			// The completion itself still comes from the real UI; no save method is mocked.
			await page.evaluate(
				() =>
					new Promise<void>((resolve) => {
						void navigator.locks.request(
							"keepany-task:keepany-v1",
							async () => {
								resolve();
								await new Promise<void>((release) => {
									(window as unknown as { tsRelease: () => void }).tsRelease =
										release;
								});
							},
						);
					}),
			);
			try {
				await completed.locator(".task-complete-toggle").focus();
				await page.keyboard.press("Space");
				for (const button of await completed.getByRole("button").all())
					await expect(button).toBeDisabled();
				await shot(page, info, `${locale}-${kind}-busy`, completed);
			} finally {
				await page.evaluate(() =>
					(window as unknown as { tsRelease: () => void }).tsRelease(),
				);
			}
			await expect(completed.locator(".task-complete-toggle")).toHaveAttribute(
				"aria-pressed",
				"false",
			);
			await expect(completed.locator("small").last()).toHaveText(history);
			await completed.locator(".task-complete-toggle").click();
			await expect(completed.locator(".task-complete-toggle")).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			await expect(completed.locator("small").last()).toContainText(history);
			await pending
				.getByRole("button", { name: t("moreActions"), exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: t("edit"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await expect(dialog.locator("#taskName")).toHaveValue(
				"TS task 0 / 虚构待办",
			);
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await pending
				.getByRole("button", { name: t("moreActions"), exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: t("remindLater"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await dialog.getByRole("combobox").fill("2026-11-22");
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await pending
				.getByRole("button", { name: t("moreActions"), exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: t("remindLater"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await expect(dialog.getByRole("combobox")).toHaveValue("2026-11-20");
			await dialog.getByRole("combobox").fill("2026-11-22");
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await pending
				.getByRole("button", { name: t("moreActions"), exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: t("taskPostponeDay"), exact: true })
				.click();
			await expect(pending.locator("small").first()).toContainText("23");
			await page.reload();
			await pending
				.getByRole("button", { name: t("editTask"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await expect(dialog.locator("#taskDue")).toHaveValue("2026-11-23");
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await expect(completed.locator("small").last()).toContainText(history);
			await expect(
				row(page, kind, 2).locator(".task-complete-toggle"),
			).toHaveAttribute("aria-pressed", "false");
			await shot(
				page,
				info,
				`${locale}-${kind}-saved`,
				page.locator(".unified-detail-tasks"),
			);
		}
		await receipt(info, locale, ["TS01", "TS02", "TS03"], { kinds });
	});
	test(`${locale} TS05 shared reminder parents`, async ({ page }, info) => {
		await start(page, locale);
		for (const width of widths) {
			await page.setViewportSize({ width, height: 1000 });
			for (const target of ["ts-orphan", "ts-item-0"]) {
				await page.goto(`/tasks#task-${target}`);
				const task = page.locator(`#task-${target}`);
				await expect(task).toBeVisible();
				await geometry(page, task);
				await task
					.getByRole("button", { name: t("editTask"), exact: true })
					.click();
				const dialog = page
					.getByRole("dialog")
					.filter({ has: page.locator("#taskName") });
				await expect(dialog.locator("#taskName")).toHaveValue(
					target === "ts-orphan"
						? "TS standalone / 独立待办"
						: "TS task 0 / 虚构待办",
				);
				await shot(page, info, `${locale}-${width}-${target}-shared-editor`);
				await dialog
					.getByRole("button", { name: t("cancel"), exact: true })
					.click();
				await shot(page, info, `${locale}-${width}-${target}-shared`, task);
			}
		}
		await receipt(info, locale, ["TS05"], {
			widths,
			parents: ["standalone-center", "linked-context"],
		});
	});
	test(`${locale} TS05 direct editor lazy loading failure recovery`, async ({
		page,
	}, info) => {
		await start(page, locale);
		await enter(page, "ordinary");
		const pattern = /\/assets\/workflow-task-editor-[^/]+\.js(?:\?|$)/;
		let release!: () => void,
			intercepted = 0;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(pattern, async (route) => {
			intercepted++;
			await held;
			await route.abort("failed");
		});
		try {
			await row(page, "ordinary", 0)
				.getByRole("button", { name: t("editTask"), exact: true })
				.click();
			await expect.poll(() => intercepted).toBe(1);
			await expect(row(page, "ordinary", 0).getByRole("status")).toHaveText(
				t("loading"),
			);
			await shot(page, info, `${locale}-loading`, row(page, "ordinary", 0));
			release();
			await expect(page.getByTestId("route-load-error")).toHaveAttribute(
				"data-error-kind",
				"module-load",
			);
			await shot(page, info, `${locale}-resource-error`);
			await page.unroute(pattern);
			await page
				.getByRole("button", { name: t("pageLoadErrorReload"), exact: true })
				.click();
			await expect(row(page, "ordinary", 0)).toBeVisible();
			await row(page, "ordinary", 0)
				.getByRole("button", { name: t("editTask"), exact: true })
				.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog.locator("#taskName")).toHaveValue(
				"TS task 0 / 虚构待办",
			);
			await shot(page, info, `${locale}-recovered`);
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
		} finally {
			release();
		}
		await receipt(info, locale, ["TS05"], {
			states: ["loading", "resource-error", "recovered"],
		});
	});
}
