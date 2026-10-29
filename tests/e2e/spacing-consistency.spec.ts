import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

/**
 * Layout regression checks for the fixed delivery and the source package.
 * Every record used here is created through the visible application UI so that
 * the checks exercise the same forms and responsive breakpoints as a user.
 */
test.use({ timezoneId: "Asia/Shanghai" });
test.setTimeout(120_000);

const evidenceRoot =
	process.env.KEEPANY_SPACING_EVIDENCE_DIR ??
	"/tmp/keepany-spacing-consistency";
mkdirSync(evidenceRoot, { recursive: true });

const variants = [
	{ locale: "zh-CN", width: 360 },
	{ locale: "zh-CN", width: 390 },
	{ locale: "zh-CN", width: 1280 },
	{ locale: "zh-CN", width: 1440 },
	{ locale: "en-US", width: 360 },
	{ locale: "en-US", width: 390 },
	{ locale: "en-US", width: 1280 },
	{ locale: "en-US", width: 1440 },
] as const;

type Variant = (typeof variants)[number];

type Copy = {
	add: string;
	provider: string;
	save: string;
	preview: string;
	addConnection: string;
	itemEditLocation: string;
	newTask: string;
	financeRecord: string;
};

function copyFor(locale: Variant["locale"]): Copy {
	return locale === "zh-CN"
		? {
				add: "新增",
				provider: "服务商",
				save: "保存",
				preview: "预览",
				addConnection: "添加关联",
				itemEditLocation: "编辑位置",
				newTask: "新建待办",
				financeRecord: "记一笔",
			}
		: {
				add: "Add",
				provider: "Provider",
				save: "Save",
				preview: "Preview",
				addConnection: "Add connection",
				itemEditLocation: "Edit location",
				newTask: "New task",
				financeRecord: "Record transaction",
			};
}

async function waitForApp(page: Page) {
	await page.locator("main").waitFor({ state: "visible" });
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
	const metrics = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
	}));
	expect(
		metrics.scrollWidth,
		`${label}: document must not overflow horizontally`,
	).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

function visualOutset(boxShadow: string) {
	// The product shadow is currently an offset shadow. Include its offset in the
	// usable gap so a DOM gap cannot hide a shadow touching its neighbour.
	const match = boxShadow.match(
		/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?(?:\s+(-?\d+(?:\.\d+)?)px)?/,
	);
	if (!match) return { x: 0, y: 0 };
	const blur = Number(match[3] ?? 0);
	const spread = Number(match[4] ?? 0);
	return {
		x: Math.abs(Number(match[1])) + blur + spread,
		y: Math.abs(Number(match[2])) + blur + spread,
	};
}

async function assertRectGap(
	first: Locator,
	second: Locator,
	label: string,
	minimum: number,
) {
	const result = await Promise.all(
		[first, second].map((locator) =>
			locator.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return {
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
					left: rect.left,
					shadow: getComputedStyle(element).boxShadow,
				};
			}),
		),
	);
	if (!result[0] || !result[1]) throw new Error(`${label}: missing rectangles`);
	const firstBox = result[0];
	const secondBox = result[1];
	const firstOutset = visualOutset(firstBox.shadow);
	const verticalOverlap =
		Math.min(firstBox.bottom, secondBox.bottom) -
		Math.max(firstBox.top, secondBox.top);
	const horizontalOverlap =
		Math.min(firstBox.right, secondBox.right) -
		Math.max(firstBox.left, secondBox.left);
	const gap =
		horizontalOverlap > 0
			? secondBox.top - (firstBox.bottom + firstOutset.y)
			: verticalOverlap > 0
				? secondBox.left - (firstBox.right + firstOutset.x)
				: Math.min(
						Math.abs(secondBox.top - firstBox.bottom),
						Math.abs(secondBox.left - firstBox.right),
					);
	expect(
		gap,
		`${label}: visual rectangle gap ${gap.toFixed(1)}px must be at least ${minimum}px`,
	).toBeGreaterThanOrEqual(minimum);
}

