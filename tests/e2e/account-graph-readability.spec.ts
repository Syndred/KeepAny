import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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
import {
	activeAccountGraph,
	accountGraphCanvas,
	clickAccountGraphBlank,
	expectAccountGraphGeometry,
	expectAllAccountGraphNodesInFrame,
	expectCanvasActionsOutsideStage,
	expectReadableAccountGraph,
	exerciseAccountGraphControls,
	exerciseAccountGraphMiniMap,
	fitAccountGraph,
	focusAccountGraph,
	panAccountGraphNodeIntoView,
	setAccountRelationDetailsOpen,
	visibleGraphNodeIds,
	waitForAccountGraphLayout,
} from "./helpers/account-graph";
import { selectChoice } from "./helpers/select-choice";

test.use({ actionTimeout: 15_000 });
test.setTimeout(180_000);

const evidence = process.env.KEEPANY_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const accounts = [
	{
		key: "mail",
		name: "graph.owner@example.test",
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
	{
		key: "analytics",
		name: "QA Analytics Console",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "shop",
		name: "QA Commerce Desk",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "learning",
		name: "QA Learning Workspace",
		username: "graph.owner@example.test",
		category: "other",
	},
	{
		key: "tracker",
		name: "QA Issue Tracker",
		username: "graph.owner@example.test",
		category: "other",
	},
] as const;
type AccountKey = string;
type Purpose =
	| "email"
	| "recoveryEmail"
	| "phone"
	| "recoveryPhone"
	| "linkedAccount";
type Connection = {
	from: AccountKey;
	to: AccountKey;
	purpose: Purpose;
	verified: boolean;
};
const initialConnections: Connection[] = [
	...(
		[
			"docs",
			"code",
			"design",
			"hosting",
			"video",
			"analytics",
			"shop",
			"learning",
			"tracker",
		] as const
	).map((from) => ({
		from,
		to: "mail" as const,
		purpose: "email" as const,
		verified: true,
	})),
	{ from: "docs", to: "mail", purpose: "recoveryEmail", verified: false },
	{ from: "code", to: "phoneA", purpose: "phone", verified: true },
	{ from: "design", to: "phoneB", purpose: "recoveryPhone", verified: true },
	{ from: "mail", to: "phoneA", purpose: "recoveryPhone", verified: true },
	{ from: "phoneA", to: "code", purpose: "linkedAccount", verified: false },
	{ from: "mail", to: "docs", purpose: "linkedAccount", verified: true },
];

function account(key: AccountKey) {
	const record = accounts.find((item) => item.key === key);
	if (!record && /^extra-\d+$/.test(key))
		return {
			key,
			name: `QA Additional Service ${key.slice(6)}`,
			username: `graph.owner.${key}.username`,
			category: "other" as const,
		};
	if (!record) throw Error(`Missing graph scenario account: ${key}`);
	// These scenarios enter every purpose manually. Shared primary/alias auto-linking
	// is covered by account-shared-identity.spec.ts; keep long service usernames here.
	return record.category === "other"
		? { ...record, username: `graph.owner.${key}.username` }
		: record;
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
				fit: "适应画布",
				center: "回到当前",
				expand: "全屏查看",
				verified: "已核实",
				mixed: "含待核实关系",
				pending: "待核实",
				purposes: {
					email: "登录邮箱",
					recoveryEmail: "找回邮箱",
					phone: "登录手机号",
					recoveryPhone: "找回手机号",
					linkedAccount: "关联账号",
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
				center: "Back to current",
				expand: "Expand graph",
				verified: "Verified",
				mixed: "Includes connections to verify",
				pending: "To verify",
				purposes: {
					email: "Login email",
					recoveryEmail: "Recovery email",
					phone: "Login phone",
					recoveryPhone: "Recovery phone",
					linkedAccount: "Linked account",
				},
			};
}
type Copy = ReturnType<typeof copy>;

async function createScenarioAccount(page: Page, key: AccountKey, text: Copy) {
	const record = account(key);
	const back = page.locator('.topbar-back-link[href="/assets/account"]');
	if (await back.count()) await back.click();
	else if (new URL(page.url()).pathname !== "/assets/account") {
		// Retain the first cold startup and entries from other sections such as Intake.
		await page.goto("/assets/account");
	}
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
function connectionRow(connection: Connection, text: Copy) {
	const endpoints = [
		account(connection.from).name,
		account(connection.to).name,
	];
	return {
		endpoints,
		path: endpoints.join(" → "),
		purpose: text.purposes[connection.purpose],
	};
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
	const expected = connectionRow(connection, text);
	const row = page
		.locator(".relation-list .relation-row")
		.filter({
			has: page
				.locator(".relation-endpoints")
				.filter({ hasText: expected.path }),
		})
		.filter({
			has: page
				.locator(".relation-purpose")
				.filter({ hasText: expected.purpose }),
		});
	await expect(row).toHaveCount(1);
	await expect(row.locator(".relation-endpoints")).toHaveText(expected.path);
	await expect(row.locator(".relation-info strong")).toHaveText(
		expected.endpoints,
	);
	await expect(row.locator(".relation-purpose")).toHaveText(expected.purpose);
}

async function fullFamily(page: Page, expected: Connection[], text: Copy) {
	const details = page.locator("details.account-relation-details");
	await expect(details).toHaveCount(1);
	const detailsOpen = await details.evaluate(
		(element) => (element as HTMLDetailsElement).open,
	);
	await page.getByRole("button", { name: text.family, exact: true }).click();
	await expect(details).toHaveJSProperty("open", detailsOpen);
	const pairCount = new Set(
		expected.map((connection) => `${connection.from}:${connection.to}`),
	).size;
	const nodeCount = new Set(expected.flatMap((edge) => [edge.from, edge.to]))
		.size;
	await waitForAccountGraphLayout(page, { nodes: nodeCount, edges: pairCount });
	// A scope toggle can retain the user's overview camera. Request reading focus
	// explicitly before checking centered, readable text; selection checks still
	// assert that mouse/keyboard interaction alone never changes the camera.
	await focusAccountGraph(page);
	await expectReadableAccountGraph(page);
	await expect(page.locator(".react-flow__edge")).toHaveCount(pairCount);
	await expect(
		page.locator(".graph svg text, .graph .react-flow__edge-textwrapper"),
	).toHaveCount(0);
	for (const edge of await page.locator(".react-flow__edge-path").all())
		await expect(edge).toHaveAttribute("marker-end", /url\(.+\)/);
	const rows = page.locator(".relation-list .relation-row");
	await expect(rows).toHaveCount(expected.length);
	const actual = await rows.evaluateAll((elements) => {
		const normalized = (element: Element | null) =>
			element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
		return elements.map((row) => ({
			endpoints: [...row.querySelectorAll(".relation-info strong")].map(
				normalized,
			),
			path: normalized(row.querySelector(".relation-endpoints")),
			purpose: normalized(row.querySelector(".relation-purpose")),
		}));
	});
	expect(actual.map((row) => JSON.stringify(row)).sort()).toEqual(
		expected
			.map((connection) => JSON.stringify(connectionRow(connection, text)))
			.sort(),
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
	await waitForAccountGraphLayout(page);
	await expect(edge).toHaveCount(1);
	let point: { x: number; y: number } | null = null;
	await expect
		.poll(
			async () => {
				point = await edge.evaluate((element) => {
					const path = element.querySelector<SVGPathElement>(
						".react-flow__edge-path",
					);
					const matrix = path?.getScreenCTM();
					if (!path || !matrix) return null;
					const length = path.getTotalLength();
					const steps = Math.ceil(
						(length * Math.hypot(matrix.a, matrix.b)) / 2,
					);
					for (let step = 1; step < steps; step++) {
						const point = path.getPointAtLength((length * step) / steps);
						const screen = new DOMPoint(point.x, point.y).matrixTransform(
							matrix,
						);
						const x = Math.round(screen.x),
							y = Math.round(screen.y);
						if (
							[-2, 0, 2].every((dx) =>
								[-2, 0, 2].every(
									(dy) =>
										document
											.elementFromPoint(x + dx, y + dy)
											?.closest(".react-flow__edge") === element,
								),
							)
						)
							return { x, y };
					}
					return null;
				});
				if (!point) return false;
				await page.mouse.move(point.x, point.y);
				return edge.evaluate(
					(element, at) =>
						[-2, 0, 2].every((dx) =>
							[-2, 0, 2].every(
								(dy) =>
									document
										.elementFromPoint(at.x + dx, at.y + dy)
										?.closest(".react-flow__edge") === element,
							),
						),
					point,
				);
			},
			{
				message:
					"The line has a visible integer-pixel target with a clear 4px interaction area, including after hover",
			},
		)
		.toBe(true)
		.catch(async (error: unknown) => {
			const targetProbe = await edge.evaluate((element) => {
				const path = element.querySelector<SVGPathElement>(
					".react-flow__edge-path",
				);
				const matrix = path?.getScreenCTM();
				const length = path?.getTotalLength() ?? 0;
				const counts: Record<string, number> = {};
				const examples: Array<{ x: number; y: number; owners: string[] }> = [];
				let visibleSamples = 0,
					centeredOnTarget = 0,
					stableSamples = 0;
				if (path && matrix) {
					const steps = Math.ceil(
						(length * Math.hypot(matrix.a, matrix.b)) / 2,
					);
					for (let step = 1; step < steps; step++) {
						const point = path.getPointAtLength((length * step) / steps);
						const screen = new DOMPoint(point.x, point.y).matrixTransform(
							matrix,
						);
						const x = Math.round(screen.x),
							y = Math.round(screen.y);
						if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
						visibleSamples++;
						const owners = [-2, 0, 2].flatMap((dx) =>
							[-2, 0, 2].map((dy) => {
								const hit = document.elementFromPoint(x + dx, y + dy);
								const owner = hit?.closest(
									".react-flow__edge, .react-flow__node",
								);
								return owner?.getAttribute("data-id") ?? hit?.tagName ?? "none";
							}),
						);
						counts[owners[4]] = (counts[owners[4]] ?? 0) + 1;
						if (owners[4] === element.getAttribute("data-id")) {
							centeredOnTarget++;
							if (examples.length < 20) examples.push({ x, y, owners });
						}
						if (
							owners.every((owner) => owner === element.getAttribute("data-id"))
						)
							stableSamples++;
					}
				}
				return {
					id: element.getAttribute("data-id"),
					visibleSamples,
					centeredOnTarget,
					stableSamples,
					centerOwnerCounts: counts,
					examples,
				};
			});
			const diagnostics = await activeAccountGraph(page).evaluate((graph) => ({
				viewport: (
					graph.querySelector(".react-flow__viewport") as HTMLElement | null
				)?.style.transform,
				frame: graph
					.querySelector(".react-flow")
					?.getBoundingClientRect()
					.toJSON(),
				nodes: [
					...graph.querySelectorAll<HTMLElement>(".react-flow__node"),
				].map((node) => ({
					id: node.dataset.id,
					label: node.getAttribute("aria-label"),
					transform: node.style.transform,
					width: node.dataset.nodeWidth,
					height: node.dataset.nodeHeight,
				})),
				edges: [...graph.querySelectorAll(".react-flow__edge")].map(
					(item, order) => ({
						order,
						id: item.getAttribute("data-id"),
						from: item.getAttribute("data-from"),
						to: item.getAttribute("data-to"),
						label: item.getAttribute("aria-label"),
						path: item
							.querySelector(".react-flow__edge-path")
							?.getAttribute("d"),
						interactionWidth: item
							.querySelector(".react-flow__edge-interaction")
							?.getAttribute("stroke-width"),
					}),
				),
			}));
			const diagnosticPath = test
				.info()
				.outputPath("account-graph-pointer-diagnostics.json");
			writeFileSync(
				diagnosticPath,
				JSON.stringify({ ...diagnostics, targetProbe }, null, 2),
			);
			await test.info().attach("account-graph-pointer-diagnostics", {
				path: diagnosticPath,
				contentType: "application/json",
			});
			throw error;
		});
	if (!point) throw Error("graph-readability-edge-not-clickable");
	await page.mouse.click(
		(point as { x: number; y: number }).x,
		(point as { x: number; y: number }).y,
	);
}

async function tabToEdge(page: Page, edge: Locator) {
	await expect(edge).toHaveAttribute("tabindex", "0");
	let reached = false;
	const maximumSteps =
		(await page
			.locator("a[href], button, input, select, textarea, [tabindex='0']")
			.count()) + 2;
	for (let step = 0; step < maximumSteps; step++) {
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
		const graph = element.closest(".react-flow")?.getBoundingClientRect();
		const controls = element
			.closest(".account-family-graph")
			?.querySelector(".react-flow__controls")
			?.getBoundingClientRect();
		const viewActions = element
			.closest(".account-family-graph")
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

function expandedGraphDialog(page: Page) {
	return page.getByRole("dialog", {
		name: /^(关系图|Connections)$/,
		exact: true,
	});
}

async function viewportPosition(page: Page) {
	return activeAccountGraph(page)
		.locator(".react-flow__viewport")
		.evaluate((element) => {
			const matrix = new DOMMatrix(getComputedStyle(element).transform);
			const frame = element.closest(".react-flow")?.getBoundingClientRect();
			const nearest = frame
				? [...element.querySelectorAll(".react-flow__node")]
						.map((node) => {
							const rect = node.getBoundingClientRect();
							return {
								id: node.getAttribute("data-id"),
								distance: Math.hypot(
									rect.x + rect.width / 2 - frame.x - frame.width / 2,
									rect.y + rect.height / 2 - frame.y - frame.height / 2,
								),
							};
						})
						.sort((a, b) => a.distance - b.distance)[0]?.id
				: null;
			return {
				x: matrix.e,
				y: matrix.f,
				zoom: Math.hypot(matrix.a, matrix.b),
				nearest,
			};
		});
}

async function recordAccountGraphCamera(page: Page, checkpoint: string) {
	for (const settled of [false, true]) {
		if (settled)
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		appendFileSync(
			test.info().outputPath("account-graph-camera.jsonl"),
			`${JSON.stringify({
				checkpoint,
				settled,
				at: Date.now(),
				...(await viewportPosition(page)),
				ready: await activeAccountGraph(page).getAttribute("data-layout-ready"),
				stage: await accountGraphCanvas(page).evaluate((canvas) => ({
					width: canvas.clientWidth,
					height: canvas.clientHeight,
				})),
				selected: await activeAccountGraph(page)
					.locator(".react-flow__edge.selected")
					.evaluateAll((edges) =>
						edges.map((edge) => edge.getAttribute("data-id")),
					),
			})}\n`,
		);
	}
}

async function expectAccountGraphCameraUnchanged(
	page: Page,
	before: Awaited<ReturnType<typeof viewportPosition>>,
	action: string,
) {
	for (const settled of [false, true]) {
		if (settled) await waitForAccountGraphLayout(page);
		const after = await viewportPosition(page);
		expect(
			Math.abs(after.zoom - before.zoom),
			`${action} preserves the reading scale (${settled ? "settled" : "immediate"})`,
		).toBeLessThanOrEqual(0.0001);
		expect(
			Math.abs(after.x - before.x),
			`${action} preserves the horizontal camera position`,
		).toBeLessThanOrEqual(1);
		expect(
			Math.abs(after.y - before.y),
			`${action} preserves the vertical camera position`,
		).toBeLessThanOrEqual(1);
	}
}

async function expandAndRestoreSelection(
	page: Page,
	pair: Connection[],
	text: Copy,
) {
	const filter = page.locator("#relation-filter");
	await recordAccountGraphCamera(page, "before-expand-filter");
	const beforeFilter = await viewportPosition(page);
	await filter.fill("QA Docs");
	const details = page.locator("details.account-relation-details");
	await expect(details).toHaveJSProperty("open", true);
	await expect(details.locator(".relation-row").first()).toBeVisible();
	await recordAccountGraphCamera(page, "after-expand-filter");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeFilter,
		"Filtering connections",
	);
	const family = page.getByRole("button", { name: text.family, exact: true });
	await expect(family).toHaveAttribute("aria-pressed", "true");
	const before = await viewportPosition(page);
	const ids = await visibleGraphNodeIds(activeAccountGraph(page));
	const expand = page.locator("#account-graph-expand");
	for (const closeMethod of ["Escape", "button"] as const) {
		await recordAccountGraphCamera(page, `before-expand-${closeMethod}`);
		await expand.click();
		const dialog = expandedGraphDialog(page);
		await expect(dialog).toBeVisible();
		await waitForAccountGraphLayout(page, { nodes: ids.length });
		await recordAccountGraphCamera(page, `expanded-${closeMethod}`);
		expect(await visibleGraphNodeIds(activeAccountGraph(page))).toEqual(ids);
		await expectSelection(page, "docs", "mail", pair, text);
		await expectCanvasActionsOutsideStage(page);
		const closeButton = dialog
			.locator(":scope > header")
			.getByRole("button", { name: text.close, exact: true });
		const closeBounds = await closeButton.boundingBox();
		expect(closeBounds?.width).toBeGreaterThanOrEqual(44);
		expect(closeBounds?.height).toBeGreaterThanOrEqual(44);
		for (let tab = 0; tab < 4; tab++) {
			await page.keyboard.press("Tab");
			expect(
				await dialog.evaluate((element) =>
					element.contains(document.activeElement),
				),
			).toBe(true);
		}
		await activeAccountGraph(page)
			.locator(".react-flow__controls-zoomin")
			.click();
		if (closeMethod === "Escape") await page.keyboard.press("Escape");
		else await closeButton.click();
		await expect(dialog).toBeHidden();
		await waitForAccountGraphLayout(page, { nodes: ids.length });
		await expect(expand).toBeFocused();
		await expect(filter).toHaveValue("QA Docs");
		await expect(family).toHaveAttribute("aria-pressed", "true");
		await expectSelection(page, "docs", "mail", pair, text);
		await expect
			.poll(
				async () => {
					const after = await viewportPosition(page);
					return (
						after.nearest === before.nearest &&
						Math.abs(after.zoom - before.zoom) <= 0.01
					);
				},
				{
					message:
						"Closing the enlarged canvas restores the same focal account and reading scale",
				},
			)
			.toBe(true);
		await recordAccountGraphCamera(page, `after-close-${closeMethod}`);
	}
	const beforeClear = await viewportPosition(page);
	await filter.fill("");
	await recordAccountGraphCamera(page, "after-expand-filter-clear");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeClear,
		"Clearing the connection filter",
	);
}

async function expectBalancedScenario(
	page: Page,
	hrefs: Map<AccountKey, string>,
	expected: Connection[],
) {
	const graph = await waitForAccountGraphLayout(page);
	for (const key of ["mail", "docs"] as const) {
		const record = account(key);
		const node = graph.locator(
			`.react-flow__node[data-id="${accountId(hrefs, key)}"]`,
		);
		const label = node.locator(".asset-graph-label");
		const username =
			record.name.trim() === record.username.trim() ? "" : record.username;
		const accessibleName = [record.name, username].filter(Boolean).join(" · ");
		await expect(label.locator("strong")).toHaveText(record.name);
		await expect(label.locator("small")).toHaveCount(username ? 1 : 0);
		if (username) {
			await expect(label.locator("small")).toHaveText(username);
			await expect(label.locator("small")).toBeVisible();
		}
		await expect(label).toHaveAttribute("title", accessibleName);
		await expect(node).toHaveAttribute("aria-label", accessibleName);
	}
	await expectAccountGraphGeometry(
		page,
		expected.map((edge) => ({
			from: accountId(hrefs, edge.from),
			to: accountId(hrefs, edge.to),
		})),
	);
	const balance = await graph.locator(".react-flow").evaluate((canvas) => {
		const current = canvas
			.querySelector(".asset-graph-center")
			?.getBoundingClientRect();
		if (!current) return { left: 0, right: 0, middle: 1 };
		const middle = current.x + current.width / 2;
		let left = 0,
			right = 0,
			center = 0;
		for (const node of canvas.querySelectorAll(
			".react-flow__node:not(.asset-graph-center)",
		)) {
			const rect = node.getBoundingClientRect(),
				x = rect.x + rect.width / 2;
			if (x < middle - current.width / 2) left++;
			else if (x > middle + current.width / 2) right++;
			else center++;
		}
		return { left, right, middle: center };
	});
	expect(balance.left).toBeGreaterThan(0);
	expect(balance.right).toBeGreaterThan(0);
	expect(balance.middle).toBe(0);
	expect(Math.abs(balance.left - balance.right)).toBeLessThanOrEqual(1);
	await expectCanvasActionsOutsideStage(page);
}

async function crossSideConnection(
	page: Page,
	hrefs: Map<AccountKey, string>,
): Promise<Connection> {
	const positions = await activeAccountGraph(page)
		.locator(".react-flow__node")
		.evaluateAll((nodes) =>
			nodes.map((node) => {
				const rect = node.getBoundingClientRect();
				return {
					id: node.getAttribute("data-id"),
					x: rect.x + rect.width / 2,
					current: node.classList.contains("asset-graph-center"),
				};
			}),
		);
	const root = positions.find((node) => node.current);
	if (!root) throw Error("cross-side-root-missing");
	const businesses = accounts.filter((record) => record.category === "other");
	const left = businesses.find((record) =>
		positions.some(
			(node) => node.id === accountId(hrefs, record.key) && node.x < root.x,
		),
	);
	const right = businesses.find((record) =>
		positions.some(
			(node) => node.id === accountId(hrefs, record.key) && node.x > root.x,
		),
	);
	expect(left, "A business account is placed on the left").toBeDefined();
	expect(right, "A business account is placed on the right").toBeDefined();
	if (!left || !right) throw Error("cross-side-business-pair-missing");
	return {
		from: left.key,
		to: right.key,
		purpose: "linkedAccount",
		verified: true,
	};
}

async function exerciseLatestLayoutRequest(
	page: Page,
	hrefs: Map<AccountKey, string>,
	expected: Connection[],
	text: Copy,
) {
	const original = page.viewportSize();
	if (!original) throw Error("graph-viewport-size-missing");
	for (const scope of [text.direct, text.family, text.direct, text.family])
		await page.getByRole("button", { name: scope, exact: true }).click();
	for (const width of [390, 1280, 1536])
		await page.setViewportSize({ width, height: original.height });
	await page.setViewportSize(original);
	await fullFamily(page, expected, text);
	await expect(
		activeAccountGraph(page).locator(".asset-graph-center"),
	).toHaveAttribute("data-id", accountId(hrefs, "mail"));
	expect(await visibleGraphNodeIds(activeAccountGraph(page))).toEqual(
		[
			...new Set(
				expected.flatMap((edge) => [
					accountId(hrefs, edge.from),
					accountId(hrefs, edge.to),
				]),
			),
		].sort(),
	);
	await expectAccountGraphGeometry(
		page,
		expected.map((edge) => ({
			from: accountId(hrefs, edge.from),
			to: accountId(hrefs, edge.to),
		})),
	);
}

async function largeFamilyCheckpoints(
	page: Page,
	hrefs: Map<AccountKey, string>,
	baseline: Connection[],
	text: Copy,
	locale: string,
) {
	const expected = [...baseline];
	for (const count of [24, 49]) {
		for (let index = hrefs.size + 1; index <= count; index++) {
			const key = `extra-${index}`;
			hrefs.set(key, await createScenarioAccount(page, key, text));
			const connection: Connection = {
				from: key,
				to: "mail",
				purpose: "email",
				verified: true,
			};
			await addScenarioConnection(page, hrefs, connection, text);
			expected.push(connection);
		}
		for (const width of [1536, 1280, 390]) {
			await page.setViewportSize({
				width,
				height: width === 1536 ? 1024 : 844,
			});
			await page.goto(detailsHref(hrefs, "mail"));
			await fullFamily(page, expected, text);
			if (count === 49 && width === 1536)
				await exerciseLatestLayoutRequest(page, hrefs, expected, text);
			await expectBalancedScenario(page, hrefs, expected);
			const expand = page.locator("#account-graph-expand");
			await expand.click();
			await expect(expandedGraphDialog(page)).toBeVisible();
			await waitForAccountGraphLayout(page, { nodes: count });
			await expectReadableAccountGraph(page);
			const ids = await visibleGraphNodeIds(activeAccountGraph(page));
			for (const id of ids) await panAccountGraphNodeIntoView(page, id);
			await exerciseAccountGraphMiniMap(page);
			if (evidence)
				await page.screenshot({
					path: join(
						evidence,
						`account-graph-${count}-reading-${locale}-${width}.png`,
					),
					animations: "disabled",
				});
			await fitAccountGraph(page);
			await expectAllAccountGraphNodesInFrame(page);
			await expectAccountGraphGeometry(
				page,
				expected.map((edge) => ({
					from: accountId(hrefs, edge.from),
					to: accountId(hrefs, edge.to),
				})),
			);
			if (evidence)
				await page.screenshot({
					path: join(
						evidence,
						`account-graph-${count}-overview-${locale}-${width}.png`,
					),
					animations: "disabled",
				});
			await page.keyboard.press("Escape");
			await expect(expandedGraphDialog(page)).toBeHidden();
			await expect(expand).toBeFocused();
			await waitForAccountGraphLayout(page, { nodes: count });
			await expectReadableAccountGraph(page);
		}
	}
	await expectBackupConnections(
		page,
		hrefs,
		expected,
		[initialConnections[0]],
		text,
	);
}

async function selectionJourney(
	page: Page,
	expected: Connection[],
	text: Copy,
	locale: string,
	width: number,
) {
	await exerciseAccountGraphControls(page);
	await expectNoSelection(page);
	await fitAccountGraph(page);
	await expectAllAccountGraphNodesInFrame(page);
	await recordAccountGraphCamera(page, "before-first-mouse");
	const beforeFirstMouse = await viewportPosition(page);
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
	await recordAccountGraphCamera(page, "after-first-mouse");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeFirstMouse,
		"Selecting a line with the mouse",
	);
	await expectSelectionGeometry(panel, text);
	await expandAndRestoreSelection(page, duplicatePair, text);
	await recordAccountGraphCamera(page, "after-expand-and-restore");
	if (evidence)
		await page.screenshot({
			path: join(evidence, `account-graph-selected-${locale}-${width}.png`),
			animations: "disabled",
		});
	const beforeClose = await viewportPosition(page);
	await panel.getByRole("button", { name: text.close, exact: true }).click();
	await expectNoSelection(page);
	await recordAccountGraphCamera(page, "after-selection-close");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeClose,
		"Closing the connection details",
	);
	await page.getByRole("button", { name: text.family, exact: true }).focus();
	await tabToEdge(page, emailEdge);
	const beforeEnter = await viewportPosition(page);
	await page.keyboard.press("Enter");
	await expectSelection(page, "docs", "mail", duplicatePair, text);
	await recordAccountGraphCamera(page, "after-email-enter");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeEnter,
		"Selecting a line with Enter",
	);
	const beforeDelete = await viewportPosition(page);
	await page.keyboard.press("Backspace");
	await page.keyboard.press("Delete");
	await expectSelection(page, "docs", "mail", duplicatePair, text);
	await recordAccountGraphCamera(page, "after-readonly-delete");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeDelete,
		"Read-only Delete and Backspace",
	);
	await expect(page.locator(".relation-list .relation-row")).toHaveCount(
		expected.length,
	);
	const phoneEdge = graphEdge(page, "code", "phoneA");
	await tabToEdge(page, phoneEdge);
	const beforeSpace = await viewportPosition(page);
	await page.keyboard.press("Space");
	await expectSelection(
		page,
		"code",
		"phoneA",
		expected.filter((item) => item.from === "code" && item.to === "phoneA"),
		text,
	);
	await recordAccountGraphCamera(page, "after-phone-space");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeSpace,
		"Selecting a line with Space",
	);
	const beforeBlank = await viewportPosition(page);
	await clickAccountGraphBlank(page);
	await expectNoSelection(page);
	await recordAccountGraphCamera(page, "after-blank");
	await expectAccountGraphCameraUnchanged(
		page,
		beforeBlank,
		"Clearing the selection on blank canvas",
	);
	await fitAccountGraph(page);
	await expectAllAccountGraphNodesInFrame(page);
	await recordAccountGraphCamera(page, "after-second-fit-all");
	const beforeSecondMouse = await viewportPosition(page);
	await clickGraphEdge(page, emailEdge);
	await expectSelection(page, "docs", "mail", duplicatePair, text);
	await expectAccountGraphCameraUnchanged(
		page,
		beforeSecondMouse,
		"Selecting the line again with the mouse",
	);
	await page.getByRole("button", { name: text.direct, exact: true }).click();
	await expectNoSelection(page);
	await fullFamily(page, expected, text);
	await expectNoSelection(page);
	await test.info().attach("account-graph-camera", {
		path: test.info().outputPath("account-graph-camera.jsonl"),
		contentType: "application/x-ndjson",
	});
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
	for (const width of [390, 1280, 1536] as const) {
		test(`${locale} ${width}px multi-source identities preserve connection purposes across reload and edits`, async ({
			browser,
		}) => {
			test.setTimeout(width === 1536 ? 480_000 : 240_000);
			const text = copy(locale);
			const context = await browser.newContext({
				locale,
				viewport: { width, height: width === 1536 ? 1024 : 844 },
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
				const baseline = [...initialConnections];
				for (const record of accounts)
					hrefs.set(
						record.key,
						await createScenarioAccount(page, record.key, text),
					);
				for (const connection of initialConnections)
					await addScenarioConnection(page, hrefs, connection, text);
				const rootHref = detailsHref(hrefs, "mail");
				await page.goto(rootHref);
				const details = page.locator("details.account-relation-details");
				await expect(details).toHaveJSProperty("open", false);
				await expect(details.locator(".relation-row").first()).toBeAttached();
				await expect(details.locator(".relation-row").first()).toBeHidden();
				await fullFamily(page, baseline, text);
				const across = await crossSideConnection(page, hrefs);
				await addScenarioConnection(page, hrefs, across, text);
				baseline.push(across);
				await rejectDuplicate(page, hrefs, initialConnections[0], text);
				await expectBackupConnections(page, hrefs, baseline, [], text);
				await page.goto(rootHref);
				await fullFamily(page, baseline, text);
				await expectBalancedScenario(page, hrefs, baseline);
				// Overview certifies all-node bounds; reading mode certifies every card at
				// its usable text size through the same panning used for narrow canvases.
				await fitAccountGraph(page);
				await expectAllAccountGraphNodesInFrame(page);
				await focusAccountGraph(page);
				for (const id of await visibleGraphNodeIds(activeAccountGraph(page)))
					await panAccountGraphNodeIntoView(page, id);
				await focusAccountGraph(page);
				await expectReadableAccountGraph(page);
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
				await selectionJourney(page, baseline, text, locale, width);
				await page.reload();
				await fullFamily(page, baseline, text);
				await reopenFamily(context, rootHref, baseline, text, errors);
				await exerciseLatestLayoutRequest(page, hrefs, baseline, text);
				for (let repeat = 0; repeat < 2; repeat++) {
					const open = repeat === 0;
					await setAccountRelationDetailsOpen(page, open);
					if (open)
						await expect(
							details.locator(".relation-row").first(),
						).toBeVisible();
					else
						await expect(details.locator(".relation-row").first()).toBeHidden();
					await page
						.getByRole("button", { name: text.direct, exact: true })
						.click();
					await expect(details).toHaveJSProperty("open", open);
					await fullFamily(page, baseline, text);
				}

				const added: Connection = {
					from: "video",
					to: "phoneA",
					purpose: "recoveryPhone",
					verified: true,
				};
				const withAdded = [...baseline, added];
				await addScenarioConnection(page, hrefs, added, text);
				await page.goto(rootHref);
				await fullFamily(page, withAdded, text);
				await page.reload();
				await fullFamily(page, withAdded, text);

				// Removing one purpose must preserve the other purpose for the same source and target.
				const removed = initialConnections[0];
				await page.goto(detailsHref(hrefs, removed.from));
				await setAccountRelationDetailsOpen(page);
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
				await expectBalancedScenario(page, hrefs, afterDelete);
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
				if (width === 1536)
					await largeFamilyCheckpoints(page, hrefs, afterDelete, text, locale);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

for (const { locale, width } of [
	{ locale: "zh-CN", width: 390 },
	{ locale: "en-US", width: 1536 },
] as const) {
	test(`${locale} ${width}px graph navigation controls stay reachable and change the real viewport`, async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const text = copy(locale);
		const context = await browser.newContext({
			locale,
			viewport: { width, height: width === 1536 ? 1024 : 844 },
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			const hrefs = new Map<AccountKey, string>();
			const keys = [
				...accounts.map((record) => record.key),
				...Array.from({ length: 12 }, (_, index) => `extra-${index + 13}`),
			];
			for (const key of keys)
				hrefs.set(key, await createScenarioAccount(page, key, text));
			const expected: Connection[] = keys.slice(1).map((from) => ({
				from,
				to: "mail",
				purpose: "email",
				verified: true,
			}));
			for (const connection of expected)
				await addScenarioConnection(page, hrefs, connection, text);
			await page.goto(detailsHref(hrefs, "mail"));
			await fullFamily(page, expected, text);
			await expectCanvasActionsOutsideStage(page);
			await exerciseAccountGraphControls(page);
			await exerciseAccountGraphMiniMap(page);
			const expand = page.locator("#account-graph-expand");
			await expand.click();
			await expect(expandedGraphDialog(page)).toBeVisible();
			await waitForAccountGraphLayout(page, { nodes: 24, edges: 23 });
			await expectCanvasActionsOutsideStage(page);
			await exerciseAccountGraphControls(page);
			await exerciseAccountGraphMiniMap(page);
			if (evidence)
				await page.screenshot({
					path: join(
						evidence,
						`account-graph-navigation-${locale}-${width}.png`,
					),
					animations: "disabled",
				});
			await page.keyboard.press("Escape");
			await expect(expandedGraphDialog(page)).toBeHidden();
			await expect(expand).toBeFocused();
			await expectCanvasActionsOutsideStage(page);
			if (width === 390) {
				await page.setViewportSize({ width: 360, height: 844 });
				await waitForAccountGraphLayout(page, { nodes: 24, edges: 23 });
				await expectCanvasActionsOutsideStage(page);
				await exerciseAccountGraphControls(page);
				await exerciseAccountGraphMiniMap(page);
				if (evidence)
					await page.screenshot({
						path: join(evidence, `account-graph-navigation-${locale}-360.png`),
						animations: "disabled",
					});
			}
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
