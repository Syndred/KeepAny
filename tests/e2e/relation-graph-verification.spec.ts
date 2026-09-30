import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { selectChoice } from "./helpers/select-choice";

test.use({ actionTimeout: 15_000 });
const password = "graph-verification-backup";

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280] as const) {
		test(`${locale} graph verification and mixed groups remain accurate at ${width}px`, async ({ browser }) => {
			test.setTimeout(120_000);
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
			async function graphState(targetPage: Page, mixed = false) {
				await expect(targetPage.locator(".react-flow__node")).toHaveCount(3);
				for (const node of await targetPage.locator(".react-flow__node").all()) await expect(node).toBeVisible();
				const solid = targetPage.locator(".relation-graph-edge--verified");
				const dashed = targetPage.locator(".relation-graph-edge--pending");
				await expect(solid).toHaveCount(mixed ? 0 : 1);
				await expect(dashed).toHaveCount(mixed ? 2 : 1);
				await expect(targetPage.getByText(text.legend, { exact: true })).toBeVisible();
				if (!mixed) {
					await expect(solid).toHaveAttribute("aria-label", `Verified link · ${text.verified}`);
					await expect(solid.locator(".react-flow__edge-path")).toHaveCSS("stroke-dasharray", "none");
				} else {
					const mixedEdge = dashed.filter({ hasText: "Extra pending" });
					await expect(mixedEdge).toContainText("Verified link");
					await expect(mixedEdge).toHaveAttribute("aria-label", new RegExp(` · ${text.mixed}$`));
				}
				for (const edge of await dashed.all()) await expect(edge.locator(".react-flow__edge-path")).toHaveCSS("stroke-dasharray", "5px, 4px");
				expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			}
			try {
				await account("Verified account");
				await account("Pending account");
				const hub = await account("Graph account");
				await connect("Verified account", "Verified link", true);
				await connect("Pending account", "Pending link");
				await graphState(page);
				await page.locator(".graph").scrollIntoViewIfNeeded();
				await page.screenshot({ path: test.info().outputPath(`relation-graph-${locale}-${width}.png`) });
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
				expect(errors).toEqual([]);
			} finally {
				for (const opened of contexts) await opened.close();
			}
		});
	}
}