async function assertSiblingGaps(
	page: Page,
	selector: string,
	label: string,
	minimum = 8,
) {
	const result = await page.locator(selector).evaluateAll((elements) =>
		elements.flatMap((element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			if (
				style.display === "none" ||
				style.visibility === "hidden" ||
				rect.width <= 0 ||
				rect.height <= 0
			)
				return [];
			const shadow = style.boxShadow.match(
				/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px(?:\s+(-?\d+(?:\.\d+)?)px)?(?:\s+(-?\d+(?:\.\d+)?)px)?/,
			);
			const blur = shadow ? Number(shadow[3] ?? 0) + Number(shadow[4] ?? 0) : 0;
			return [
				{
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
					left: rect.left,
					shadowX: shadow ? Math.abs(Number(shadow[1])) + blur : 0,
					shadowY: shadow ? Math.abs(Number(shadow[2])) + blur : 0,
				},
			];
		}),
	);
	for (let index = 0; index < result.length; index += 1) {
		for (let next = index + 1; next < result.length; next += 1) {
			const a = result[index];
			const b = result[next];
			const verticalOverlap =
				Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
			const horizontalOverlap =
				Math.min(a.right, b.right) - Math.max(a.left, b.left);
			if (horizontalOverlap > 0) {
				const rawGap = b.top >= a.top ? b.top - a.bottom : a.top - b.bottom;
				const gap = rawGap - Math.max(a.shadowY, b.shadowY);
				expect(rawGap, `${label}: DOM vertical gap`).toBeGreaterThanOrEqual(
					minimum,
				);
				expect(
					gap,
					`${label}: card shadows must leave a visible separation`,
				).toBeGreaterThanOrEqual(0);
			} else if (verticalOverlap > 0) {
				const rawGap = b.left >= a.left ? b.left - a.right : a.left - b.right;
				const gap = rawGap - Math.max(a.shadowX, b.shadowX);
				expect(rawGap, `${label}: DOM horizontal gap`).toBeGreaterThanOrEqual(
					minimum,
				);
				expect(
					gap,
					`${label}: card shadows must leave a visible separation`,
				).toBeGreaterThanOrEqual(0);
			}
		}
	}
}

