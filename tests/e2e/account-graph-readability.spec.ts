import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	expect,
	type BrowserContext,
	type Locator,
	type Page,
	test,
} from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Relation } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { expectReadableAccountGraph } from "./helpers/account-graph";
import { selectChoice } from "./helpers/select-choice";

test.use({ actionTimeout: 15_000 });
test.setTimeout(180_000);

const evidence = process.env.KEEPANY_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const accounts = [
	{
		key: "mail",
		name: "QA Studio mailbox",
		username: "graph.owner@example.test",
		category: "email",
	},
	{
		key: "phoneA",
		name: "QA Primary mobile",
		username: "+447700900101",
		category: "phone",
	},
	{
		key: "phoneB",
		name: "QA Backup mobile",
		username: "+8613800138000",
		category: "phone",
	},
	{
		key: "docs",
		name: "QA Docs Cloud",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "code",
		name: "QA Code Forge",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "design",
		name: "QA Sketch Board",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "hosting",
		name: "QA Host Panel",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "video",
		name: "QA Video Studio",
		username: "graph.owner@example.test",
		category: "other",
	},
] as const;
type AccountKey = (typeof accounts)[number]["key"];
type Purpose = "email" | "recoveryEmail" | "phone" | "recoveryPhone";
type Connection = {
	from: AccountKey;
	to: AccountKey;
	purpose: Purpose;
	verified: boolean;
};
const initialConnections: Connection[] = [
	...(["docs", "code", "design", "hosting", "video"] as const).map((from) => ({
		from,
		to: "mail" as const,
		purpose: "email" as const,
		verified: true,
	})),
	{ from: "docs", to: "mail", purpose: "recoveryEmail", verified: false },
	{ from: "code", to: "phoneA", purpose: "phone", verified: true },
	{ from: "design", to: "phoneB", purpose: "recoveryPhone", verified: true },
];

function account(key: AccountKey) {
	const record = accounts.find((item) => item.key === key);
	if (!record) throw Error(`Missing graph scenario account: ${key}`);
	return record;
}
function copy(locale: string) {
	return locale === "zh-CN"
		? {
				add: "新增",
				save: "保存",
				addConnection: "添加关联",
				target: "关联至",
				label: "关联用途",
				verifiedAt: "最近核验",
				remove: "删除关系",
				direct: "直接关联",
				family: "完整关系",
				backup: "创建备份",
				download: "保存备份文件",
				duplicate: "这条同方向、同用途的关系已存在。",
				selection: "关联详情",
				close: "关闭",
				fit: "查看全图",
				verified: "已核实",
				mixed: "含待核实关系",
				pending: "待核实",
				purposes: {
					email: "登录邮箱",
					recoveryEmail: "找回邮箱",
					phone: "登录手机号",
					recoveryPhone: "找回手机号",
				},
			}
		: {
				add: "Add",
				save: "Save",
				addConnection: "Add connection",
				target: "Connect to",
				label: "Connection label",
				verifiedAt: "Last verified",
				remove: "Delete connection",
				direct: "Direct",
				family: "All connections",
				backup: "Create backup",
				download: "Save backup file",
				duplicate: "A connection with this direction and label already exists.",
				selection: "Connection details",
				close: "Close",
				fit: "Fit all",
				verified: "Verified",
				mixed: "Includes connections to verify",
				pending: "To verify",
				purposes: {
					email: "Login email",
					recoveryEmail: "Recovery email",
					phone: "Login phone",
					recoveryPhone: "Recovery phone",
				},
			};
}
type Copy = ReturnType<typeof copy>;

