import { createMaintenanceSchedule } from "../../packages/domain/src/task-repeat";
import { buildProjectWorkflowTasks } from "../../packages/domain/src/project-workflow";
import { detailHistoryRows } from "../../apps/web/src/unified-detail-data";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import {
	newAsset,
	projectDomainSchema,
	type Asset,
	type History,
} from "../../packages/domain/src";
import { acceptanceCandidate } from "./helpers/acceptance-candidate";
import {
	prepareCompletionArchive,
	restoreCompletionArchive,
} from "./helpers/completion-archive";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { unzipSync, strFromU8 } from "fflate";
import { importVisualKdbxEntries } from "./fixtures/password-smart-import-visual";

const password = "Unified-Details-Fictional-only-2026";
const stamp = "2026-11-05T00:00:00.000Z";
type Locale = "zh-CN" | "en";
type Kind = "ordinary" | "item" | "subscription" | "wallet";
const kinds: Kind[] = ["ordinary", "item", "subscription", "wallet"];
const names: Record<Kind, string> = {
	ordinary: "UD Fictional studio / 虚构工作室",
	item: "UD Fictional camera / 虚构相机",
	subscription: "UD Fictional monthly / 虚构月付",
	wallet: "UD Fictional card / 虚构储值卡",
};
const ids: Record<Kind, string> = {
	ordinary: "ud-ordinary",
	item: "ud-item",
	subscription: "ud-subscription",
	wallet: "ud-wallet",
};
const paths: Record<Kind, string> = {
	ordinary: "/assets",
	item: "/assets/item",
	subscription: "/assets/subscription",
	wallet: "/cards",
};
const tFor = (locale: Locale) => (key: string) =>
	(resources[locale].translation as Record<string, string>)[key];
const identity = () =>
	acceptanceCandidate().release.webFiles.find(
		(file) => file.path === "index.html",
	)!.sha256;
let fixture: string;
let categoryId: string;
let domainId: string;

