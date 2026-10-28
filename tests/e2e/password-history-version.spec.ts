import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { inspectVisualKdbx, visualCopy, visualMaster } from "./fixtures/password-smart-import-visual";
import { openVaultAccess, revealPasswordEntries } from "./helpers/vault-access";

// All records and credentials are synthetic. Setup, editing, history actions,
// export and reopening use the actual compiled UI; KDBX inspection is read-only.
const title = "FC18 history selection";
const otherTitle = "FC18 unaffected entry";
const usernames = ["first@example.test", "second@example.test", "third@example.test"];
const passwords = ["Synthetic-FC18-first!42", "Synthetic-FC18-second!42", "Synthetic-FC18-third!42"];
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

for (const language of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${language} ${width} history versions select the original saved revision after reload`, async ({ browser, request, baseURL }, info) => {
		test.setTimeout(150_000);
		const t = visualCopy(language);
		const context = await browser.newContext({ baseURL, locale: language === "en" ? "en-US" : language, viewport: { width, height: 900 }, acceptDownloads: true });
		context.setDefaultTimeout(15_000);
		await context.addInitScript(value => localStorage.setItem("keepany-language", value), language);
		const page = await context.newPage();
		const folder = join(process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/password-history-version/evidence", `fc18-${language}-${width}`);
		mkdirSync(folder, { recursive: true });
		const steps: Record<string, unknown>[] = [];
		const indexSha256 = sha(await (await request.get("/")).body());
		const entry = () => page.locator(".password-vault-entry").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
		const close = async () => {
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultClose"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
		};
		const capture = async (name: string) => {
			const path = join(folder, `${name}.png`);
			await page.screenshot({ path });
			steps.push({ stage: "screenshot", name, path, sha256: sha(readFileSync(path)), visual: "separate-required" });
		};
		const history = async (expected: number[]) => {
			await entry().getByRole("button", { name: t("pwVaultHistory"), exact: true }).click();
			const rows = page.locator(".password-vault-history-row");
			await expect(rows).toHaveCount(expected.length);
			await expect(rows.locator("strong")).toHaveText(expected.map((_, index) => t("pwVaultHistoryVersion", { count: index + 1 })));
			for (const [index, revision] of expected.entries()) await expect(rows.nth(index)).toContainText(usernames[revision]);
			steps.push({ stage: "history", versions: expected.map((revision, index) => ({ version: index + 1, savedRevision: revision + 1 })) });
			return rows;
		};
		const edit = async (revision: number) => {
			await entry().getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-username").fill(usernames[revision]);
			await page.locator("#password-vault-entry-password").fill(passwords[revision]);
			await page.locator("#password-vault-entry-notes").fill(`Synthetic FC18 saved revision ${revision + 1}`);
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await expect(entry()).toContainText(usernames[revision]);
		};
		const inspect = async (name: string) => {
			const downloading = page.waitForEvent("download");
			await page.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
			const download = await downloading;
			const path = info.outputPath(`${name}.kdbx`);
			await download.saveAs(path);
			try { return await inspectVisualKdbx(path); }
			finally { await download.delete(); }
		};
		let status = "failed";
		try {
			await page.goto("/");
			if (width < 768) await page.locator(".mobile-menu").click();
			await page.getByRole("link", { name: language === "zh-CN" ? "账号" : "Accounts", exact: true }).click();
			await expect(page.locator("main.unified-accounts-page")).toBeVisible();
			await openVaultAccess(page);
			await page.locator("#password-vault-master").fill(visualMaster);
			await page.locator("#password-vault-master-confirm").fill(visualMaster);
			await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			for (const name of [title, otherTitle]) {
				await page.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
				await page.locator("#password-vault-entry-title").fill(name);
				await page.locator("#password-vault-entry-username").fill(usernames[0]);
				await page.locator("#password-vault-entry-password").fill(passwords[0]);
				await page.locator("#password-vault-entry-notes").fill("Synthetic FC18 saved revision 1");
				await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
				await expect(page.getByRole("dialog")).toHaveCount(0);
			}
			await revealPasswordEntries(page);
			await entry().getByRole("button", { name: t("pwVaultHistory"), exact: true }).click();
			await expect(page.getByRole("dialog")).toContainText(t("pwVaultHistoryEmpty"));
			await capture("empty-history");
			await close();
			await edit(1);
			await history([0]);
			await capture("one-history");
			await close();
			await edit(2);
			const baseline = await inspect("before-history-actions");
			expect(baseline).toHaveLength(2);
			const before = baseline.find(row => row.draft.title === title);
			const untouched = baseline.find(row => row.draft.title === otherTitle);
			if (!before || !untouched) throw Error("Synthetic history baseline missing");
			expect(before.history.map(row => row.draft.username)).toEqual(usernames.slice(0, 2));
			steps.push({ stage: "baseline", entryId: before.draft.id, otherEntryId: untouched.draft.id, historySha256: sha(JSON.stringify(before.history)) });
			let rows = await history([0, 1]);
			await capture("multiple-history");
			await rows.nth(0).getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click();
			await expect(rows.nth(0).locator("code")).toHaveText(passwords[0]);
			await rows.nth(0).getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true }).click();
			await expect(rows.nth(0).locator("code")).toHaveCount(0);
			await close();
			expect(await inspect("cancel-history")).toEqual(baseline);
			rows = await history([0, 1]);
			await rows.nth(0).getByRole("button", { name: t("pwVaultHistoryRestore"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			let current = await inspect("restore-version-one");
			let target = current.find(row => row.draft.id === before.draft.id);
			expect(target?.draft.username).toBe(usernames[0]);
			expect(target?.draft.password).toBe(passwords[0]);
			expect(target?.draft.notes).toBe("Synthetic FC18 saved revision 1");
			expect(target?.history.map(row => row.draft.username)).toEqual(usernames);
			expect(target?.history.slice(0, 2)).toEqual(before.history);
			expect(target?.history[2].draft).toEqual(before.draft);
			expect(current.find(row => row.draft.id === untouched.draft.id)).toEqual(untouched);
			const firstRestored = target;
			steps.push({ stage: "restored-version-one", historySha256: sha(JSON.stringify(target?.history)), previousHistoryPreserved: true, previousCurrentDraftPreserved: true });
			rows = await history([0, 1, 2]);
			await capture("after-first-restore");
			await rows.nth(1).getByRole("button", { name: t("pwVaultHistoryRestore"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			current = await inspect("restore-version-two");
			target = current.find(row => row.draft.id === before.draft.id);
			expect(target?.draft.username).toBe(usernames[1]);
			expect(target?.draft.password).toBe(passwords[1]);
			expect(target?.draft.notes).toBe("Synthetic FC18 saved revision 2");
			expect(target?.history.map(row => row.draft.username)).toEqual([...usernames, usernames[0]]);
			expect(target?.history.slice(0, 3)).toEqual(firstRestored?.history);
			expect(target?.history[3].draft).toEqual(firstRestored?.draft);
			expect(current.find(row => row.draft.id === untouched.draft.id)).toEqual(untouched);
			steps.push({ stage: "restored-version-two", historySha256: sha(JSON.stringify(target?.history)), previousHistoryPreserved: true, previousCurrentDraftPreserved: true });
			await page.reload();
			await openVaultAccess(page);
			await page.locator("#password-vault-unlock-master").fill(visualMaster);
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			await revealPasswordEntries(page);
			expect(await inspect("after-reload")).toEqual(current);
			await history([0, 1, 2, 0]);
			await capture("after-reload-history");
			await close();
			steps.push({ stage: "preserved", entryId: before.draft.id, otherEntryId: untouched.draft.id, historyCount: target?.history.length, finalRevision: 2 });
			status = "passed";
		} finally {
			writeFileSync(join(folder, "result.json"), JSON.stringify({ status, language, width, indexSha256, steps }, null, 2));
			await context.close();
		}
	});
}