async function createScenarioAccount(page: Page, key: AccountKey, text: Copy) {
	const record = account(key);
	await page.goto("/assets/account");
	await page
		.getByRole("main")
		.getByRole("button", { name: text.add, exact: true })
		.click();
	const editor = page.getByRole("dialog");
	await editor.locator("#name").fill(record.name);
	await selectChoice(editor.locator("#category"), record.category);
	await editor.locator("#username").fill(record.username);
	await editor.getByRole("button", { name: text.save, exact: true }).click();
	await expect(editor).toBeHidden();
	const card = page
		.locator(".asset-account-card")
		.filter({ has: page.getByText(record.name, { exact: true }) });
	await expect(card).toBeVisible();
	const href = await card.getAttribute("href");
	if (!href)
		throw Error(`Scenario account has no details link: ${record.name}`);
	return href;
}
function detailsHref(hrefs: Map<AccountKey, string>, key: AccountKey) {
	const href = hrefs.get(key);
	if (!href) throw Error(`Missing scenario details URL: ${key}`);
	return href;
}
function accountId(hrefs: Map<AccountKey, string>, key: AccountKey) {
	const id = new URL(
		detailsHref(hrefs, key),
		"http://scenario.invalid",
	).pathname
		.split("/")
		.filter(Boolean)
		.at(-1);
	if (!id) throw Error(`Missing scenario account ID: ${key}`);
	return id;
}
function connectionText(connection: Connection, text: Copy) {
	return `${account(connection.from).name} → ${account(connection.to).name} · ${text.purposes[connection.purpose]}`;
}
async function addScenarioConnection(
	page: Page,
	hrefs: Map<AccountKey, string>,
	connection: Connection,
	text: Copy,
) {
	await page.goto(detailsHref(hrefs, connection.from));
	await page
		.getByRole("button", { name: text.addConnection, exact: true })
		.click();
	const editor = page.getByRole("dialog");
	await selectChoice(editor.getByLabel(text.target, { exact: true }), {
		label: account(connection.to).name,
	});
	await editor
		.getByLabel(text.label, { exact: true })
		.fill(text.purposes[connection.purpose]);
	if (connection.verified)
		await editor
			.getByLabel(text.verifiedAt, { exact: true })
			.fill("2026-10-22");
	await editor.getByRole("button", { name: text.save, exact: true }).click();
	await expect(editor).toBeHidden();
	await expect(
		page
			.locator(".relation-list .relation-info > small")
			.filter({ hasText: connectionText(connection, text) }),
	).toHaveCount(1);
}

async function fullFamily(page: Page, expected: Connection[], text: Copy) {
	await page.getByRole("button", { name: text.family, exact: true }).click();
	await expect(page.locator(".react-flow__node")).toHaveCount(accounts.length);
	await expectReadableAccountGraph(page);
	const pairCount = new Set(
		expected.map((connection) => `${connection.from}:${connection.to}`),
	).size;
	await expect(page.locator(".react-flow__edge")).toHaveCount(pairCount);
	await expect(
		page.locator(".graph svg text, .graph .react-flow__edge-textwrapper"),
	).toHaveCount(0);
	for (const edge of await page.locator(".react-flow__edge-path").all())
		await expect(edge).toHaveAttribute("marker-end", /url\(.+\)/);
	const rows = page.locator(".relation-list .relation-row");
	await expect(rows).toHaveCount(expected.length);
	const actual = await rows.evaluateAll((elements) =>
		elements
			.map(
				(row) =>
					row
						.querySelector(".relation-info > small")
						?.textContent?.replace(/\s+/g, " ")
						.trim() ?? "",
			)
			.sort(),
	);
	expect(actual).toEqual(
		expected.map((connection) => connectionText(connection, text)).sort(),
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth + 1,
		),
	).toBe(true);
}

async function rejectDuplicate(
	page: Page,
	hrefs: Map<AccountKey, string>,
	connection: Connection,
	text: Copy,
) {
	await page.goto(detailsHref(hrefs, connection.from));
	await page
		.getByRole("button", { name: text.addConnection, exact: true })
		.click();
	const editor = page.getByRole("dialog");
	await selectChoice(editor.getByLabel(text.target, { exact: true }), {
		label: account(connection.to).name,
	});
	await editor
		.getByLabel(text.label, { exact: true })
		.fill(text.purposes[connection.purpose]);
	await editor.getByRole("button", { name: text.save, exact: true }).click();
	await expect(editor.getByRole("alert")).toHaveText(text.duplicate);
	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();
}