async function assertFormGeometry(scope: Locator, label: string) {
	const metrics = await scope.evaluate((element) => {
		const scopeRect = element.getBoundingClientRect();
		const fields = [...element.querySelectorAll<HTMLElement>(".field")].flatMap(
			(field) => {
				const style = getComputedStyle(field);
				const rect = field.getBoundingClientRect();
				const closedDetails = field.closest("details:not([open])");
				if (
					closedDetails ||
					style.display === "none" ||
					style.visibility === "hidden" ||
					rect.width <= 0 ||
					rect.height <= 0
				)
					return [];
				return [
					{
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom,
						left: rect.left,
						width: rect.width,
						height: rect.height,
						inStickyRegion: Boolean(field.closest(".ai-request-footer")),
					},
				];
			},
		);
		const actions = [
			...element.querySelectorAll<HTMLElement>(".actions"),
		].flatMap((action) => {
			const style = getComputedStyle(action);
			const rect = action.getBoundingClientRect();
			if (
				style.display === "none" ||
				style.visibility === "hidden" ||
				rect.width <= 0 ||
				rect.height <= 0
			)
				return [];
			return [
				{
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
					left: rect.left,
					width: rect.width,
					height: rect.height,
				},
			];
		});
		const buttonGaps = [
			...element.querySelectorAll<HTMLElement>(".actions"),
		].flatMap((action) => {
			const buttons = [
				...action.querySelectorAll<HTMLElement>(
					":scope > .button, :scope > button, :scope > a.button",
				),
			].flatMap((button) => {
				const rect = button.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return [];
				return [
					{
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom,
						left: rect.left,
					},
				];
			});
			return buttons.slice(1).map((current, index) => {
				const previous = buttons[index];
				const horizontalOverlap =
					Math.min(previous.right, current.right) -
					Math.max(previous.left, current.left);
				return horizontalOverlap > 1
					? current.top - previous.bottom
					: current.left - previous.right;
			});
		});
		return {
			scope: {
				left: scopeRect.left,
				right: scopeRect.right,
				width: scopeRect.width,
			},
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
			fields,
			actions,
			buttonGaps,
		};
	});
	expect(
		metrics.scrollWidth,
		`${label}: form content must fit its own scroll box`,
	).toBeLessThanOrEqual(metrics.clientWidth + 1);
	for (const field of metrics.fields) {
		expect(
			field.left,
			`${label}: field starts inside form`,
		).toBeGreaterThanOrEqual(metrics.scope.left - 1);
		expect(field.right, `${label}: field ends inside form`).toBeLessThanOrEqual(
			metrics.scope.right + 1,
		);
	}
	for (let index = 0; index < metrics.fields.length; index += 1) {
		for (let next = index + 1; next < metrics.fields.length; next += 1) {
			const a = metrics.fields[index];
			const b = metrics.fields[next];
			if (a.inStickyRegion || b.inStickyRegion) continue;
			const horizontalOverlap =
				Math.min(a.right, b.right) - Math.max(a.left, b.left);
			if (horizontalOverlap > 1) {
				const gap = b.top >= a.top ? b.top - a.bottom : a.top - b.bottom;
				expect(
					gap,
					`${label}: field rows keep an 8px breathing space`,
				).toBeGreaterThanOrEqual(8);
			} else {
				const gap = b.left >= a.left ? b.left - a.right : a.left - b.right;
				expect(
					gap,
					`${label}: fields in one row keep an 8px breathing space`,
				).toBeGreaterThanOrEqual(8);
			}
		}
	}
	for (const action of metrics.actions) {
		expect(
			action.left,
			`${label}: actions start inside form`,
		).toBeGreaterThanOrEqual(metrics.scope.left - 1);
		expect(
			action.right,
			`${label}: actions end inside form`,
		).toBeLessThanOrEqual(metrics.scope.right + 1);
	}
	for (const gap of metrics.buttonGaps)
		expect(
			gap,
			`${label}: adjacent buttons keep an 8px gap`,
		).toBeGreaterThanOrEqual(8);
}

async function packageMarker(page: Page) {
	return page.evaluate(async () => {
		const serviceWorker = await fetch("/sw.js")
			.then((response) => response.text())
			.catch(() => "");
		return serviceWorker.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? "unknown";
	});
}

async function captureIntakeEvidence(
	page: Page,
	variant: Variant,
	stage: string,
) {
	await page.evaluate(() => window.scrollTo(0, 0));
	const geometry = await page.evaluate(() => {
		const read = (selector: string) => {
			const element = document.querySelector<HTMLElement>(selector);
			if (!element) return null;
			const rect = element.getBoundingClientRect();
			return {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
				left: rect.left,
			};
		};
		return {
			viewport: innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
			primary: read(".intake-primary-grid"),
			quick: read(".intake-quick-card"),
			backup: read(".intake-backup-card"),
			recent: read(".intake-recent"),
			password: read("#backup-password"),
			backupActions: read(".intake-backup-card > .actions"),
			status: read(".intake-backup-status"),
			details: [
				...document.querySelectorAll<HTMLDetailsElement>(
					".intake-backup-card > details",
				),
			].map((detail) => ({
				open: detail.open,
				top: detail.getBoundingClientRect().top,
				bottom: detail.getBoundingClientRect().bottom,
			})),
		};
	});
	const base = `${evidenceRoot}/spacing-intake-${variant.locale}-${variant.width}-${stage}`;
	if (variant.width === 390 || variant.width === 1280)
		await page.screenshot({ path: `${base}.png`, fullPage: true });
	writeFileSync(
		`${base}.json`,
		JSON.stringify(
			{ variant, package: await packageMarker(page), geometry },
			null,
			2,
		),
	);
}

