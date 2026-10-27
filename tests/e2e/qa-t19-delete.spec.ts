import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
const rp = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const dp = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
for (const zh of [true, false]) for (const width of [390, 1280]) {
	test(`${zh ? "zh" : "en"} ${width} T19-04 delete cancel, stale protection, retry and refresh`, async ({ browser }) => {
		const context = await browser.newContext({ locale: zh ? "zh-CN" : "en-US", viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
		try {
			await page.goto("/");
			const fixture = await page.evaluate(async ([rp, dp]) => {
				const db = await (await import(rp)).localRepository(); const { newAsset, submissionSchema } = await import(dp);
				const asset = { ...newAsset("project"), name: "T19 delete project" };
				const original = submissionSchema.parse({ id: crypto.randomUUID(), assetId: asset.id, name: "T19 first", url: "https://one.example/", status: "submitted", submittedAt: "2026-10-27", evidence: "Synthetic receipt" });
				const other = { ...original, id: crypto.randomUUID(), name: "T19 untouched", url: "https://two.example/" };
				await db.saveBatch([{ type: "asset", value: asset }, { type: "submission", value: original }, { type: "submission", value: other }]); return { asset, original, other };
			}, [rp, dp]);
			const read = () => page.evaluate(async path => (await (await import(path)).localRepository()).list("submission", true), rp);
			await page.goto(`/assets/project/${fixture.asset.id}`);
			await page.locator("#asset-backlinks > summary").click();
			const row = page.locator("#asset-backlinks tr").filter({ has: page.getByRole("link", { name: "T19 first", exact: true }) });
			const del = zh ? "删除" : "Delete", cancel = zh ? "取消" : "Cancel";
			await row.getByRole("button", { name: del, exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: cancel, exact: true }).click();
			expect((await read()).find((entry: { id: string }) => entry.id === fixture.original.id)).toEqual(fixture.original);
			await row.getByRole("button", { name: del, exact: true }).click();
			await page.evaluate(async ({ rp, id }) => { const db = await (await import(rp)).localRepository(); const current = await db.get("submission", id); await db.saveSubmissionIfCurrent(current, { ...current, evidence: "Newer evidence" }); }, { rp, id: fixture.original.id });
			await page.getByRole("dialog").getByRole("button", { name: del, exact: true }).click();
			await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
			expect((await read()).find((entry: { id: string }) => entry.id === fixture.original.id)).toMatchObject({ deleted: false, evidence: "Newer evidence" });
			await page.getByRole("dialog").getByRole("button", { name: cancel, exact: true }).click();
			await row.getByRole("button", { name: del, exact: true }).click();
			await page.evaluate(async path => { const db = await (await import(path)).localRepository(); const original = db.deleteSubmissionIfCurrent.bind(db); db.deleteSubmissionIfCurrent = async () => { db.deleteSubmissionIfCurrent = original; throw Error("synthetic write failure"); }; }, rp);
			await page.getByRole("dialog").getByRole("button", { name: del, exact: true }).click();
			await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
			expect((await read()).find((entry: { id: string }) => entry.id === fixture.original.id)?.deleted).toBe(false);
			await page.getByRole("dialog").getByRole("button", { name: del, exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			const records = await read();
			expect(records.find((entry: { id: string }) => entry.id === fixture.original.id)).toEqual({ ...fixture.original, evidence: "Newer evidence", deleted: true });
			expect(records.find((entry: { id: string }) => entry.id === fixture.other.id)).toEqual(fixture.other);
			await page.locator("#asset-backlinks > summary").click();
			await expect(page.getByRole("link", { name: "T19 first", exact: true })).toHaveCount(0);
			await expect(page.getByRole("link", { name: fixture.other.name, exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			if ((zh && width === 390) || (!zh && width === 1280)) { const path = "docs/qa/2026-10-27/evidence/T19-delete"; mkdirSync(path, { recursive: true }); await page.locator("#asset-backlinks").screenshot({ path: `${path}/${zh ? "zh-390" : "en-1280"}.png` }); }
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