test.beforeAll(async ({}, info) => {
	fixture = resolve(
		process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/unified-asset-details",
		`fixture-${info.workerIndex}`,
	);
	const result = await prepareCompletionArchive(
		fixture,
		password,
		async (db) => {
			const category = await db.saveCatalogCategory(null, {
				name: "UD 虚构资料 / Fictional records",
			});
			const photoBytes = readFileSync("apps/web/public/samples/laptop.png");
			const photos: string[] = [];
			for (const name of ["cover", "detail", "receipt", "other"])
				photos.push(
					await db.putFile(
						new File([photoBytes], `ud-${name}.png`, { type: "image/png" }),
					),
				);
			const base = (kind: Asset["kind"], id: string, name: string): Asset => ({
				...newAsset(kind),
				id,
				name,
				createdAt: stamp,
				updatedAt: stamp,
			});
			const ordinary = {
				...base("project", ids.ordinary, names.ordinary),
				catalogCategoryId: category.id,
				url: "https://fictional.example.test/studio",
				description: "UD description / 完整描述",
				notes: "UD notes / 完整备注",
				tags: ["fictional", "虚构"],
				attachments: photos.slice(0, 3),
				projectMedia: {
					logoId: photos[0],
					homeScreenshotId: photos[1],
					productScreenshotIds: [photos[2]],
					promoCoverId: "",
				},
				projectTitle: "Preserved historical title",
				longDescription: "UD retained long description",
			};
			const item = {
				...base("item", ids.item, names.item),
				category: "electronics",
				description: "UD item description / 实物描述",
				notes: "UD item notes / 实物备注",
				amount: 480000,
				currency: "CNY" as const,
				itemPurchasePriceKnown: true,
				purchaseDate: "2026-05-20",
				warrantyDate: "2027-05-20",
				itemStartDate: "2026-05-20",
				itemWarrantyStatus: "inWarranty" as const,
				location: "书房 / Study",
				itemLifecycleStatus: "inUse" as const,
				attachments: photos.slice(0, 3),
				itemMedia: {
					coverId: photos[0],
					detailIds: [photos[1]],
					receiptIds: [photos[2]],
				},
			};
			const subscription = {
				...base("subscription", ids.subscription, names.subscription),
				category: "software",
				url: "https://fictional.example.test/notes",
				description: "UD subscription description / 订阅描述",
				notes: "UD subscription notes / 订阅备注",
				amount: 2800,
				currency: "CNY" as const,
				cycle: "month" as const,
				dueDate: "2026-11-28",
				subscriptionStartDate: "2026-03-28",
				billingAnchor: "2026-11-28",
				attachments: photos.slice(0, 3),
			};
			const wallet = {
				...base("project", ids.wallet, names.wallet),
				description: "UD wallet description / 卡包描述",
				notes: "UD wallet notes / 卡包备注",
				dueDate: "2027-05-31",
				walletCard: {
					type: "storedValue" as const,
					issuer: "UD Fictional Coffee / 虚构咖啡",
					lastFour: "0826",
					balanceMinor: 26800,
					remainingUses: null,
				},
				attachments: photos.slice(0, 3),
			};
			const neighbors = Array.from({ length: 8 }, (_, index) => ({
				...base(
					index === 0 ? "account" : "project",
					`ud-neighbor-${index}`,
					`UD Neighbor ${index + 1} / 关联资料 ${index + 1}`,
				),
				catalogCategoryId: index === 0 ? undefined : category.id,
				username: index === 0 ? "fictional@example.test" : "",
			}));
			const minimal = kinds.map((kind) => ({
				...base(
					kind === "ordinary" || kind === "wallet" ? "project" : kind,
					`ud-minimal-${kind}`,
					`UD Minimal ${kind}`,
				),
				...(kind === "wallet"
					? {
							walletCard: {
								type: "membership" as const,
								issuer: "",
								lastFour: "",
								balanceMinor: null,
								remainingUses: null,
							},
						}
					: {}),
				...(kind === "ordinary" ? { catalogCategoryId: category.id } : {}),
			}));
			const long = kinds.map((kind) => ({
				...base(
					kind === "ordinary" || kind === "wallet" ? "project" : kind,
					`ud-long-${kind}`,
					`UD Long ${kind} / 长标题 `.repeat(6).slice(0, 155),
				),
				description: "UD long description 长描述 ".repeat(250),
				notes: "UD long notes 长备注 ".repeat(150),
				url: "https://fictional.example.test/" + "long-path/".repeat(70),
				tags: ["长标签 long tag ".repeat(3)],
				attachments: photos,
				...(kind === "wallet"
					? {
							walletCard: {
								type: "countPass" as const,
								issuer: "UD long issuer 长发行方 ".repeat(7),
								lastFour: "9876",
								balanceMinor: 0,
								remainingUses: 12,
							},
						}
					: {}),
				...(kind === "ordinary" ? { catalogCategoryId: category.id } : {}),
			}));
			const foreign = {
				...base("subscription", "ud-foreign", "UD Foreign pending"),
				amount: 2000,
				currency: "EUR" as const,
				dueDate: "2026-12-15",
			};
			const cancelled = {
				...base("subscription", "ud-cancelled", "UD Cancelled subscription"),
				amount: 2800,
				status: "cancelled" as const,
				dueDate: "2026-12-15",
			};
			const loaned = {
				...base("item", "ud-loaned", "UD Already loaned"),
				status: "loaned" as const,
				borrower: "Fictional borrower",
				itemExpectedReturnDate: "2027-01-01",
			};
			const repairing = {
				...base("item", "ud-repairing", "UD Under repair"),
				itemLifecycleStatus: "repairing" as const,
			};
			const archived = {
				...base("item", "ud-archived", "UD Archived item"),
				status: "archived" as const,
			};
			const walletKinds = (["membership", "countPass", "gift"] as const).map(
				(type, index) => ({
					...base("project", `ud-wallet-${type}`, `UD Wallet ${type}`),
					dueDate: "2027-04-01",
					walletCard: {
						type,
						issuer: "UD Issuer",
						lastFour: index === 0 ? "" : "1038",
						balanceMinor: type === "gift" ? 12000 : null,
						remainingUses: type === "countPass" ? 3 : null,
					},
				}),
			);
			const domain = projectDomainSchema.parse({
				id: crypto.randomUUID(),
				name: "historical.example.test",
				registrar: "UD Registrar",
				expiryDate: "2027-03-01",
				annualAmount: 5000,
				currency: "CNY",
				autoRenew: "off",
				catalog: {
					categoryId: category.id,
					name: "UD Historical domain",
					url: "https://historical.example.test",
					tags: ["domain"],
					status: "active",
					notes: "UD historical domain note",
					attachments: [photos[0]],
					deleted: false,
				},
			});
			const legacy = {
				...base("project", "ud-legacy", "UD Legacy owner"),
				category: "legacy",
				description: "UD legacy description",
				projectTitle: "UD legacy protected title",
				attachments: [photos[0]],
				projectDomains: [domain],
			};
			const retiredVault = base(
				"vault",
				"ud-retired-vault",
				"UD Retired vault reference",
			);
			const deleted = {
				...base("project", "ud-deleted", "UD Deleted record"),
				deleted: true,
			};
			const dateEdges = [
				{
					...base("subscription", "v7-due-today", "V7 Due today"),
					dueDate: "2026-11-05",
					subscriptionStartDate: "2026-11-06",
				},
				{
					...base("subscription", "v7-overdue", "V7 Overdue"),
					dueDate: "2026-11-03",
					subscriptionStartDate: "2026-11-01",
				},
				{
					...base("item", "v7-no-warranty", "V7 Warranty not applicable"),
					warrantyDate: "2027-05-20",
					itemWarrantyStatus: "notApplicable" as const,
				},
				{
					...base("item", "v7-out-warranty", "V7 Already out of warranty"),
					warrantyDate: "2027-05-20",
					itemWarrantyStatus: "outOfWarranty" as const,
				},
			];
			const rows = [
				...dateEdges,
				ordinary,
				item,
				subscription,
				wallet,
				...neighbors,
				...minimal,
				...long,
				foreign,
				cancelled,
				loaned,
				repairing,
				archived,
				...walletKinds,
				legacy,
				retiredVault,
				deleted,
			];
			await db.saveBatch(
				rows.map((value) => ({
					type: "asset" as const,
					value:
						value.kind === "item" &&
						["ud-loaned", "ud-repairing", "ud-archived"].includes(value.id)
							? {
									...value,
									status: "active",
									borrower: "",
									itemExpectedReturnDate: "",
									itemLifecycleStatus: "inUse",
								}
							: value,
				})),
			);
			const loanBase = (await db.get<Asset>("asset", "ud-loaned"))!;
			await db.recordItemAction(
				loanBase,
				{
					...loanBase,
					status: "loaned",
					borrower: "Fictional borrower",
					itemExpectedReturnDate: "2027-01-01",
					lastItemEventId: "ud-fixture-loan",
					updatedAt: stamp,
				},
				{
					id: "ud-fixture-loan",
					assetId: loanBase.id,
					action: "loan",
					borrower: "Fictional borrower",
					expectedReturnDate: "2027-01-01",
					eventDate: "2026-11-05",
					note: "Synthetic fixture state preparation",
					createdAt: stamp,
					deleted: false,
				},
			);
			const repairBase = (await db.get<Asset>("asset", "ud-repairing"))!;
			await db.recordItemAction(
				repairBase,
				{
					...repairBase,
					itemLifecycleStatus: "repairing",
					itemStatusDate: "2026-11-05",
					lastItemEventId: "ud-fixture-repair",
					updatedAt: stamp,
				},
				{
					id: "ud-fixture-repair",
					assetId: repairBase.id,
					action: "itemStatus",
					itemStatusBefore: "inUse",
					itemStatusAfter: "repairing",
					eventDate: "2026-11-05",
					note: "Synthetic fixture state preparation",
					createdAt: stamp,
					deleted: false,
				},
			);
			await db.setItemArchived("ud-archived", "active");
			const relations = kinds.flatMap((kind) =>
				neighbors.map((neighbor, index) => ({
					id: `ud-relation-${kind}-${index}`,
					from: ids[kind],
					to: neighbor.id,
					label: `UD link ${index + 1}`,
					createdAt: stamp,
					verifiedAt: index % 2 ? "" : stamp,
					deleted: false,
				})),
			);
			relations.push({
				id: "ud-preserved-task-link",
				from: ids.ordinary,
				to: ids.item,
				label: "UD near asset",
				createdAt: stamp,
				verifiedAt: "",
				deleted: false,
			});
			await db.saveBatch(
				relations.map((value) => ({ type: "relation" as const, value })),
			);
			const histories: History[] = [
				{
					id: "ud-item-history",
					assetId: ids.item,
					action: "maintenance",
					note: "UD historical maintenance",
					eventDate: "2026-10-01",
					createdAt: "2026-10-01T00:00:00.000Z",
					deleted: false,
				},
				{
					id: "ud-renewal-history",
					assetId: ids.subscription,
					action: "renew",
					note: "UD historical renewal",
					billDate: "2026-10-28",
					amount: 2800,
					currency: "CNY",
					createdAt: "2026-10-28T00:00:00.000Z",
					deleted: false,
				},
				{
					id: "ud-shared-history",
					assetId: ids.ordinary,
					assetIds: [ids.ordinary, ids.wallet],
					action: "expense",
					note: "UD shared fee",
					title: "UD shared receipt",
					eventDate: "2026-09-01",
					amount: 1000,
					currency: "CNY",
					createdAt: "2026-09-01T00:00:00.000Z",
					deleted: false,
				},
				{
					id: "ud-corrected-renewal",
					assetId: ids.subscription,
					action: "renew",
					note: "UD original corrected note",
					billDate: "2026-09-28",
					amount: 2800,
					currency: "CNY",
					createdAt: "2026-09-28T00:00:00.000Z",
					deleted: false,
					financeCorrection: {
						note: "UD corrected visible note",
						eventDate: "2026-09-28",
						amount: 2100,
						currency: "CNY",
						hidden: false,
						assetIds: [ids.ordinary, ids.wallet],
					},
				},
				{
					id: "ud-hidden-renewal",
					assetId: ids.subscription,
					action: "renew",
					note: "UD hidden original",
					billDate: "2026-08-28",
					amount: 2800,
					currency: "CNY",
					createdAt: "2026-08-28T00:00:00.000Z",
					deleted: false,
					financeCorrection: {
						note: "UD hidden receipt",
						eventDate: "2026-08-28",
						amount: 2800,
						currency: "CNY",
						hidden: true,
						assetIds: [ids.ordinary],
					},
				},
			];
			await db.saveBatch(
				histories.map((value) => ({ type: "history" as const, value })),
			);
			await db.save("task", {
				id: "ud-retained-task",
				assetId: ids.item,
				name: "UD retained task",
				dueDate: "2026-12-01",
				createdAt: stamp,
			});
			for (const kind of kinds) {
				const existing = detailHistoryRows(histories, ids[kind]).length;
				for (let index = existing; index < 8; index++)
					await db.save("history", {
						id: `v7-history-${kind}-${index}`,
						assetId: ids[kind],
						action: kind === "subscription" ? "renew" : "maintenance",
						note:
							kind === "subscription"
								? `到期延至 / Due extended · 2026-${String(11 - index).padStart(2, "0")}-28`
								: `检查资料 / Checked record ${index + 1}`,
						eventDate: `2026-${String(10 - index).padStart(2, "0")}-20`,
						createdAt: `2026-${String(10 - index).padStart(2, "0")}-20T00:00:00.000Z`,
						amount: kind === "subscription" ? 2800 : undefined,
						currency: kind === "subscription" ? "CNY" : undefined,
						deleted: false,
					});
				for (let index = kind === "item" ? 1 : 0; index < 3; index++)
					await db.save("task", {
						id: `v7-task-${kind}-${index}`,
						assetId: ids[kind],
						name: `V7 ${kind} ${index === 2 ? "已核对凭证 / Checked receipt" : "检查当前资料 / Check details"} ${index}`,
						dueDate: `2026-11-${index === 2 ? "01" : "08"}`,
						done: index === 2,
						completedAt: index === 2 ? stamp : "",
						createdAt: stamp,
						dedupeKey: `v7-${kind}-${index}`,
						deleted: false,
					});
			}
			const complexItem = {
				...base("item", "v7-complex-item", "V7 complex maintenance camera"),
			};
			const complexProject = {
				...base("project", "v7-complex-project", "V7 complex workflow project"),
				catalogCategoryId: category.id,
			};
			await db.save("asset", complexItem);
			await db.save("asset", complexProject);
			await db.save("task", {
				id: "v7-complex-maintenance",
				name: "V7 recurring lens inspection",
				assetId: complexItem.id,
				dueDate: "2026-11-08",
				done: false,
				completedAt: "",
				createdAt: stamp,
				dedupeKey: "v7-complex-maintenance",
				deleted: false,
				maintenancePlan: {
					active: true,
					schedule: createMaintenanceSchedule({
						dueDate: "2026-11-08",
						leadDays: 2,
						rule: { mode: "fixed", every: 1, unit: "month" },
					}),
					records: [],
					deferredUntil: "",
				},
			});
			const workflow = buildProjectWorkflowTasks({
				project: complexProject,
				assets: [complexProject],
				relations: [],
				submissions: [],
				kind: "brand",
				proposal: {
					proposedName: "V7 proposed fictional brand",
					proposedDescription: "",
					proposedUrl: "",
					changeNote: "V7 fictional verification",
				},
				roundId: crypto.randomUUID(),
				at: stamp,
				title: (step, name) => `V7 workflow ${step} ${name}`,
			});
			for (const task of workflow)
				await db.save("task", { ...task, dueDate: "2026-11-08" });
			return {
				categoryId: category.id,
				domainId: domain.id,
				photoIds: photos,
				ids,
			};
		},
	);
	categoryId = result.categoryId;
	domainId = result.domainId;
});

