import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { selectChoice } from "./helpers/select-choice";
import { clickAccountGraphBlank, expectReadableAccountGraph, expectAccountGraphGeometry, expectAllAccountGraphNodesInFrame, setAccountRelationDetailsOpen, waitForAccountGraphLayout } from "./helpers/account-graph";

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
				details: "关联详情", close: "关闭",
				deleteRelation: "删除关系", fit: "适应画布", backup: "创建备份", download: "保存备份文件", preview: "预览", restore: /确认 ·/, restored: /已恢复 \d+ 条记录/,
			} : {
				add: "Add", name: "Name", save: "Save", addRelation: "Add connection", target: "Connect to", label: "Connection label", verifiedAt: "Last verified",
				verified: "Verified", pending: "To verify", mixed: "Includes connections to verify", legend: "Solid lines are verified; dashed lines include connections to verify.",
				details: "Connection details", close: "Close",
				deleteRelation: "Delete connection", fit: "Fit all", backup: "Create backup", download: "Save backup file", preview: "Preview", restore: /Confirm ·/, restored: /Restored \d+ records/,
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
				await waitForAccountGraphLayout(targetPage);
				await expect(targetPage.locator(".react-flow__edge-textwrapper"), "Account connections keep the canvas free of repeated text").toHaveCount(0);
				for (const edge of await targetPage.locator(".react-flow__edge-path").all()) {
					const path = await edge.getAttribute("d");
					expect(path, "Connections use finite routed SVG paths").toMatch(/^M/);
					expect(path).not.toMatch(/NaN|Infinity/);
					expect(await edge.evaluate(element => (element as SVGPathElement).getTotalLength())).toBeGreaterThan(0);
					await expect(edge, "Every account connection exposes its direction").toHaveAttribute("marker-end", /url\(.+\)/);
				}
				for (const label of await targetPage.locator(".asset-graph-label").all()) {
					expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Node labels fit inside their own box").toBe(true);
					const title = await label.getAttribute("title");
					expect(title).toContain(await label.locator("strong").textContent() ?? "");
					if (await label.locator("small").count()) expect(title).toContain(await label.locator("small").textContent() ?? "");
				}
				await expectAccountGraphGeometry(targetPage);
				expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			}
			async function allNodesInFrame(targetPage: Page) {
				await expectAllAccountGraphNodesInFrame(targetPage);
			}
			async function selectConnection(targetPage: Page, edge: Locator, from: string, to: string, labels: string[], status: string, key = "Enter") {
				await waitForAccountGraphLayout(targetPage);
				// A horizontal SVG group has zero bbox height even when its stroke is visible.
				await expect(edge).toHaveCSS("visibility", "visible");
				await expect(edge).not.toHaveCSS("display", "none");
				const path = edge.locator(".react-flow__edge-path");
				await expect(path).toHaveCSS("visibility", "visible");
				await expect(path).not.toHaveCSS("display", "none");
				expect(await path.evaluate(element => (element as SVGPathElement).getTotalLength())).toBeGreaterThan(0);
				await expect(edge).toHaveAttribute("tabindex", "0");
				await edge.focus();
				await expect(edge).toBeFocused();
				await edge.press(key);
				await expect(targetPage.locator(".react-flow__edge.selected")).toHaveCount(1);
				await expect(edge).toHaveClass(/\bselected\b/);
				await expect(edge.locator(".react-flow__edge-path")).toHaveCSS("stroke-width", "4px");
				const panel = targetPage.getByRole("region", { name: text.details, exact: true });
				await expect(targetPage.locator(".account-graph-selection-panel")).toHaveCount(1);
				await expect(panel).toBeVisible();
				await expect(panel.locator(".account-graph-selection-title")).toHaveText(`${from} → ${to}`);
				await expect.poll(async () => (await panel.locator(".account-graph-selection-labels > li").allTextContents()).sort()).toEqual([...labels].sort());
				await expect(panel.locator(".account-graph-selection-status")).toHaveText(status);
				for (const other of await targetPage.locator(".react-flow__edge:not(.selected) .react-flow__edge-path").all()) await expect(other).toHaveCSS("opacity", "0.25");
				const clear = await panel.evaluate(element => {
					const bounds = element.getBoundingClientRect();
					return [...element.querySelectorAll("p, li, button")].every(child => {
						const rect = child.getBoundingClientRect();
						return child.scrollWidth <= child.clientWidth + 1 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
					});
				});
				expect(clear, "Selected connection details wrap inside one readable panel").toBe(true);
				return panel;
			}
			async function graphState(targetPage: Page, mixed = false) {
				await expect(targetPage.locator(".react-flow__node")).toHaveCount(3);
				await expectReadableAccountGraph(targetPage);
				for (const node of await targetPage.locator(".react-flow__node").all()) await expect(node).toBeVisible();
				const solid = targetPage.locator(".relation-graph-edge--verified");
				const dashed = targetPage.locator(".relation-graph-edge--pending");
				await expect(solid).toHaveCount(mixed ? 0 : 1);
				await expect(dashed).toHaveCount(mixed ? 2 : 1);
				const guide = targetPage.locator("details.account-graph-guide");
				await expect(guide).toHaveCount(1);
				const expanded = targetPage.getByRole("dialog", { name: /^(账号族谱|Account connections)$/, exact: true });
				if (!(await expanded.isVisible()) && !(await guide.evaluate(element => (element as HTMLDetailsElement).open))) {
					await guide.locator(":scope > summary").click();
				}
				await expect(guide).toHaveJSProperty("open", true);
				await expect(guide.getByText(text.legend, { exact: true })).toBeVisible();
				let selected: Locator;
				if (!mixed) {
					await expect(solid).toHaveAttribute("aria-label", `${hubName} → Verified account · Verified link · ${text.verified}`);
					await expect(solid.locator(".react-flow__edge-path")).toHaveCSS("stroke-dasharray", "none");
					selected = await selectConnection(targetPage, solid, hubName, "Verified account", ["Verified link"], text.verified);
				} else {
					const mixedEdge = dashed.and(targetPage.locator('[aria-label*="Extra pending"]'));
					await expect(mixedEdge).toHaveAttribute("aria-label", new RegExp(` · ${text.mixed}$`));
					expect([
						`${hubName} → Verified account · Verified link · Extra pending · ${text.mixed}`,
						`${hubName} → Verified account · Extra pending · Verified link · ${text.mixed}`,
					]).toContain(await mixedEdge.getAttribute("aria-label"));
					selected = await selectConnection(targetPage, mixedEdge, hubName, "Verified account", ["Verified link", "Extra pending"], text.mixed);
				}
				await selected.getByRole("button", { name: text.close, exact: true }).click();
				await expect(selected).toBeHidden();
				await expect(targetPage.locator(".react-flow__edge.selected")).toHaveCount(0);
				for (const edge of await dashed.all()) await expect(edge.locator(".react-flow__edge-path")).toHaveCSS("stroke-dasharray", "5px, 4px");
				const pendingEdge = dashed.and(targetPage.locator('[aria-label*="Pending link"]'));
				await expect(pendingEdge).toHaveAttribute("aria-label", `Pending account → ${hubName} · Pending link · ${text.pending}`);
				await selectConnection(targetPage, pendingEdge, "Pending account", hubName, ["Pending link"], text.pending, "Space");
				await pendingEdge.press("Backspace");
				await expect(targetPage.locator(".react-flow__edge-path")).toHaveCount(2);
				await clickAccountGraphBlank(targetPage);
				await expect(targetPage.getByRole("region", { name: text.details, exact: true })).toBeHidden();
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
				await setAccountRelationDetailsOpen(page);
				await page.getByRole("button", { name: `${text.deleteRelation} · Extra pending · Verified account`, exact: true }).click();
				await page.getByRole("dialog").getByRole("button", { name: text.deleteRelation, exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await graphState(page);
				await page.reload();
				await graphState(page);
				await connect("Pending account", "Reverse pending");
				await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
				const pendingEdge = page.locator('.react-flow__edge[aria-label*="Pending link"]');
				const reverseEdge = page.locator('.react-flow__edge[aria-label*="Reverse pending"]');
				await selectConnection(page, pendingEdge, "Pending account", hubName, ["Pending link"], text.pending);
				const reverseDetails = await selectConnection(page, reverseEdge, hubName, "Pending account", ["Reverse pending"], text.pending);
				await expect(reverseDetails).not.toContainText("Pending link");
				await reverseDetails.getByRole("button", { name: text.close, exact: true }).click();
				await graphGeometry(page);
				await setAccountRelationDetailsOpen(page);
				await page.getByRole("button", { name: `${text.deleteRelation} · Reverse pending · Pending account`, exact: true }).click();
				await page.getByRole("dialog").getByRole("button", { name: text.deleteRelation, exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await graphState(page);
				await page.locator(".account-graph-view-actions").getByRole("button", { name: text.fit, exact: true }).click();
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
				await page.locator(".account-graph-view-actions").getByRole("button", { name: text.fit, exact: true }).click();
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
					await page.locator(".account-graph-view-actions").getByRole("button", { name: "Fit all", exact: true }).click();
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