async function expectBackupConnections(
	page: Page,
	hrefs: Map<AccountKey, string>,
	expected: Connection[],
	deleted: Connection[],
	text: Copy,
) {
	const password = "synthetic-graph-readability-backup";
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: text.backup, exact: true }).click();
	const link = page.getByRole("link", { name: text.download, exact: true });
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent("download");
	await link.click();
	const download = await downloading;
	try {
		const path = await download.path();
		if (!path) throw Error("graph-readability-backup-download-missing");
		const entries = unzipSync(
			await decryptBackup(new Uint8Array(readFileSync(path)), password),
		);
		const records = JSON.parse(strFromU8(entries["records.json"])) as Array<{
			type: string;
			payload: string;
		}>;
		const rows: Relation[] = records
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload));
		const values = (connection: Connection, removed: boolean) => ({
			from: accountId(hrefs, connection.from),
			to: accountId(hrefs, connection.to),
			label: text.purposes[connection.purpose],
			verifiedAt: connection.verified ? "2026-10-22" : "",
			deleted: removed,
		});
		const expectedRows = [
			...expected.map((connection) => values(connection, false)),
			...deleted.map((connection) => values(connection, true)),
		];
		const actual = rows.map(({ from, to, label, verifiedAt, deleted }) => ({
			from,
			to,
			label,
			verifiedAt,
			deleted,
		}));
		const ordered = (items: typeof expectedRows) =>
			items.map((item) => JSON.stringify(item)).sort();
		expect(ordered(actual)).toEqual(ordered(expectedRows));
	} finally {
		await download.delete();
	}
}

function graphEdge(page: Page, from: AccountKey, to: AccountKey) {
	return page.locator(
		`.react-flow__edge[aria-label^="${account(from).name} → ${account(to).name} ·"]`,
	);
}

async function clickGraphEdge(page: Page, edge: Locator) {
	await expect(edge).toHaveCount(1);
	const point = await edge.evaluate((element) => {
		const path = element.querySelector<SVGPathElement>(
			".react-flow__edge-path",
		);
		const matrix = path?.getScreenCTM();
		if (!path || !matrix) return null;
		const length = path.getTotalLength();
		for (let step = 1; step < 20; step++) {
			const point = path.getPointAtLength((length * step) / 20);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			const hit = document.elementFromPoint(screen.x, screen.y);
			if (hit?.closest(".react-flow__edge") === element)
				return { x: screen.x, y: screen.y };
		}
		return null;
	});
	expect(point, "A visible portion of the line can be clicked").not.toBeNull();
	if (!point) throw Error("graph-readability-edge-not-clickable");
	await page.mouse.click(point.x, point.y);
}

async function tabToEdge(page: Page, edge: Locator) {
	await expect(edge).toHaveAttribute("tabindex", "0");
	let reached = false;
	for (let step = 0; step < 64; step++) {
		await page.keyboard.press("Tab");
		if (await edge.evaluate((element) => document.activeElement === element)) {
			reached = true;
			break;
		}
	}
	expect(reached, "Connection lines can be reached with Tab").toBe(true);
}

async function expectSelection(
	page: Page,
	from: AccountKey,
	to: AccountKey,
	connections: Connection[],
	text: Copy,
) {
	const edge = graphEdge(page, from, to);
	await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
	await expect(edge).toHaveClass(/selected/);
	const panel = page.locator(".account-graph-selection-panel");
	await expect(panel).toHaveCount(1);
	await expect(
		panel.getByRole("region", { name: text.selection, exact: true }),
	).toBeVisible();
	const title = panel.locator(".account-graph-selection-title");
	await expect(title).toContainText(account(from).name);
	await expect(title).toContainText(account(to).name);
	await expect(title).toContainText("→");
	const purposes = [
		...new Set(connections.map((item) => text.purposes[item.purpose])),
	];
	expect(
		(
			await panel
				.locator(".account-graph-selection-labels > li")
				.allTextContents()
		)
			.map((value) => value.trim())
			.sort(),
	).toEqual([...purposes].sort());
	const status = connections.every((item) => item.verified)
		? text.verified
		: connections.some((item) => item.verified)
			? text.mixed
			: text.pending;
	await expect(panel.locator(".account-graph-selection-status")).toHaveText(
		status,
	);
	for (const purpose of purposes)
		await expect(edge).toHaveAttribute("aria-label", new RegExp(purpose));
	await expect(edge).toHaveAttribute("aria-label", new RegExp(status));
	const styles = await page.locator(".react-flow__edge").evaluateAll((edges) =>
		edges.map((element) => {
			const path = element.querySelector(".react-flow__edge-path");
			return {
				selected: element.classList.contains("selected"),
				width: path ? Number.parseFloat(getComputedStyle(path).strokeWidth) : 0,
				opacity: path ? Number(getComputedStyle(path).opacity) : 1,
				z: Number(getComputedStyle(element.closest("svg") ?? element).zIndex),
			};
		}),
	);
	const selected = styles.find((item) => item.selected);
	expect(selected).toBeDefined();
	if (!selected) throw Error("graph-readability-selected-line-missing");
	for (const other of styles.filter((item) => !item.selected)) {
		expect(selected.width).toBeGreaterThan(other.width);
		expect(selected.opacity).toBeGreaterThan(other.opacity);
		expect(selected.z).toBeGreaterThan(other.z);
	}
	await expect(
		page.locator(".graph svg text, .graph .react-flow__edge-textwrapper"),
	).toHaveCount(0);
	return panel;
}