async function start(page: Page, locale: Locale) {
	await page.addInitScript(
		(language) => {
			localStorage.setItem("keepany-language", language);
			// Keep natural browser performance/rAF/DocumentTimeline clocks aligned.
			// Playwright's clock retained performance time across full navigations,
			// placing native WAAPI startTime many seconds in the future.
			const Original = Date;
			let fixed = Original.parse("2026-11-05T04:00:00Z");
			Object.assign(window, { __keepanyV7SetNow: (next: number) => { fixed = next; } });
			window.Date = new Proxy(Original, {
				construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [fixed], newTarget); },
				apply(target) { return new target(fixed).toString(); },
				get(target, key, receiver) { return key === "now" ? () => fixed : Reflect.get(target, key, receiver); },
			});
		},
		locale,
	);
	await page.goto("/assets");
	await expect(page.locator(".workspace-navigation")).toBeVisible();
	expect(
		createHash("sha256")
			.update(await (await page.request.get("/")).body())
			.digest("hex"),
	).toBe(identity());
	await restoreCompletionArchive(
		page,
		password,
		resolve(fixture, "fixture.ka1"),
	);
	await page.goto("/assets");
	await expect(
		page.locator(".asset-summary-card").filter({ hasText: names.ordinary }),
	).toBeVisible();
}
async function enter(
	page: Page,
	kind: Kind,
	variant: "normal" | "minimal" | "long" = "normal",
) {
	await page.goto(paths[kind]);
	const needle =
		variant === "normal"
			? names[kind]
			: variant === "minimal"
				? `UD Minimal ${kind}`
				: `UD Long ${kind}`;
	const card = page.locator(".asset-summary-card").filter({ hasText: needle });
	await expect(card).toHaveCount(1);
	await card.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("heading", { level: 1 })).toContainText(needle);
	await expect(page.locator(".topbar-back-link")).toHaveAttribute(
		"href",
		paths[kind],
	);
	const main = page.locator("main.unified-asset-detail");
	return main;
}
async function screenshot(page: Page, info: TestInfo, name: string) {
	// Observe the rendered state, including the next React commit and natural
	// animations. A click resolving does not prove a portal or reveal is visible.
	if (/^(ordinary|item|subscription|wallet)-menu$/.test(name)) {
		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByRole("menuitem").first()).toBeVisible();
		await expect.poll(() => menu.evaluate((element) => {
			for (let current: Element | null = element; current; current = current.parentElement) {
				if (Number(getComputedStyle(current).opacity) < 0.999) return false;
			}
			const rect = element.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
		})).toBe(true);
	}
	if (/^(ordinary|item|subscription|wallet)-editor$/.test(name)) {
		await expect(page.getByRole("dialog").locator("#name, #catalog-record-name")).toBeVisible();
	}
	await expect.poll(() => page.locator(".unified-detail-header,.ui-menu,.dialog").evaluateAll(elements => elements.flatMap(element => element.getAnimations({ subtree: true })).filter(animation => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	const taskForms = page.locator(".unified-detail-tasks form");
	if (await taskForms.count()) await taskForms.last().scrollIntoViewIfNeeded();
	await expect.poll(() => page.locator(".unified-detail-tasks form").evaluateAll((forms) => forms.every(form => {
		for (let current: Element | null = form; current; current = current.parentElement) {
			if (Number(getComputedStyle(current).opacity) < 0.999) return false;
		}
		return true;
	}))).toBe(true);
	const file = info.outputPath(`${name}.png`);
	await page.screenshot({ path: file, fullPage: false });
	await info.attach(`${name}.png`, { path: file, contentType: "image/png" });
	return file;
}
async function receipt(
	info: TestInfo,
	ids: string[],
	extra: Record<string, unknown> = {},
) {
	await info.attach("contract-results.json", {
		body: JSON.stringify({
			ids,
			candidate: identity(),
			result: "passed",
			...extra,
		}),
		contentType: "application/json",
	});
}
async function exportRows(page: Page, locale: Locale) {
	const t = tFor(locale);
	await page.goto("/backup");
	const card = page.locator(".intake-backup-card");
	await card.locator("#backup-password").fill(password);
	await card.getByRole("button", { name: t("backup"), exact: true }).click();
	const link = card.getByRole("link", {
		name: t("saveBackupFile"),
		exact: true,
	});
	await expect(link).toBeVisible();
	const event = page.waitForEvent("download");
	await link.click();
	const downloaded = await event;
	const file = await downloaded.path();
	if (!file) throw Error("Backup download missing");
	const zip = unzipSync(await decryptBackup(readFileSync(file), password));
	return (
		JSON.parse(strFromU8(zip["records.json"])) as {
			type: string;
			payload: string;
		}[]
	).map((row) => ({ ...row, value: JSON.parse(row.payload) }));
}
async function selectOption(page: Page, selector: string, name: string) {
	await page.locator(selector).click();
	await page.getByRole("option", { name, exact: true }).click();
}
async function uploadThroughButton(
	page: Page,
	button: import("@playwright/test").Locator,
	file: string,
) {
	const event = page.waitForEvent("filechooser");
	await button.click();
	await (await event).setFiles(file);
}
async function geometry(page: Page) {
	const result = await page.evaluate(() => ({
		width: innerWidth,
		scrollWidth: document.documentElement.scrollWidth,
		graph: document.querySelectorAll("main.unified-asset-detail .graph").length,
		folds: document.querySelectorAll(
			"main.unified-asset-detail details,main.unified-asset-detail summary",
		).length,
		boxes: Array.from(
			document.querySelectorAll(
				".unified-detail-main,.unified-detail-history,.unified-detail-tasks",
			),
		).map((el) => {
			const b = el.getBoundingClientRect();
			return {
				class: el.className,
				x: b.x,
				right: b.right,
				y: b.y,
				bottom: b.bottom,
				width: b.width,
				height: b.height,
			};
		}),
	}));
	expect(result.scrollWidth).toBeLessThanOrEqual(result.width + 1);
	expect(result.graph).toBe(0);
	expect(result.folds).toBe(0);
	expect(result.boxes).toHaveLength(3);
	for (const box of result.boxes) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.right).toBeLessThanOrEqual(result.width + 1);
	}
	return result;
}