async function createAsset(
	page: Page,
	copy: Copy,
	kind: "project" | "item" | "account" | "subscription",
	name: string,
	accountId?: string,
) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#name").fill(name);
	if (kind === "account")
		await dialog
			.getByLabel(copy.provider, { exact: true })
			.fill("Spacing test provider");
	if (kind === "item") await dialog.locator("#location").fill("L".repeat(300));
	if (kind === "subscription") {
		if (!accountId) throw new Error("spacing-subscription-account-missing");
		await selectChoice(
			dialog
				.getByLabel("Sign-in account", { exact: true })
				.or(dialog.getByLabel("登录账号", { exact: true })),
			{ value: accountId },
		);
		const payment = dialog
			.getByLabel("Payment method", { exact: true })
			.or(dialog.getByLabel("付款方式", { exact: true }));
		await payment.fill("Bank card");
		await dialog.locator("#amount").fill("1200");
		await selectChoice(
			dialog
				.getByLabel("Currency", { exact: true })
				.or(dialog.getByLabel("币种", { exact: true })),
			"JPY",
		);
		await dialog.locator("#dueDate").fill("2026-10-31");
	}
	return dialog;
}

async function saveAndFindAsset(
	page: Page,
	dialog: Locator,
	copy: Copy,
	name: string,
) {
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	const link = page
		.locator("main .asset-list-content a")
		.filter({ hasText: name });
	await expect(link).toHaveCount(1);
	for (const title of await link.locator(".asset-editorial-copy strong, .asset-repository-cover strong").all()) {
		expect(await title.evaluate(element => {
			const titleRect = element.getBoundingClientRect();
			const cover = element.closest(".asset-project-cover")!.getBoundingClientRect();
			return titleRect.left >= cover.left && titleRect.right <= cover.right + 1 && titleRect.top >= cover.top && titleRect.bottom <= cover.bottom + 1;
		}), "Long project titles remain inside the preview cover").toBe(true);
	}
	expect(await link.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Long asset names fit their cards").toBe(true);
	for (const meta of await link.locator(".asset-library-meta span").all()) {
		expect(await meta.evaluate(element => {
			const rect = element.getBoundingClientRect();
			const body = element.closest(".asset-library-body")!.getBoundingClientRect();
			return rect.right <= body.right + 1 && element.scrollWidth <= element.clientWidth + 1;
		}), "Long metadata stays inside its card and remains readable").toBe(true);
	}
	const href = await link.getAttribute("href");
	const id = href?.split("/").at(-1);
	if (!id) throw new Error(`spacing-asset-id-missing:${name}`);
	return id;
}

for (const variant of variants) {
	test(`${variant.locale} ${variant.width}px intake spacing keeps capture, backup and restore controls separated`, async ({
		browser,
	}) => {
		const copy = copyFor(variant.locale);
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			acceptDownloads: true,
		});
		const page = await context.newPage();
		try {
			await page.goto("/intake");
			await page.locator("#import-url").waitFor({ state: "visible" });
			await page
				.locator("#import-url")
				.fill("https://spacing.example.test/project");
			await page.locator(".intake-quick-card > .button").click();
			const importPreview = page.locator(".import-preview");
			await expect(importPreview).toBeVisible();
			const candidateRow = importPreview.locator(".list-row").first();
			const candidateCheckbox = candidateRow.locator('input[type="checkbox"]');
			const candidateName = candidateRow
				.locator('input[aria-label*="名称"], input[aria-label*="Name"]')
				.first();
			const candidateState = candidateRow.locator(".chip").first();
			await assertRectGap(
				candidateCheckbox,
				candidateName,
				"intake candidate checkbox to editable field",
				12,
			);
			await assertRectGap(
				candidateName,
				candidateState,
				"intake candidate field to status",
				6,
			);
			// Keep the confirm control below the candidate row even when its action
			// intentionally shares the row edge; a negative gap would indicate overlap.
			await assertRectGap(
				candidateRow,
				importPreview.locator(".button").last(),
				"intake candidate row to confirm button",
				0,
			);
			await page
				.locator("#backup-password")
				.fill("spacing-consistency-password");
			await page
				.locator(".intake-backup-card > .actions .button")
				.first()
				.click();
			await expect(page.locator(".intake-backup-status")).not.toHaveText(
				variant.locale === "zh-CN" ? "空闲" : "Idle",
			);
			await expect(
				page.getByRole("link", {
					name:
						variant.locale === "zh-CN" ? "保存备份文件" : "Save backup file",
					exact: true,
				}),
			).toBeVisible();
			await captureIntakeEvidence(page, variant, "backup-status");
			await assertNoHorizontalOverflow(page, "intake");
			await assertRectGap(
				page.locator(".intake-primary-grid"),
				page.locator(".intake-recent"),
				"intake primary grid to recent card",
				8,
			);
			await assertRectGap(
				page.locator(".intake-review-card"),
				page.locator(".intake-restored > details.intake-secondary"),
				"intake review card to ExternalLink import",
				8,
			);
			await assertSiblingGaps(
				page,
				".intake-primary-grid > .card",
				"intake primary cards",
				8,
			);
			const backup = page.locator(".intake-backup-card");
			const passwordField = backup.locator(".field").first();
			const backupActions = backup.locator(":scope > .actions").first();
			const status = backup.locator(".intake-backup-status");
			await assertRectGap(
				passwordField,
				backupActions,
				"backup password to actions",
				8,
			);
			await assertRectGap(backupActions, status, "backup actions to status", 8);
			const downloadLink = page.getByRole("link", {
				name: variant.locale === "zh-CN" ? "保存备份文件" : "Save backup file",
				exact: true,
			});
			const downloadEvent = page.waitForEvent("download");
			await downloadLink.click();
			const backupFile = await downloadEvent;
			const backupPath = await backupFile.path();
			if (!backupPath) throw new Error("spacing-backup-download-path-missing");
			const restore = backup.locator("details").first();
			await restore.locator("summary").click();
			await restore.locator("#restore-file").setInputFiles(backupPath);
			await restore
				.getByRole("button", { name: copy.preview, exact: true })
				.click();
			await expect(restore.locator("[role=status]")).toBeVisible();
			await captureIntakeEvidence(page, variant, "restore-preview");
			const restoreSummary = restore.locator("summary");
			await assertRectGap(
				restoreSummary,
				restore.locator(":scope > .field").first(),
				"restore summary to fields",
				8,
			);
			const location = backup.locator("details").nth(1);
			await location.locator("summary").click();
			await expect(location.locator("#remote-put-url")).toBeVisible();
			await assertFormGeometry(location, "backup location controls");
			await assertNoHorizontalOverflow(
				page,
				"intake after restore and location expansion",
			);
		} finally {
			await context.close();
		}
	});
}