async function expectSelectionGeometry(panel: Locator, text: Copy) {
	const close = panel.getByRole("button", { name: text.close, exact: true });
	const closeBox = await close.boundingBox();
	expect(closeBox?.width).toBeGreaterThanOrEqual(44);
	expect(closeBox?.height).toBeGreaterThanOrEqual(44);
	const dimensions = await panel.evaluate((element) => {
		const style = getComputedStyle(element);
		const box = element.getBoundingClientRect();
		const graph = element.closest(".graph")?.getBoundingClientRect();
		const controls = element
			.closest(".graph")
			?.querySelector(".react-flow__controls")
			?.getBoundingClientRect();
		const viewActions = element
			.closest(".graph")
			?.querySelector(".account-graph-view-actions")
			?.getBoundingClientRect();
		const hit = document.elementFromPoint(
			box.x + box.width / 2,
			box.y + box.height / 2,
		);
		const hasGap = (other: DOMRect | undefined) =>
			!!other &&
			(box.right + 8 <= other.left ||
				other.right + 8 <= box.left ||
				box.bottom + 8 <= other.top ||
				other.bottom + 8 <= box.top);
		return {
			background: style.backgroundColor,
			opacity: Number(style.opacity),
			frontmost: !!hit && element.contains(hit),
			inFrame:
				!!graph &&
				box.left >= graph.left &&
				box.right <= graph.right &&
				box.top >= graph.top &&
				box.bottom <= graph.bottom,
			controlsGap: hasGap(controls),
			viewActionsGap: hasGap(viewActions),
		};
	});
	expect(dimensions.background).toMatch(/^rgb\(/);
	expect(dimensions.opacity).toBe(1);
	expect(dimensions.frontmost).toBe(true);
	expect(dimensions.inFrame).toBe(true);
	expect(dimensions.controlsGap).toBe(true);
	expect(dimensions.viewActionsGap).toBe(true);
}

async function expectNoSelection(page: Page) {
	await expect(page.locator(".account-graph-selection-panel")).toHaveCount(0);
	await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
	for (const path of await page.locator(".react-flow__edge-path").all())
		await expect(path).toHaveCSS("opacity", "1");
}

async function selectionJourney(
	page: Page,
	expected: Connection[],
	text: Copy,
	locale: string,
	width: number,
) {
	await expectNoSelection(page);
	await page.getByRole("button", { name: text.fit, exact: true }).click();
	await expect
		.poll(async () => {
			const frame = await page.locator(".graph").boundingBox();
			const nodes = await page.locator(".react-flow__node").all();
			if (!frame) return false;
			for (const node of nodes) {
				const box = await node.boundingBox();
				if (
					!box ||
					box.x < frame.x - 1 ||
					box.y < frame.y - 1 ||
					box.x + box.width > frame.x + frame.width + 1 ||
					box.y + box.height > frame.y + frame.height + 1
				)
					return false;
			}
			return true;
		})
		.toBe(true);
	const duplicatePair = expected.filter(
		(item) => item.from === "docs" && item.to === "mail",
	);
	const emailEdge = graphEdge(page, "docs", "mail");
	await clickGraphEdge(page, emailEdge);
	const panel = await expectSelection(
		page,
		"docs",
		"mail",
		duplicatePair,
		text,
	);
	await expectSelectionGeometry(panel, text);
	if (evidence)
		await page.screenshot({
			path: join(evidence, `account-graph-selected-${locale}-${width}.png`),
			animations: "disabled",
		});
	await panel.getByRole("button", { name: text.close, exact: true }).click();
	await expectNoSelection(page);
	await page.getByRole("button", { name: text.family, exact: true }).focus();
	await tabToEdge(page, emailEdge);
	await page.keyboard.press("Enter");
	await expectSelection(page, "docs", "mail", duplicatePair, text);
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Delete");
	await expectSelection(page, "docs", "mail", duplicatePair, text);
	await expect(page.locator(".relation-list .relation-row")).toHaveCount(
		expected.length,
	);
	const phoneEdge = graphEdge(page, "code", "phoneA");
	await tabToEdge(page, phoneEdge);
	await page.keyboard.press("Space");
	await expectSelection(
		page,
		"code",
		"phoneA",
		expected.filter((item) => item.from === "code" && item.to === "phoneA"),
		text,
	);
	await page.locator(".react-flow__pane").click({ position: { x: 6, y: 6 } });
	await expectNoSelection(page);
	await clickGraphEdge(page, emailEdge);
	await expectSelection(page, "docs", "mail", duplicatePair, text);
	await page.getByRole("button", { name: text.direct, exact: true }).click();
	await expectNoSelection(page);
	await fullFamily(page, expected, text);
	await expectNoSelection(page);
}

async function reopenFamily(
	context: BrowserContext,
	href: string,
	expected: Connection[],
	text: Copy,
	errors: string[],
) {
	const reopened = await context.newPage();
	reopened.on("pageerror", (error) => errors.push(error.message));
	try {
		await reopened.goto(href);
		await fullFamily(reopened, expected, text);
	} finally {
		await reopened.close();
	}
}

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1536] as const) {
		test(`${locale} ${width}px multi-source identities preserve connection purposes across reload and edits`, async ({
			browser,
		}) => {
			const text = copy(locale);
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 1024 },
				acceptDownloads: true,
			});
			await context.addInitScript(
				(language) => localStorage.setItem("keepany-language", language),
				locale === "zh-CN" ? "zh-CN" : "en",
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const hrefs = new Map<AccountKey, string>();
			try {
				for (const record of accounts)
					hrefs.set(
						record.key,
						await createScenarioAccount(page, record.key, text),
					);
				for (const connection of initialConnections)
					await addScenarioConnection(page, hrefs, connection, text);
				await rejectDuplicate(page, hrefs, initialConnections[0], text);
				await expectBackupConnections(
					page,
					hrefs,
					initialConnections,
					[],
					text,
				);
				const rootHref = detailsHref(hrefs, "mail");
				await page.goto(rootHref);
				await fullFamily(page, initialConnections, text);
				await page.locator(".asset-relations-card").scrollIntoViewIfNeeded();
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
				if (evidence)
					await page.screenshot({
						path: join(
							evidence,
							`account-graph-default-${locale}-${width}.png`,
						),
						animations: "disabled",
					});
				await selectionJourney(page, initialConnections, text, locale, width);
				await page.reload();
				await fullFamily(page, initialConnections, text);
				await reopenFamily(context, rootHref, initialConnections, text, errors);
				for (let repeat = 0; repeat < 2; repeat++) {
					await page
						.getByRole("button", { name: text.direct, exact: true })
						.click();
					await fullFamily(page, initialConnections, text);
				}

				const added: Connection = {
					from: "video",
					to: "phoneA",
					purpose: "recoveryPhone",
					verified: true,
				};
				const withAdded = [...initialConnections, added];
				await addScenarioConnection(page, hrefs, added, text);
				await page.goto(rootHref);
				await fullFamily(page, withAdded, text);
				await page.reload();
				await fullFamily(page, withAdded, text);

				// Removing one purpose must preserve the other purpose for the same source and target.
				const removed = initialConnections[0];
				await page.goto(detailsHref(hrefs, removed.from));
				await page
					.getByRole("button", {
						name: `${text.remove} · ${text.purposes[removed.purpose]} · ${account(removed.to).name}`,
						exact: true,
					})
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: text.remove, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				const afterDelete = withAdded.filter(
					(connection) => connection !== removed,
				);
				await page.goto(rootHref);
				await fullFamily(page, afterDelete, text);
				await page.reload();
				await fullFamily(page, afterDelete, text);
				await reopenFamily(context, rootHref, afterDelete, text, errors);
				await page
					.getByRole("button", { name: text.family, exact: true })
					.focus();
				await tabToEdge(page, graphEdge(page, "docs", "mail"));
				await page.keyboard.press("Enter");
				await expectSelection(
					page,
					"docs",
					"mail",
					afterDelete.filter(
						(item) => item.from === "docs" && item.to === "mail",
					),
					text,
				);
				await expectBackupConnections(
					page,
					hrefs,
					afterDelete,
					[removed],
					text,
				);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