test("V701 V709 approved eight history three tasks first screen", async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await start(page, "zh-CN");
	for (const kind of kinds) {
		await enter(page, kind);
		await page.evaluate(() => scrollTo(0, 0));
		await expect(page.locator(".unified-detail-events > li")).toHaveCount(8);
		await expect(
			page.locator(".unified-detail-task-list .task-card"),
		).toHaveCount(3);
		const measurements = await geometry(page);
		await screenshot(page, info, `first-screen-${kind}`);
		for (const box of measurements.boxes)
			expect(
				box.bottom,
				`${kind} ${box.class} inside first screen`,
			).toBeLessThanOrEqual(1080);
		const font = await page
			.locator(".unified-detail-events > li")
			.first()
			.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		expect(font).toBeGreaterThanOrEqual(15);
	}
	await receipt(info, ["V701", "V709"]);
});

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 1280, 1920, 1991, 2262])
		test(`${locale} ${width} V710 four types state matrix`, async ({
			page,
		}, info) => {
			const t = tFor(locale);
			await page.setViewportSize({ width, height: 1080 });
			await start(page, locale);
			for (const kind of kinds) {
				await enter(page, kind);
				await geometry(page);
				await screenshot(page, info, `${kind}-default`);
				for (const selector of [
					".unified-detail-description",
					".unified-detail-history",
					".unified-detail-tasks",
				]) {
					await page.locator(selector).scrollIntoViewIfNeeded();
					await screenshot(page, info, `${kind}-${selector.slice(16)}`);
				}
				const edit = page
					.locator(".unified-detail-header")
					.getByRole("button", { name: t("edit"), exact: true });
				await edit.scrollIntoViewIfNeeded();
				await edit.hover();
				await screenshot(page, info, `${kind}-hover`);
				await page.mouse.move(0, 0);
				await edit.focus();
				await screenshot(page, info, `${kind}-focus`);
				const box = await edit.boundingBox();
				await page.mouse.move(
					box!.x + box!.width / 2,
					box!.y + box!.height / 2,
				);
				await page.mouse.down();
				await screenshot(page, info, `${kind}-pressed`);
				await page.mouse.up();
				await expect(page.getByRole("dialog")).toBeVisible();
				await screenshot(page, info, `${kind}-editor`);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("cancel"), exact: true })
					.click();
				await page
					.locator(".unified-detail-header")
					.getByRole("button", { name: t("moreActions"), exact: true })
					.click();
				await screenshot(page, info, `${kind}-menu`);
				await page.keyboard.press("ArrowDown");
				await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("menuitem");
				await page.keyboard.press("Escape");
				await expect(page.getByRole("menu")).toBeHidden();
			}
			for (const kind of kinds) {
				await enter(page, kind, "minimal");
				await geometry(page);
				await screenshot(page, info, `${kind}-minimal`);
				await enter(page, kind, "long");
				await geometry(page);
				await screenshot(page, info, `${kind}-long`);
				await page
					.locator(".unified-detail-description")
					.scrollIntoViewIfNeeded();
				await screenshot(page, info, `${kind}-long-description`);
			}
			await receipt(info, ["V701", "V710"], { locale, width, matrix: true, stableMenus: true });
		});

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} V703 all four editors cancel error save and reload`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		for (const kind of kinds) {
			await enter(page, kind);
			await expect(page.locator(".unified-asset-detail")).toBeVisible();
			await page.getByRole("button", { name: t("edit"), exact: true }).click();
			let dialog = page.getByRole("dialog");
			const input = dialog.locator(
				kind === "ordinary" || kind === "wallet"
					? "#catalog-record-name"
					: "#name",
			);
			await input.fill("UD cancelled edit");
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await expect(page.getByRole("heading", { level: 1 })).toContainText(
				names[kind],
			);
			for (const width of [390, 768, 1280, 1920, 1991, 2262]) {
				await page.setViewportSize({ width, height: 720 });
				await page.getByRole("button", { name: t("edit"), exact: true }).click();
				dialog = page.getByRole("dialog");
				await input.fill("");
				await dialog.getByRole("button", { name: t("save"), exact: true }).click();
				await expect(input).toHaveAttribute("aria-invalid", "true");
				await expect(input).toBeFocused();
				await expect(input).toBeInViewport({ ratio: 1 });
				const error = dialog.locator(`#${await input.getAttribute("id")}-error`);
				await expect(error).toBeInViewport({ ratio: 1 });
				await screenshot(page, info, `${kind}-required-error-${width}`);
				// Editing another field clears its error without stealing focus.
				const notes = dialog.locator("textarea").first();
				await notes.fill("V7 cancelled focus check");
				await expect(notes).toBeFocused();
				await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
			}
			await page.getByRole("button", { name: t("edit"), exact: true }).click();
			dialog = page.getByRole("dialog");
			await input.fill(`${names[kind]} edited`);
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await expect(page.getByRole("heading", { level: 1 })).toContainText(
				`${names[kind]} edited`,
			);
		}
		await receipt(info, ["V701", "V703"], { locale, errorWidths: [390, 768, 1280, 1920, 1991, 2262], errorHeight: 720 });
	});
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} V704 album original preview cancel add replace remove and role persistence`, async ({
		page,
	}, info) => {
		const t = tFor(locale),
			photo = resolve("apps/web/public/samples/laptop.png");
		await start(page, locale);
		for (const kind of kinds) {
			await enter(page, kind);
			const description = page.locator(".unified-detail-description"),
				figures = description.locator("figure");
			const initial = 3;
			await expect(figures).toHaveCount(initial);
			const popupEvent = page.waitForEvent("popup");
			await figures.first().getByRole("link").click();
			const popup = await popupEvent;
			await expect(popup.locator("img")).toBeVisible();
			await popup.close();
			await uploadThroughButton(
				page,
				description.locator("button").filter({ hasText: t("addPhoto") }),
				photo,
			);
			let preview = page.getByRole("dialog");
			await expect(preview.locator(".image-preview")).toBeVisible();
			await screenshot(page, info, `${kind}-photo-preview`);
			await preview
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await expect(figures).toHaveCount(initial);
			await uploadThroughButton(
				page,
				description.locator("button").filter({ hasText: t("addPhoto") }),
				photo,
			);
			preview = page.getByRole("dialog");
			await expect(
				preview.getByRole("button", { name: t("confirm"), exact: true }),
			).toBeEnabled();
			await preview
				.getByRole("button", { name: t("confirm"), exact: true })
				.click();
			await expect(preview).toBeHidden();
			await expect(figures).toHaveCount(initial + 1);
			await page.reload();
			await expect(figures).toHaveCount(initial + 1);
			await figures
				.first()
				.getByRole("button", { name: new RegExp(t("moreActions")) })
				.click();
			const oldSource = await figures
				.first()
				.locator("img")
				.getAttribute("src");
			await uploadThroughButton(
				page,
				page.getByRole("menuitem", { name: t("replaceImage"), exact: true }),
				photo,
			);
			preview = page.getByRole("dialog");
			await preview
				.getByRole("button", { name: t("confirm"), exact: true })
				.click();
			await expect(preview).toBeHidden();
			await expect(figures).toHaveCount(initial + 1);
			await page.keyboard.press("Escape");
			await expect(figures.first().locator("img")).not.toHaveAttribute(
				"src",
				oldSource!,
			);
			await figures
				.first()
				.getByRole("button", { name: new RegExp(t("moreActions")) })
				.click();
			await page
				.getByRole("menuitem", { name: t("removeImage"), exact: true })
				.click();
			await expect(figures).toHaveCount(initial);
			await page.reload();
			await expect(figures).toHaveCount(initial);
			await screenshot(page, info, `${kind}-album-saved`);
		}
		const rows = await exportRows(page, locale);
		const ordinary = rows.find(
				(row) => row.type === "asset" && row.value.id === ids.ordinary,
			)!.value as Asset,
			item = rows.find(
				(row) => row.type === "asset" && row.value.id === ids.item,
			)!.value as Asset;
		expect(ordinary.projectTitle).toBe("Preserved historical title");
		expect(ordinary.projectMedia.logoId).toBe("");
		expect(ordinary.attachments).toContain(
			ordinary.projectMedia.homeScreenshotId,
		);
		expect(
			ordinary.projectMedia.productScreenshotIds.every((id) =>
				ordinary.attachments.includes(id),
			),
		).toBe(true);
		expect(item.itemMedia.coverId).toBe("");
		expect(item.itemMedia.detailIds).toHaveLength(1);
		expect(item.itemMedia.receiptIds).toHaveLength(1);
		expect(
			item.itemMedia.detailIds.every((id) => item.attachments.includes(id)),
		).toBe(true);
		expect(
			item.itemMedia.receiptIds.every((id) => item.attachments.includes(id)),
		).toBe(true);
		expect(
			rows.some(
				(row) => row.type === "task" && row.value.id === "ud-retained-task",
			),
		).toBe(true);
		await receipt(info, ["V704"], { locale });
	});
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} V708 real item location status loan return maintenance and reload`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		await enter(page, "item");
		const main = page.locator(".unified-asset-detail");
		await main
			.getByRole("button", { name: t("itemEditLocation"), exact: true })
			.click();
		let dialog = page.getByRole("dialog");
		await dialog.getByLabel(t("itemLocationArea"), { exact: true }).fill("");
		await dialog
			.getByLabel(t("itemLocationContainer"), { exact: true })
			.fill("Box");
		await dialog
			.getByRole("button", { name: t("itemSaveLocation"), exact: true })
			.click();
		await expect(dialog.getByRole("alert")).toBeVisible();
		await screenshot(page, info, "location-invalid");
		await dialog
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await expect(main.locator(".unified-detail-info")).toContainText(
			"书房 / Study",
		);
		await main
			.getByRole("button", { name: t("itemEditLocation"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByLabel(t("itemLocationArea"), { exact: true })
			.fill("UD Room");
		await dialog
			.getByLabel(t("itemLocationContainer"), { exact: true })
			.fill("UD Box");
		await dialog
			.getByLabel(t("itemLocationSpot"), { exact: true })
			.fill("UD Top");
		await dialog
			.getByRole("button", { name: t("itemSaveLocation"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await page.reload();
		await expect(main.locator(".unified-detail-info")).toContainText("UD Room");
		await main
			.locator(".unified-detail-header")
			.getByRole("button", { name: t("moreActions"), exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: t("itemStatusChange"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await selectOption(page, "#item-lifecycle-status", t("itemStatus_idle"));
		await dialog
			.getByRole("button", { name: t("itemStatusSave"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await page.reload();
		await expect(main.locator(".unified-detail-state")).toContainText(
			t("itemStatus_idle"),
		);
		await main
			.getByRole("button", { name: t("detailRecordActivity"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: t("loan"), exact: true }).click();
		await expect(dialog.getByRole("alert")).toContainText(
			t("borrowerRequired"),
		);
		await screenshot(page, info, "borrower-required");
		await dialog
			.getByLabel(t("borrower"), { exact: true })
			.fill("UD Cancelled borrower");
		await dialog.getByRole("button", { name: t("close"), exact: true }).click();
		await expect(main.locator(".unified-detail-info")).not.toContainText(
			"UD Cancelled borrower",
		);
		await main
			.getByRole("button", { name: t("detailRecordActivity"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByLabel(t("borrower"), { exact: true })
			.fill("UD Fictional borrower");
		await dialog
			.getByLabel(t("loanReturnNote"), { exact: true })
			.fill("UD lent after check");
		await dialog.getByRole("button", { name: t("loan"), exact: true }).click();
		await expect(dialog).toBeHidden();
		await page.reload();
		await expect(main.locator(".unified-detail-info")).toContainText(
			"UD Fictional borrower",
		);
		await expect(main.locator(".unified-detail-history")).toContainText(
			"UD lent after check",
		);
		await main
			.getByRole("button", { name: t("detailRecordActivity"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByLabel(t("loanReturnNote"), { exact: true })
			.fill("UD returned and checked");
		await dialog
			.getByRole("button", { name: t("return"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await main
			.getByRole("button", { name: t("detailRecordActivity"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByRole("button", { name: t("maintenance"), exact: true })
			.click();
		await expect(dialog.getByRole("alert")).toContainText(
			t("maintenanceNoteRequired"),
		);
		await dialog
			.getByLabel(t("maintenanceNotes"), { exact: true })
			.fill("UD cleaned lens");
		await dialog
			.getByRole("button", { name: t("maintenance"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await screenshot(page, info, "maintenance-success");
		await page.reload();
		await expect(main.locator(".unified-detail-history")).toContainText(
			"UD returned and checked",
		);
		await expect(main.locator(".unified-detail-history")).toContainText(
			"UD cleaned lens",
		);
		await expect(main.locator('a[href="/tasks"]')).toHaveCount(0);
		await expect(main).toContainText("UD retained task");
		await page.goto("/assets/item");
		await page
			.locator(".asset-summary-card")
			.filter({ hasText: "UD Under repair" })
			.click();
		await page
			.getByRole("button", { name: t("detailRecordActivity"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("button", { name: t("loan"), exact: true }),
		).toBeDisabled();
		await screenshot(page, info, "repairing-disabled");
		await dialog.getByRole("button", { name: t("close"), exact: true }).click();
		await receipt(info, ["V708"], { locale });
	});

	test(`${locale} V708 renewal cancel invalid success inactive and CNY missing`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		await enter(page, "subscription");
		const main = page.locator(".unified-asset-detail");
		await main.getByRole("button", { name: t("renew"), exact: true }).click();
		let dialog = page.getByRole("dialog");
		await dialog
			.getByRole("textbox", { name: t("notes"), exact: true })
			.fill("UD cancelled renewal");
		await dialog.getByRole("button", { name: t("close"), exact: true }).click();
		await expect(main.locator(".unified-detail-history")).not.toContainText(
			"UD cancelled renewal",
		);
		await main.getByRole("button", { name: t("renew"), exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog.locator(".renewal-amount-field input").fill("-1");
		await dialog.getByRole("button", { name: t("renew"), exact: true }).click();
		await expect(dialog.getByRole("alert")).toBeVisible();
		expect(await dialog.getByRole('alert').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
        await screenshot(page, info, "renewal-invalid");
		await dialog.locator(".renewal-amount-field input").fill("29.25");
		await dialog
			.getByRole("textbox", { name: t("notes"), exact: true })
			.fill("UD actual local renewal");
		await dialog.getByRole("button", { name: t("renew"), exact: true }).click();
		await expect(dialog).toBeHidden();
		await page.reload();
		await expect(main.locator(".unified-detail-history")).toContainText(
			"UD actual local renewal",
		);
		await expect(main.locator(".unified-detail-history")).toContainText(
			"29.25",
		);
		await expect(main.locator("[data-metric=remaining]")).toContainText("2026");
		for (const name of ["UD Foreign pending", "UD Cancelled subscription"]) {
			await page.goto("/assets/subscription");
			if (name === "UD Cancelled subscription") {
				await page
					.getByRole("combobox", { name: t("assetStatusView"), exact: true })
					.click();
				await page.getByRole("option", { name: t("all"), exact: true }).click();
			}
			await page
				.locator(".asset-summary-card")
				.filter({ hasText: name })
				.click();
			await expect(
				page.getByRole("button", { name: t("renew"), exact: true }),
			).toBeDisabled();
			await screenshot(
				page,
				info,
				name === "UD Foreign pending" ? "renewal-no-cny" : "renewal-cancelled",
			);
		}
		const rows = await exportRows(page, locale);
		const subscription = rows.find(
			(row) => row.type === "asset" && row.value.id === ids.subscription,
		)!.value as Asset;
		expect(subscription.dueDate).toBe("2026-12-28");
		expect(subscription.renewalCount).toBe(1);
		expect(
			rows.filter(
				(row) =>
					row.type === "history" &&
					row.value.assetId === ids.subscription &&
					row.value.note === "UD actual local renewal",
			),
		).toHaveLength(1);
		await receipt(info, ["V708"], { locale });
	});
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} V705 accounts navigate and manage relations preserving IDs`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		for (const kind of kinds) {
			await enter(page, kind);
			const origin = page.url();
			await page.locator(".unified-detail-account-links a").first().click();
			await expect(page).toHaveURL(/assets\/account\/ud-neighbor-0$/);
			await page.locator(".topbar-back-link").click();
			await expect(page).toHaveURL(origin);
			await expect(page.locator(".unified-asset-detail")).toBeVisible();
			const open = async () => {
				await page
					.getByRole("button", { name: t("catalogRelated"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeVisible();
			};
			await open();
			await page
				.getByRole("button", { name: t("addRelation"), exact: true })
				.click();
			let dialog = page.getByRole("dialog");
			await expect(
				dialog.getByRole("button", { name: t("save"), exact: true }),
			).toBeDisabled();
			await dialog.locator("#detail-relation-target").click();
			await expect(
				page.getByRole("option", {
					name: "UD Retired vault reference",
					exact: true,
				}),
			).toHaveCount(0);
			await expect(
				page.getByRole("option", { name: "UD Deleted record", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("option", {
					name: "UD Neighbor 2 / 关联资料 2",
					exact: true,
				}),
			).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(dialog).toBeVisible();
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await open();
			await page
				.getByRole("button", { name: t("addRelation"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await selectOption(
				page,
				"#detail-relation-target",
				"UD Neighbor 2 / 关联资料 2",
			);
			await dialog.locator("#detail-relation-label").fill("UD link 2");
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog.getByRole("alert")).toBeVisible();
			await screenshot(page, info, `${kind}-relation-duplicate`);
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await open();
			await page
				.getByRole("button", { name: t("addRelation"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await selectOption(
				page,
				"#detail-relation-target",
				"UD Minimal ordinary",
			);
			await dialog.locator("#detail-relation-label").fill(`V7 manual ${kind}`);
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await open();
			const row = page
				.locator(".unified-detail-link-list > div")
				.filter({ hasText: `V7 manual ${kind}` });
			await expect(row).toHaveCount(1);
			await row
				.getByRole("button", { name: t("deleteRelation"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await open();
			await row
				.getByRole("button", { name: t("deleteRelation"), exact: true })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("deleteRelation"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await open();
			await expect(row).toHaveCount(0);
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("close"), exact: true })
				.click();
		}
		const rows = await exportRows(page, locale);
		for (const kind of kinds)
			expect(
				rows.filter(
					(row) =>
						row.type === "relation" &&
						!row.value.deleted &&
						row.value.from === ids[kind] &&
						row.value.to === "ud-neighbor-0",
				),
			).toHaveLength(1);
		await receipt(info, ["V705", "V711"], { locale });
	});
	test(`${locale} V706 V707 tasks save cancel duplicate complete reopen and bell focus`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		for (const kind of kinds) {
			await enter(page, kind);
			const tasks = page.locator(".unified-detail-tasks");
			await tasks.getByRole("button", { name: t("add"), exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.locator("#taskName").fill("V7 cancelled task");
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await expect(tasks).not.toContainText("V7 cancelled task");
			await tasks.getByRole("button", { name: t("add"), exact: true }).click();
			dialog = page.getByRole("dialog");
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog.locator("#taskName")).toHaveAttribute(
				"aria-invalid",
				"true",
			);
			await screenshot(page, info, `${kind}-task-error`);
			await dialog.locator("#taskName").fill(`V7 added ${kind}`);
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const row = tasks
				.locator(".task-card")
				.filter({ hasText: `V7 added ${kind}` });
			await expect(row).toHaveCount(1);
			await row
				.getByRole("button", { name: t("moreActions"), exact: true })
				.click();
			await page
				.getByRole("menuitem", { name: t("edit"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#taskName").fill(`V7 edited ${kind}`);
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			const edited = tasks
				.locator(".task-card")
				.filter({ hasText: `V7 edited ${kind}` });
			await edited
				.getByRole("button", { name: t("complete"), exact: true })
				.click();
			await expect(
				edited.getByRole("button", { name: t("reopen"), exact: true }),
			).toBeVisible();
			await page.reload();
			await edited
				.getByRole("button", { name: t("reopen"), exact: true })
				.click();
			await expect(
				edited.getByRole("button", { name: t("complete"), exact: true }),
			).toBeVisible();
		}
		await page.goto("/");
		await page.locator("#reminder-bell").click();
		const item = page.locator(
			'[data-reminder-id="task-v7-task-subscription-0"]',
		);
		await expect(item).toHaveAttribute("data-read", "false");
		await item.click();
		await expect(page).toHaveURL(
			/subscription\/ud-subscription#reminder-task-v7-task-subscription-0$/,
		);
		const target = page.locator("#task-v7-task-subscription-0");
		await expect(target).toBeFocused();
		await expect(
			target.getByRole("button", { name: t("complete"), exact: true }),
		).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await screenshot(page, info, "bell-focused-task");
		await page.locator("#reminder-bell").click();
		await expect(item).toHaveAttribute("data-read", "true");
		await page.keyboard.press("Escape");
		await page.reload();
		await expect(target).toBeFocused();
		await page.goto(
			"/assets/subscription/ud-subscription#reminder-task-missing",
		);
		await expect(
			page.getByText(t("reminderEntryMissing"), { exact: true }),
		).toBeVisible();
		await screenshot(page, info, "missing-task");
		for (const fragment of [
			"reminder-task-%E0%A4%A",
			"reminder-task-v7-task-wallet-0",
		]) {
			await page.goto(`/assets/subscription/ud-subscription#${fragment}`);
			await expect(
				page.getByText(t("reminderEntryMissing"), { exact: true }),
			).toBeVisible();
			await expect(
				page.locator("#asset-detail-tasks-ud-subscription"),
			).toBeFocused();
		}

		const rows = await exportRows(page, locale);
		expect(
			rows.find(
				(row) =>
					row.type === "task" && row.value.id === "v7-task-subscription-0",
			)!.value.done,
		).toBe(false);
		await receipt(info, ["V706", "V707"], { locale });
	});
	test(`${locale} V704 rejects invalid type empty oversize and decode without writing`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		for (const kind of kinds) {
			await enter(page, kind);
			const photos = page.locator(".unified-detail-photo");
			await expect(photos).toHaveCount(3);
			const input = page.locator("main input[type=file]");
			for (const file of [
				{
					name: "v7-invalid.txt",
					mimeType: "text/plain",
					buffer: Buffer.from("invalid"),
				},
				{
					name: "v7-empty.png",
					mimeType: "image/png",
					buffer: Buffer.alloc(0),
				},
				{
					name: "v7-oversize.png",
					mimeType: "image/png",
					buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
				},
			]) {
				await input.setInputFiles(file);
				await expect(page.getByRole("dialog")).toHaveCount(0);
				await expect(
					page.getByText(t("uploadError"), { exact: true }),
				).toBeVisible();
				await expect(photos).toHaveCount(3);
			}
			await input.setInputFiles({
				name: "v7-undecodable.png",
				mimeType: "image/png",
				buffer: Buffer.from("not a valid PNG"),
			});
			const dialog = page.getByRole("dialog");
			await expect(
				dialog.getByText(t("uploadError"), { exact: true }),
			).toBeVisible();
			await expect(
				dialog.getByRole("button", { name: t("confirm"), exact: true }),
			).toBeDisabled();
			await screenshot(page, info, `${kind}-image-decode-error`);
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await page.reload();
			await expect(photos).toHaveCount(3);
		}
		await receipt(info, ["V704"], { locale });
	});
}

test("V702 real dates future missing inactive and edit persistence", async ({
	page,
}, info) => {
	const t = tFor("en");
	await start(page, "en");
	await enter(page, "item");
	await expect(page.locator("[data-metric=remaining] strong")).toHaveText(
		"196",
	);
	await expect(page.locator("[data-metric=elapsed] strong")).toHaveText("169");
	await enter(page, "subscription");
	await expect(page.locator("[data-metric=remaining] strong")).toHaveText("23");
	await expect(page.locator("[data-metric=elapsed] strong")).toHaveText("222");
	await page
		.locator(".unified-detail-header")
		.getByRole("button", { name: t("edit"), exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	const field = dialog.locator("#subscriptionStartDate");
	await expect(field).toBeVisible();
	await screenshot(page, info, "subscription-real-start-editor");
	await dialog.getByRole("button", { name: t("save"), exact: true }).click();
	await expect(dialog).toBeHidden();
	await page.reload();
	await expect(page.locator("[data-metric=elapsed] strong")).toHaveText("222");
	await enter(page, "item", "minimal");
	await expect(page.locator("[data-metric=elapsed]")).toContainText(
		t("detailStartMissing"),
	);
	await expect(page.locator("[data-metric=elapsed] strong")).toHaveCount(0);
	for (const [kind, name, label] of [
		["subscription", "V7 Due today", "detailDueToday"],
		["subscription", "V7 Overdue", "detailOverdue"],
		["item", "V7 Warranty not applicable", "itemWarranty_notApplicable"],
		["item", "V7 Already out of warranty", "itemWarranty_outOfWarranty"],
	] as const) {
		await page.goto(`/assets/${kind}`);
		await page.locator(".asset-summary-card").filter({ hasText: name }).click();
		await expect(page.locator("[data-metric=remaining]")).toContainText(
			t(label),
		);
		if (kind === "item")
			await expect(page.locator("[data-metric=remaining] strong")).toHaveCount(
				0,
			);
		if (name === "V7 Due today")
			await expect(page.locator("[data-metric=elapsed]")).toContainText(
				t("detailStartsIn"),
			);
		await screenshot(page, info, name.replaceAll(" ", "-"));
	}
	await receipt(info, ["V702"]);
});

test("V711 stale photo preview rejects concurrent edits without losing newer fields", async ({
	page,
	context,
}, info) => {
	const t = tFor("en"),
		photo = resolve("apps/web/public/samples/laptop.png");
	await start(page, "en");
	for (const kind of kinds) {
		await enter(page, kind);
		const origin = page.url(),
			count = await page.locator(".unified-detail-photo").count();
		await uploadThroughButton(
			page,
			page
				.locator(".unified-detail-media-actions")
				.getByRole("button", { name: t("addPhoto"), exact: true }),
			photo,
		);
		const preview = page.getByRole("dialog");
		await expect(
			preview.getByRole("button", { name: t("confirm"), exact: true }),
		).toBeEnabled();
		const other = await context.newPage();
		await other.goto(origin);
		await other
			.locator(".unified-detail-header")
			.getByRole("button", { name: t("edit"), exact: true })
			.click();
		const editor = other.getByRole("dialog");
		await editor
			.locator(
				kind === "ordinary" || kind === "wallet"
					? "#catalog-record-name"
					: "#name",
			)
			.fill(`${names[kind]} concurrent`);
		await editor.getByRole("button", { name: t("save"), exact: true }).click();
		await expect(editor).toBeHidden();
		await expect(page.locator(".unified-detail-header h1")).toContainText(
			"concurrent",
		);
		await preview
			.getByRole("button", { name: t("confirm"), exact: true })
			.click();
		await expect(preview).toBeVisible();
		await expect(
			page.getByText(t("assetStale"), { exact: true }),
		).toBeVisible();
		await screenshot(page, info, `${kind}-stale-image`);
		await preview
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await page.reload();
		await expect(page.getByRole("heading", { level: 1 })).toContainText(
			"concurrent",
		);
		await expect(page.locator(".unified-detail-photo")).toHaveCount(count);
		await other.close();
	}
	await receipt(info, ["V711"]);
});

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 1920])
		test(`${locale} ${width} V710 lazy task editor loading error recovery`, async ({
			browser,
		}, info) => {
			const baseURL = String(info.project.use.baseURL),
				t = tFor(locale),
				pattern = /\/assets\/workflow-task-editor-[^/]+\.js(?:\?|$)/;
			const context = await browser.newContext({
				baseURL,
				viewport: { width, height: 1080 },
				serviceWorkers: "block",
			});
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			let intercepted = 0;
			try {
				const page = await context.newPage();
				await page.route(pattern, async (route) => {
					intercepted++;
					await held;
					await route.abort("failed");
				});
				await start(page, locale);
				await enter(page, "ordinary");
				await page
					.locator(".unified-detail-tasks")
					.getByRole("button", { name: t("add"), exact: true })
					.click();
				await expect.poll(() => intercepted).toBe(1);
				await expect(
					page.locator(".unified-detail-tasks").getByRole("status"),
				).toContainText(t("loading"));
				await screenshot(page, info, "task-editor-loading");
				release();
				await expect(
					page.locator('[data-testid="route-load-error"]'),
				).toHaveAttribute("data-error-kind", "module-load");
				await screenshot(page, info, "task-editor-resource-error");
				await page.unroute(pattern);
				await page
					.getByRole("button", { name: t("pageLoadErrorReload"), exact: true })
					.click();
				await expect(page.getByRole("heading", { level: 1 })).toContainText(
					names.ordinary,
				);
				await page
					.locator(".unified-detail-tasks")
					.getByRole("button", { name: t("add"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeVisible();
				await screenshot(page, info, "task-editor-recovered");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("cancel"), exact: true })
					.click();
				await receipt(info, ["V710"], {
					locale,
					width,
					states: ["loading", "resource-error", "reloaded"],
				});
			} finally {
				release?.();
				await context.close();
			}
		});

for (const locale of ["zh-CN", "en"] as const)
	test(`${locale} V710 specialized action dialogs at four widths`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		for (const width of [390, 768, 1280, 1920]) {
			await page.setViewportSize({ width, height: 1080 });
			await enter(page, "item");
			await page
				.getByRole("button", { name: t("detailRecordActivity"), exact: true })
				.click();
			let dialog = page.getByRole("dialog");
			await screenshot(page, info, `item-activity-${width}`);
			const fields = await dialog.locator(".field").evaluateAll((elements) =>
				elements.map((el) => {
					const r = el.getBoundingClientRect();
					return { w: r.width, left: r.left, right: r.right };
				}),
			);
			for (const field of fields)
				expect(field.w).toBeGreaterThanOrEqual(width === 390 ? 200 : 150);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).toBe(true);
			await dialog
				.getByRole("button", { name: t("loan"), exact: true })
				.click();
			await expect(dialog.getByRole("alert")).toContainText(
				t("borrowerRequired"),
			);
			await screenshot(page, info, `item-activity-error-${width}`);
			await dialog
				.getByRole("button", { name: t("close"), exact: true })
				.click();
			await enter(page, "subscription");
			await page.getByRole("button", { name: t("renew"), exact: true }).click();
			dialog = page.getByRole("dialog");
			await screenshot(page, info, `subscription-activity-${width}`);
			const amount = await dialog
				.locator(".renewal-amount-field input")
				.boundingBox();
			expect(amount!.width).toBeGreaterThanOrEqual(150);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).toBe(true);
			await dialog
				.getByRole("button", { name: t("close"), exact: true })
				.click();
			await enter(page, "ordinary");
			await page
				.getByRole("button", { name: t("catalogRelated"), exact: true })
				.click();
			await page
				.getByRole("button", { name: t("addRelation"), exact: true })
				.click();
			dialog = page.getByRole("dialog");
			await selectOption(
				page,
				"#detail-relation-target",
				"UD Neighbor 2 / 关联资料 2",
			);
			await dialog.locator("#detail-relation-label").fill("UD link 2");
			await dialog
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(dialog.getByRole("alert")).toBeVisible();
			await screenshot(page, info, `relation-error-${width}`);
			await dialog
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
		}
		await receipt(info, ["V705", "V708", "V710"], {
			locale,
			actionWidths: [390, 768, 1280, 1920],
		});
	});

for (const locale of ["zh-CN", "en"] as const)
	test(`${locale} V711 ordinary private and overview graphs retain default labels`, async ({
		page,
	}, info) => {
		const t = tFor(locale),
			master = "UD-Fictional-Account-Master-2026";
		await start(page, locale);
		await page.goto("/accounts");
		await page.locator("#password-vault-master").fill(master);
		await page.locator("#password-vault-master-confirm").fill(master);
		await page
			.getByRole("button", { name: t("accountSetUp"), exact: true })
			.click();
		await page
			.locator(".account-toolbar-actions")
			.getByRole("button", { name: t("add"), exact: true })
			.click();
		await page.locator("#password-vault-entry-title").fill("UD normal account");
		await page
			.locator("#password-vault-entry-username")
			.fill("ud-normal@example.test");
		await page
			.locator("#password-vault-entry-password")
			.fill("UD fictional secret only");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: t("save"), exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
		const card = page
			.locator(".compact-account-card")
			.filter({ hasText: "UD normal account" });
		await card.locator(".compact-account-title-block").click();
		await expect(page.locator(".graph")).toHaveAttribute(
			"data-layout-ready",
			"true",
		);
		await expect(page.locator(".graph.account-graph-wrap-labels")).toHaveCount(
			0,
		);
		await screenshot(page, info, "ordinary-account-graph");
		await page.locator(".topbar-back-link").click();
		await importVisualKdbxEntries(page, t, [
			{
				title: "UD private account",
				username: "ud-private@example.test",
				password: "UD fictional private secret",
				linkedAssetIds: [ids.ordinary],
			},
		]);
		await page
			.locator(".compact-account-card")
			.filter({ hasText: "UD private account" })
			.locator(".compact-account-title-block")
			.click();
		await expect(page.locator(".graph")).toHaveAttribute(
			"data-layout-ready",
			"true",
		);
		await expect(page.locator(".graph.account-graph-wrap-labels")).toHaveCount(
			0,
		);
		await expect(page.locator(".graph .react-flow__node")).toHaveCount(2);
		await screenshot(page, info, "private-account-graph");
		await page.getByRole("navigation").locator('a[href="/"]').click();
		await expect(page.locator(".overview-page .graph")).toHaveAttribute(
			"data-layout-ready",
			"true",
		);
		await expect(
			page.locator(".overview-page .graph.account-graph-wrap-labels"),
		).toHaveCount(0);
		await screenshot(page, info, "overview-default-labels");
		await page.getByRole("navigation").locator('a[href="/accounts"]').click();
		await page
			.locator(".account-toolbar-actions")
			.getByRole("button", { name: t("pwVaultLock"), exact: true })
			.click();
		await expect(page.locator("#password-vault-unlock-master")).toBeVisible();
		await screenshot(page, info, "account-locked-after-detail");
		await enter(page, "item");
		await expect(page.locator(".unified-detail-tasks")).toBeVisible();
		await page.getByTestId("reminder-bell").click();
		await page.locator('[data-reminder-id="task-ud-retained-task"]').click();
		const reminder = page.locator("#task-ud-retained-task");
		await expect(reminder).toContainText("UD retained task");
		await expect(reminder).toBeFocused();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await screenshot(page, info, "bell-linked-task-open");
		await reminder
			.getByRole("button", { name: t("complete"), exact: true })
			.click();
		await expect(
			reminder.getByRole("button", { name: t("reopen"), exact: true }),
		).toBeVisible();
		await page.reload();
		await expect(
			reminder.getByRole("button", { name: t("reopen"), exact: true }),
		).toBeVisible();
		await screenshot(page, info, "bell-linked-task-completed");
		await receipt(info, ["V711"], { locale });
	});

test("V701 domain projection and V711 card variants remain real", async ({
	page,
}, info) => {
	await start(page, "en");
	await page.goto("/assets");
	await page
		.locator(".asset-summary-card")
		.filter({ hasText: "UD Historical domain" })
		.click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"UD Historical domain",
	);
	await expect(page.locator(".unified-detail-description")).toContainText(
		"UD historical domain note",
	);
	await page
		.getByRole("button", { name: tFor("en")("edit"), exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog
		.locator("#catalog-record-name")
		.fill("UD Historical domain edited");
	await dialog
		.getByRole("button", { name: tFor("en")("save"), exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"UD Historical domain edited",
	);
	for (const type of ["membership", "countPass", "gift"]) {
		await page.goto("/cards");
		await page
			.locator(".asset-summary-card")
			.filter({ hasText: `UD Wallet ${type}` })
			.click();
		await expect(page.locator(".unified-asset-detail")).toBeVisible();
		await screenshot(page, info, `wallet-${type}`);
		if (type === "countPass")
			await expect(page.locator(".unified-detail-info")).toContainText("3");
		if (type === "gift")
			await expect(page.locator(".unified-detail-info")).toContainText(
				"120.00",
			);
	}
	await page.goto("/records/asset:ud-does-not-exist");
	await expect(
		page.getByText(tFor("en")("noMatches"), { exact: true }),
	).toBeVisible();
	await receipt(info, ["V701", "V711"]);
});

test("V701 category and all-list return origins; V711 overview account and legacy consumers", async ({
	page,
}, info) => {
	const t = tFor("en");
	await page.setViewportSize({ width: 1920, height: 1080 });
	await start(page, "en");
	await page.goto("/assets");
	await page
		.locator(`.workspace-navigation a[href="/assets/category/${categoryId}"]`)
		.click();
	await page
		.locator(".asset-summary-card")
		.filter({ hasText: names.ordinary })
		.click();
	await expect(page.locator(".topbar-back-link")).toHaveAttribute(
		"href",
		`/assets/category/${categoryId}`,
	);
	await page.reload();
	await expect(page.locator(".topbar-back-link")).toHaveAttribute(
		"href",
		`/assets/category/${categoryId}`,
	);
	await page.locator(".topbar-back-link").click();
	await expect(page).toHaveURL(new RegExp(`/assets/category/${categoryId}$`));
	for (const kind of ["item", "subscription", "wallet"] as const) {
		await page.goto("/assets");
		await page
			.locator(".asset-summary-card")
			.filter({ hasText: names[kind] })
			.click();
		await expect(page.locator(".topbar-back-link")).toHaveAttribute(
			"href",
			"/assets",
		);
		await page.locator(".topbar-back-link").click();
		await expect(page).toHaveURL(/\/assets$/);
	}
	await enter(page, "ordinary");
	await page
		.getByRole("button", { name: t("detailMoreInfo"), exact: true })
		.click();
	await expect(page.locator(".unified-detail-project-extras")).toBeVisible();
	await expect(page.locator(".asset-project-profile-card")).toContainText(
		"https://fictional.example.test/studio",
	);
    await page.locator('#project-detail-extras').getByRole('button',{name:t('close'),exact:true}).click();
    await expect(page.locator('.unified-asset-detail .graph')).toHaveCount(0);
    await page.getByRole('button',{name:t('catalogRelated'),exact:true}).click();
    await expect(page.locator('.unified-detail-link-list')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:t('addRelation'),exact:true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:t('close'),exact:true}).click();
	await screenshot(page, info, "legacy-consumer");
	await page.goto("/");
	await expect(page.locator(".overview-page .graph")).toHaveAttribute(
		"data-layout-ready",
		"true",
	);
	await screenshot(page, info, "overview-consumer");
	await page.goto("/accounts");
	await expect(page.locator("#password-vault-master")).toBeVisible();
	await screenshot(page, info, "accounts-locked-consumer");
	await receipt(info, ["V701", "V711"]);
});

test("V702 V708 renewal history records local day and immutable extended due date", async ({
	page,
}, info) => {
	const t = tFor("en");
	await start(page, "en");
	await enter(page, "subscription");
	await page.evaluate(timestamp => {
		const setNow = Reflect.get(window, "__keepanyV7SetNow");
		if (typeof setNow !== "function") throw Error("Missing date-only test clock");
		setNow(timestamp);
	}, new Date("2026-11-04T16:30:00Z").getTime());
	await page
		.locator(".unified-detail-header")
		.getByRole("button", { name: t("renew"), exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog
		.getByRole("textbox", { name: t("notes"), exact: true })
		.fill("V7 local midnight renewal");
	await dialog.getByRole("button", { name: t("renew"), exact: true }).click();
	await expect(dialog).toBeHidden();
	await page.reload();
	const row = page
		.locator(".unified-detail-events > li")
		.filter({ hasText: "V7 local midnight renewal" });
	await expect(row.locator("time")).toHaveAttribute("datetime", "2026-11-05");
	await expect(row).toContainText("Dec 28, 2026");
	const records = await exportRows(page, "en");
	const history = records.find(
		(row) =>
			row.type === "history" && row.value.note === "V7 local midnight renewal",
	)!.value;
	expect(history).toMatchObject({
		billDate: "2026-11-28",
		renewalDueDate: "2026-12-28",
		amount: 2800,
	});
	await receipt(info, ["V702", "V708"]);
});

for (const locale of ["zh-CN", "en"] as const)
	test(`${locale} V706 V707 V710 complex maintenance and workflow preserve layouts and settled focus`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		for (const width of [390, 768, 1280, 1920]) {
			await page.setViewportSize({ width, height: 1080 });
			await page.goto("/assets/item");
			await page
				.locator(".asset-summary-card")
				.filter({ hasText: "V7 complex maintenance camera" })
				.click();
			const maintenance = page.locator("#task-v7-complex-maintenance");
			await expect(maintenance).toHaveCSS("display", "block");
			for (let count = 0; count < 2; count++) {
				await page.locator("#reminder-bell").click();
				await page
					.locator('[data-reminder-id="task-v7-complex-maintenance"]')
					.click();
				await expect(page.getByTestId("reminder-center")).toBeHidden();
				await expect(maintenance).toBeFocused();
				await expect
					.poll(() =>
						page.evaluate(() => ({
							active: document.activeElement?.id,
							popup: !!document.querySelector(
								'[data-testid="reminder-center"]',
							),
						})),
					)
					.toEqual({ active: "task-v7-complex-maintenance", popup: false });
			}
			await maintenance
				.locator(".maintenance-task-actions")
				.first()
				.getByRole("button")
				.first()
				.click();
			await expect(
				maintenance.locator(".maintenance-action-form"),
			).toBeVisible();
			await screenshot(page, info, `maintenance-expanded-${width}`);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width + 1);
			await maintenance
				.locator(".maintenance-action-form")
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await page.goto("/assets");
			await page
				.locator(".asset-summary-card")
				.filter({ hasText: "V7 complex workflow project" })
				.click();
			const workflow = page.locator(".project-workflow-task").first();
			const id = await workflow.getAttribute("id");
			await page.locator("#reminder-bell").click();
			await page.locator(`[data-reminder-id="${id}"]`).click();
			await expect(page.getByTestId("reminder-center")).toBeHidden();
			await expect(workflow).toBeFocused();
			await expect(workflow).toHaveCSS("display", "grid");
			await workflow.locator(".project-workflow-task-footer button").click();
			await expect(workflow.locator("textarea")).toBeVisible();
			await screenshot(page, info, `workflow-expanded-${width}`);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width + 1);
			await workflow
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
		}
		await page.goto("/assets/item");
		await page
			.locator(".asset-summary-card")
			.filter({ hasText: "V7 complex maintenance camera" })
			.click();
		const maintenance = page.locator("#task-v7-complex-maintenance");
		await maintenance
			.locator(".maintenance-task-actions")
			.first()
			.getByRole("button")
			.first()
			.click();
		await maintenance.locator("textarea").fill("V7 verified lens service");
		await maintenance
			.locator(".maintenance-action-form button[type=submit]")
			.click();
		await expect(maintenance.locator("textarea")).toHaveCount(0);
		await page.reload();
		await maintenance.locator(".maintenance-history > summary").click();
		await expect(maintenance.locator(".maintenance-history")).toContainText(
			"V7 verified lens service",
		);
		await screenshot(page, info, "maintenance-saved-history");
		await receipt(info, ["V706", "V707", "V710", "V711"], {
			locale,
			complex: true,
		});
	});

test("V708 activity forms reject a changed billing period and concurrent maintenance", async ({
	page,
	context,
}, info) => {
	const t = tFor("en");
	await start(page, "en");
	await enter(page, "subscription");
	await page
		.locator(".unified-detail-header")
		.getByRole("button", { name: t("renew"), exact: true })
		.click();
	const a = page.getByRole("dialog");
	await a
		.getByRole("textbox", { name: t("notes"), exact: true })
		.fill("V7 stale renewal must not save");
	const other = await context.newPage();
	await other.goto("/assets/subscription/ud-subscription");
	await other
		.locator(".unified-detail-header")
		.getByRole("button", { name: t("renew"), exact: true })
		.click();
	const b = other.getByRole("dialog");
	await b
		.getByRole("textbox", { name: t("notes"), exact: true })
		.fill("V7 other page renewal");
	await b.getByRole("button", { name: t("renew"), exact: true }).click();
	await expect(b).toBeHidden();
	await expect(page.locator("[data-metric=remaining]")).toContainText(
		"Dec 28, 2026",
	);
	await a.getByRole("button", { name: t("renew"), exact: true }).click();
	await expect(a).toBeVisible();
	await expect(
		page.getByText(t("renewalStale"), { exact: true }),
	).toBeVisible();
	await screenshot(page, info, "stale-renewal-preserved");
	await a.getByRole("button", { name: t("close"), exact: true }).click();
	await page.reload();
	await expect(page.locator(".unified-detail-events > li")).toHaveCount(9);
	await expect(page.locator(".unified-detail-history")).not.toContainText(
		"V7 stale renewal must not save",
	);
	await enter(page, "item");
	await page
		.locator(".unified-detail-header")
		.getByRole("button", { name: t("detailRecordActivity"), exact: true })
		.click();
	await a
		.getByLabel(t("maintenanceNotes"), { exact: true })
		.fill("V7 stale maintenance must not save");
	await other.goto("/assets/item/ud-item");
	await other
		.locator(".unified-detail-header")
		.getByRole("button", { name: t("detailRecordActivity"), exact: true })
		.click();
	await b
		.getByLabel(t("maintenanceNotes"), { exact: true })
		.fill("V7 other page maintenance");
	await b.getByRole("button", { name: t("maintenance"), exact: true }).click();
	await expect(b).toBeHidden();
	await expect(page.locator(".unified-detail-history")).toContainText(
		"V7 other page maintenance",
	);
	await a.getByRole("button", { name: t("maintenance"), exact: true }).click();
	await expect(a.getByRole("alert")).toContainText(t("itemStale"));
	await screenshot(page, info, "stale-maintenance-preserved");
	await a.getByRole("button", { name: t("close"), exact: true }).click();
	await page.reload();
	await expect(page.locator(".unified-detail-events > li")).toHaveCount(9);
	await expect(page.locator(".unified-detail-history")).not.toContainText(
		"V7 stale maintenance must not save",
	);
	await other.close();
	await receipt(info, ["V708", "V711"]);
});