for (const variant of [
	{ locale: "zh-CN", width: 1280 },
	{ locale: "en-US", width: 390 },
] as const) {
	test(`${variant.locale} ${variant.width}px settings sections, MCP and AI pricing keep spacing`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		const page = await context.newPage();
		try {
			await page.goto("/settings");
			await page
				.locator("main.settings-restored")
				.waitFor({ state: "visible" });
			await assertNoHorizontalOverflow(page, "settings initial");
			await assertSiblingGaps(
				page,
				".settings-restored > .card-grid > .card",
				"settings storage cards",
				8,
			);

			const assistant = page.locator("#assistant");
			if ((await assistant.getAttribute("open")) === null)
				await assistant.locator("summary").click();
			await expect(assistant.locator(".mcp-panel")).toBeVisible();
			await assertFormGeometry(
				assistant.locator(".mcp-panel"),
				"settings MCP panel",
			);
			await assertSiblingGaps(page, ".mcp-panel > *", "MCP panel sections", 8);
			await assistant
				.getByRole("button", {
					name: variant.locale === "zh-CN" ? "提问助手" : "Ask assistant",
					exact: true,
				})
				.click();
			const ai = page.getByRole("dialog");
			await assertFormGeometry(ai, "AI question dialog");
			await assertRectGap(
				ai.locator(".ai-request-footer > .field"),
				ai.locator(".ai-request-footer > .actions"),
				"AI request footer field to actions",
				8,
			);
			await ai.locator("details.ai-pricing > summary").click();
			await assertFormGeometry(ai, "AI pricing fields");
			await assertRectGap(
				ai.locator(".ai-request-footer > .field"),
				ai.locator(".ai-request-footer > .actions"),
				"AI request footer field to actions",
				8,
			);
			await assertRectGap(
				ai.locator(".ai-pricing > summary"),
				ai.locator(".ai-pricing > p"),
				"AI pricing summary to hint",
				8,
			);
			await page.screenshot({
				path: `${evidenceRoot}/spacing-ai-${variant.locale}-${variant.width}.png`,
			});
			await ai
				.getByRole("button", {
					name: variant.locale === "zh-CN" ? "关闭" : "Close",
					exact: true,
				})
				.click();
			await expect(ai).toBeHidden();

			await expect(page.locator("#connections, .sync-panel, .binding-panel, .key-access-panel, .migration-panel")).toHaveCount(0);
			await assertSiblingGaps(
				page,
				".settings-section-body > .card.padded",
				"settings nested cards",
				8,
			);
			await assertNoHorizontalOverflow(page, "settings local sections");
			await page.screenshot({
				path: `${evidenceRoot}/spacing-settings-${variant.locale}-${variant.width}.png`,
				fullPage: true,
			});
		} finally {
			await context.close();
		}
	});
}

