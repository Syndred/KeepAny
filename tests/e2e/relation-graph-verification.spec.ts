import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { selectChoice } from "./helpers/select-choice";
import { expectReadableAccountGraph } from "./helpers/account-graph";

test.use({ actionTimeout: 15_000 });
const password = "graph-verification-backup";
const hubName = "connected-owner-with-a-long-email@example.test";
const evidence = process.env.KEEPANY_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280] as const) {
		test(`${locale} graph verification and mixed groups remain accurate at ${width}px`, async ({ browser }) => {
			test.setTimeout(locale === "en-US" && width === 1280 ? 240_000 : 120_000);
			const zh = locale === "zh-CN";
			const text = zh ? {
				add: "新增", name: "名称", save: "保存", addRelation: "添加关联", target: "关联至", label: "关联用途", verifiedAt: "最近核验",
				verified: "已核实", pending: "待核实", mixed: "含待核实关系", legend: "实线为已核实关系，虚线含待核实关系",
				deleteRelation: "删除关系", backup: "创建备份", download: "保存备份文件", preview: "预览", restore: /确认 ·/, restored: /已恢复 \d+ 条记录/,
			} : {
				add: "Add", name: "Name", save: "Save", addRelation: "Add connection", target: "Connect to", label: "Connection label", verifiedAt: "Last verified",
				verified: "Verified", pending: "To verify", mixed: "Includes connections to verify", legend: "Solid lines are verified; dashed lines include connections to verify.",
				deleteRelation: "Delete connection", backup: "Create backup", download: "Save backup file", preview: "Preview", restore: /Confirm ·/, restored: /Restored \d+ records/,
			};
			const context = await browser.newContext({ locale, viewport: { width, height: 844 }, acceptDownloads: true });
			const contexts = [context];
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			async function account(name: string) {
				await page.goto("/assets/account");
				await page.getByRole("button", { name: text.add, exact: true }).click();
				const dialog = page.getByRole("dialog");
				await dialog.getByLabel(text.name, { exact: true }).fill(name);
				await dialog.getByRole("button", { name: text.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				const card = page.locator("main .list-row").filter({ hasText: name });
				const href = await card.getAttribute("href");
				if (!href) throw Error("graph-account-link-missing");
				await card.click();
				await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
				return href;
			}
			async function connect(target: string, label: string, verified = false) {
				await page.getByRole("button", { name: text.addRelation, exact: true }).click();
				const dialog = page.getByRole("dialog");
				await selectChoice(dialog.getByLabel(text.target, { exact: true }), { label: target });
				await dialog.getByLabel(text.label, { exact: true }).fill(label);
				if (verified) await dialog.getByLabel(text.verifiedAt, { exact: true }).fill("2026-09-20");
				await dialog.getByRole("button", { name: text.save, exact: true }).click();
				await expect(dialog).toBeHidden();
			}
			async function graphGeometry(targetPage: Page) {
				for (const edge of await targetPage.locator(".react-flow__edge-path").all()) {
					const path = await edge.getAttribute("d");
					expect(path, "Connections use finite React Flow smooth-step paths").toMatch(/^M[-\d.,\s]+[LQ]/);
					expect(path).not.toMatch(/NaN|Infinity/);
					expect(await edge.evaluate(element => (element as SVGPathElement).getTotalLength())).toBeGreaterThan(0);
				}
				for (const label of await targetPage.locator(".asset-graph-label").all()) {
					expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Node labels fit inside their own box").toBe(true);
					const title = await label.getAttribute("title");
					expect(title).toContain(await label.locator("strong").textContent() ?? "");
					if (await label.locator("small").count()) expect(title).toContain(await label.locator("small").textContent() ?? "");
				}
				const gap = await targetPage.locator(".graph").evaluate(graph => {
					const nodes = [...graph.querySelectorAll(".react-flow__node")].map(node => node.getBoundingClientRect());
					const apart = nodes.every((left, i) => nodes.slice(i + 1).every(right => left.right + 5 <= right.left || right.right + 5 <= left.left || left.bottom + 5 <= right.top || right.bottom + 5 <= left.top));
					if (!apart) return false;
					return [...graph.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].every(path => {
						const matrix = path.getScreenCTM();
						if (!matrix) return false;
						const endpoints = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())].map(point => new DOMPoint(point.x, point.y).matrixTransform(matrix));
						const facing = nodes.some(node => Math.abs(endpoints[0].x - node.right) <= 5 && endpoints[0].y >= node.top && endpoints[0].y <= node.bottom)
							&& nodes.some(node => Math.abs(endpoints[1].x - node.left) <= 5 && endpoints[1].y >= node.top && endpoints[1].y <= node.bottom);
						const clear = Array.from({ length: 39 }, (_, index) => (index + 1) / 40).every(fraction => {
							const point = path.getPointAtLength(path.getTotalLength() * fraction);
							const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
							return nodes.every(node => screen.x <= node.left + 2 || screen.x >= node.right - 2 || screen.y <= node.top + 2 || screen.y >= node.bottom - 2);
						});
						return facing && clear;
					});
				});
				expect(gap, "Nodes do not overlap and directed edges use right/left handles without crossing cards").toBe(true);
				expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			}
			async function allNodesInFrame(targetPage: Page) {
				await expect.poll(() => targetPage.locator(".graph").evaluate(graph => {
					const bounds = graph.getBoundingClientRect();
					return [...graph.querySelectorAll(".react-flow__node")].every(node => {
						const rect = node.getBoundingClientRect();
						return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
					});
				}), { message: "Manual fit shows every family node inside the viewport" }).toBe(true);
			}
			async function graphState(targetPage: Page, mixed = false) {
				await expect(targetPage.locator(".react-flow__node")).toHaveCount(3);
				await expectReadableAccountGraph(targetPage);
				for (const node of await targetPage.locator(".react-flow__node").all()) await expect(node).toBeVisible();
				const solid = targetPage.locator(".relation-graph-edge--verified");
				const dashed = targetPage.locator(".relation-graph-edge--pending");
				await expect(solid).toHaveCount(mixed ? 0 : 1);
				await expect(dashed).toHaveCount(mixed ? 2 : 1);
				await expect(targetPage.getByText(text.legend, { exact: true })).toBeVisible();
				if (!mixed) {
					await expect(solid).toHaveAttribute("aria-label", `${hubName} → Verified account · Verified link · ${text.verified}`);
					await expect(solid.locator(".react-flow__edge-path")).toHaveCSS("stroke-dasharray", "none");
				} else {
					const mixedEdge = dashed.filter({ hasText: "Extra pending" });
					await expect(mixedEdge).toContainText("Verified link");
					await expect(mixedEdge).toHaveAttribute("aria-label", new RegExp(` · ${text.mixed}$`));
				}
				for (const edge of await dashed.all()) await expect(edge.locator(".react-flow__edge-path")).toHaveCSS("stroke-dasharray", "5px, 4px");
				await expect(dashed.filter({ hasText: "Pending link" })).toHaveAttribute("aria-label", `Pending account → ${hubName} · Pending link · ${text.pending}`);
				await graphGeometry(targetPage);
			}
			try {
				await account("Verified account");
				await account("Pending account");
				const hub = await account(hubName);
				await connect("Verified account", "Verified link", true);
				await page.goto("/assets/account");
				await page.locator("main .list-row").filter({ hasText: "Pending account" }).click();
				await connect(hubName, "Pending link");
				await page.goto(hub);
				await graphState(page);
				await page.locator(".graph").scrollIntoViewIfNeeded();
				await page.screenshot({ path: evidence ? `${evidence}/relation-graph-${locale}-${width}.png` : test.info().outputPath(`relation-graph-${locale}-${width}.png`) });
				await connect("Verified account", "Extra pending");
				await graphState(page, true);
				await page.reload();
				await graphState(page, true);
				await page.getByRole("button", { name: `${text.deleteRelation} · Extra pending · Verified account`, exact: true }).click();
				await page.getByRole("dialog").getByRole("button", { name: text.deleteRelation, exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await graphState(page);
				await page.reload();
				await graphState(page);
				await connect("Pending account", "Reverse pending");
				await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
				const pendingLabel = page.locator(".react-flow__edge").filter({ hasText: "Pending link" }).locator(".react-flow__edge-textwrapper");
				const reverseLabel = page.locator(".react-flow__edge").filter({ hasText: "Reverse pending" }).locator(".react-flow__edge-textwrapper");
				await expect.poll(async () => {
					const [left, right] = await Promise.all([pendingLabel.boundingBox(), reverseLabel.boundingBox()]);
					return !!left && !!right && (left.x + left.width <= right.x || right.x + right.width <= left.x || left.y + left.height <= right.y || right.y + right.height <= left.y);
				}, { message: "Reciprocal connection labels have separate readable lanes" }).toBe(true);
				await graphGeometry(page);
				await page.getByRole("button", { name: `${text.deleteRelation} · Reverse pending · Pending account`, exact: true }).click();
				await page.getByRole("dialog").getByRole("button", { name: text.deleteRelation, exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await graphState(page);
				await page.locator(".react-flow__controls-fitview").click();
				await page.locator(".react-flow__node").filter({ hasText: "Pending account" }).click();
				await expect(page.getByRole("heading", { name: "Pending account", exact: true })).toBeVisible();
				await expect(page.locator(".relation-graph-edge--pending")).toHaveCount(1);
				if (width === 390) {
					await page.goto("/intake");
					await page.locator("#backup-password").fill(password);
					await page.getByRole("button", { name: text.backup, exact: true }).click();
					const link = page.getByRole("link", { name: text.download, exact: true });
					await expect(link).toBeVisible();
					const downloading = page.waitForEvent("download");
					await link.click();
					const path = await (await downloading).path();
					if (!path) throw Error("graph-backup-download-missing");
					const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
					const records = JSON.parse(strFromU8(entries["records.json"])) as Array<{ type: string; payload: string }>;
					const rows = records.filter((row) => row.type === "relation").map((row) => JSON.parse(row.payload));
					expect(rows.find((row) => row.label === "Verified link")).toMatchObject({ verifiedAt: "2026-09-20", deleted: false });
					expect(rows.find((row) => row.label === "Extra pending")).toMatchObject({ deleted: true });
					const restored = await browser.newContext({ locale, viewport: { width, height: 844 } });
					contexts.push(restored);
					const target = await restored.newPage();
					target.on("pageerror", (error) => errors.push(error.message));
					await target.goto("/intake");
					await target.locator("#restore-file").setInputFiles(path);
					await target.locator("#backup-password").fill(password);
					await target.locator("details").filter({ has: target.locator("#restore-file") }).getByRole("button", { name: text.preview, exact: true }).click();
					await target.getByRole("button", { name: text.restore }).click();
					await expect(target.getByRole("main")).toContainText(text.restored);
					await target.goto(hub);
					await graphState(target);
					await target.locator(".graph").scrollIntoViewIfNeeded();
					await target.screenshot({ path: test.info().outputPath(`relation-graph-restored-${locale}-${width}.png`) });
				}
				for (let index = 1; index <= 4; index += 1) {
					await account(`Additional service ${index}`);
					await connect(hubName, `Login link ${index}`);
				}
				await page.goto(hub);
				await expect(page.locator(".react-flow__node")).toHaveCount(7);
				await expect(page.locator(".react-flow__edge-path")).toHaveCount(6);
				await expectReadableAccountGraph(page);
				await graphGeometry(page);
				await page.locator(".react-flow__controls-fitview").click();
				await allNodesInFrame(page);
				await page.locator(".graph").scrollIntoViewIfNeeded();
				await page.screenshot({ path: evidence ? `${evidence}/relation-graph-six-${locale}-${width}.png` : test.info().outputPath(`relation-graph-six-${locale}-${width}.png`) });
				if (locale === "en-US" && width === 1280) {
					// Keep the original small-family checks above, then grow the same fixture
					// through the app's normal forms to reproduce a 49-account legacy family.
					for (let index = 1; index <= 42; index++) {
						await account(`Large family service ${index}`);
						await connect(hubName, `Large family link ${index}`);
					}
					await page.goto(hub);
					await expect(page.locator(".react-flow__node")).toHaveCount(49);
					await expect(page.locator(".react-flow__edge-path")).toHaveCount(48);
					await expectReadableAccountGraph(page);
					await page.getByRole("button", { name: "All connections", exact: true }).click();
					await expect(page.locator(".react-flow__node")).toHaveCount(49);
					await expectReadableAccountGraph(page);
					await page.getByRole("button", { name: "Fit all", exact: true }).click();
					await allNodesInFrame(page);
					await page.locator(".graph").scrollIntoViewIfNeeded();
					await page.screenshot({ path: evidence ? `${evidence}/relation-graph-49-en-US-1280.png` : test.info().outputPath("relation-graph-49-en-US-1280.png") });
					await page.getByRole("button", { name: "Center account", exact: true }).click();
					await expectReadableAccountGraph(page);
				}

				expect(errors).toEqual([]);
			} finally {
				for (const opened of contexts) await opened.close();
			}
		});
	}
}