for (const variant of variants) {
	test(`${variant.locale} ${variant.width}px forms and card grids keep field and action spacing`, async ({
		browser,
	}) => {
		const copy = copyFor(variant.locale);
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		const page = await context.newPage();
		try {
			const suffix = "L".repeat(110);
			const projectName = `Spacing project ${variant.locale}-${variant.width} ${suffix}`;
			const accountName = `Spacing account ${variant.locale}-${variant.width} ${suffix}`;
			const itemName = `Spacing item ${variant.locale}-${variant.width} ${suffix}`;
			const subscriptionName = `Spacing subscription ${variant.locale}-${variant.width} ${suffix}`;
			const projectDialog = await createAsset(
				page,
				copy,
				"project",
				projectName,
			);
			await assertFormGeometry(projectDialog, "project asset editor");
			const projectId = await saveAndFindAsset(
				page,
				projectDialog,
				copy,
				projectName,
			);
			const accountDialog = await createAsset(
				page,
				copy,
				"account",
				accountName,
			);
			await assertFormGeometry(accountDialog, "account asset editor");
			const accountId = await saveAndFindAsset(
				page,
				accountDialog,
				copy,
				accountName,
			);
			const itemDialog = await createAsset(page, copy, "item", itemName);
			await assertFormGeometry(itemDialog, "item asset editor");
			const itemId = await saveAndFindAsset(page, itemDialog, copy, itemName);
			const subscriptionDialog = await createAsset(
				page,
				copy,
				"subscription",
				subscriptionName,
				accountId,
			);
			await assertFormGeometry(subscriptionDialog, "subscription asset editor");
			const subscriptionId = await saveAndFindAsset(
				page,
				subscriptionDialog,
				copy,
				subscriptionName,
			);

			await page.goto("/");
			await waitForApp(page);
			await assertNoHorizontalOverflow(page, "overview");
			await assertSiblingGaps(
				page,
				".overview-stats > .card",
				"overview stat cards",
				8,
			);
			await assertSiblingGaps(
				page,
				".overview-panels > .overview-panel",
				"overview panels",
				8,
			);
			await assertSiblingGaps(
				page,
				".overview-project-grid > .overview-project-card",
				"overview project cards",
				8,
			);

			await page.goto(`/assets/project/${projectId}`);
			await page
				.getByRole("button", { name: copy.addConnection, exact: true })
				.click();
			const relation = page.getByRole("dialog");
			await assertFormGeometry(relation, "relation editor");
			await selectChoice(relation.locator("#relation-target"), {
				value: accountId,
			});
			await relation.locator("#relation-label").fill("Spacing relation");
			await relation.locator("#relation-source").fill("Spacing source");
			await relation.locator("#relation-verified").fill("2026-09-30");
			await assertFormGeometry(relation, "filled relation editor");
			await relation
				.getByRole("button", { name: copy.save, exact: true })
				.click();
			await expect(relation).toBeHidden();
			await page.getByRole("button", { name: copy.addConnection, exact: true }).click();
			await selectChoice(relation.locator("#relation-target"), { value: subscriptionId });
			await relation.locator("#relation-label").fill("Project subscription");
			await relation.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(relation).toBeHidden();
			const subscriptions = page.locator(".asset-project-linked-subscriptions");
			await subscriptions.locator("summary").click();
			const subscriptionRow = subscriptions.getByRole("link");
			await expect(subscriptionRow).toContainText(subscriptionName);
			expect(await subscriptionRow.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Linked subscription names wrap inside the detail card").toBe(true);
			await assertNoHorizontalOverflow(page, "project relation detail");
			await assertSiblingGaps(
				page,
				".asset-detail > .card",
				"asset detail cards",
				8,
			);

			await page.goto(`/assets/item/${itemId}`);
			await page
				.getByRole("button", { name: copy.itemEditLocation, exact: true })
				.click();
			const location = page.getByRole("dialog");
			await assertFormGeometry(location, "item location editor");
			await assertNoHorizontalOverflow(page, "item detail location dialog");
			await location
				.getByRole("button", {
					name: variant.locale === "zh-CN" ? "取消" : "Cancel",
					exact: true,
				})
				.click();
			await expect(location).toBeHidden();
			await page
				.locator(".asset-tasks-card")
				.getByRole("button", { name: copy.add, exact: true })
				.click();
			const task = page.getByRole("dialog");
			await assertFormGeometry(task, "ordinary task editor");
			await assertNoHorizontalOverflow(page, "ordinary task dialog");
			await task
				.getByRole("button", {
					name: variant.locale === "zh-CN" ? "取消" : "Cancel",
					exact: true,
				})
				.click();
			await expect(task).toBeHidden();
			await page.goto("/tasks");
			await page
				.getByRole("button", { name: copy.newTask, exact: true })
				.click();
			const globalTask = page.getByRole("dialog");
			await assertFormGeometry(globalTask, "global ordinary task editor");
			await globalTask
				.getByRole("button", {
					name: variant.locale === "zh-CN" ? "取消" : "Cancel",
					exact: true,
				})
				.click();

			await page.goto("/finance");
			await assertNoHorizontalOverflow(page, "finance");
			await assertSiblingGaps(
				page,
				".finance-summary > .card",
				"finance summary cards",
				8,
			);
			await page
				.getByRole("button", { name: copy.financeRecord, exact: true })
				.click();
			const finance = page.getByRole("dialog");
			await assertFormGeometry(finance, "finance record editor");
			await assertNoHorizontalOverflow(page, "finance record dialog");
			await finance
				.getByRole("button", {
					name: variant.locale === "zh-CN" ? "取消" : "Cancel",
					exact: true,
				})
				.click();
			await expect(finance).toBeHidden();
			await page.goto(`/assets/subscription/${subscriptionId}`);
			await assertNoHorizontalOverflow(page, "subscription detail");
		} finally {
			await context.close();
		}
	});
}
