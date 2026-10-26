import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { decryptBackup, encryptBackup } from "../../packages/local-db/src/backup-crypto";
import { selectChoice } from "./helpers/select-choice";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

type Snapshot = {
	rows: { id: string; type: string; payload: string; updatedAt: number }[];
	files: { id: string; name: string; type: string; bytes: number[] }[];
};

async function snapshot(page: Page): Promise<Snapshot> {
	return page.evaluate(async modulePath => {
		const { localRepository } = await import(modulePath);
		const repo = await localRepository();
		const rows = (await repo.allRecords()).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
		const files = await Promise.all((await repo.fileStore.blobs.toArray()).map(async (file: { id: string; name: string; blob: Blob }) => ({
			id: file.id,
			name: file.name,
			type: file.blob.type,
			bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
		})));
		return { rows, files: files.sort((a, b) => a.id.localeCompare(b.id)) };
	}, repositoryModuleUrl);
}

async function addAsset(page: Page, kind: "project" | "account" | "subscription" | "item", name: string) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	if (kind === "subscription") {
		await dialog.locator("#amount").fill("12.50");
		await dialog.locator("#dueDate").fill("2026-10-31");
	}
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
	await page.getByText(name).first().click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function addRelation(page: Page, target: string, label: string, source = "") {
	await page.getByRole("button", { name: "Add connection" }).click();
	const dialog = page.getByRole("dialog");
	await selectChoice(dialog.getByLabel("Connect to"), { label: target });
	await dialog.getByLabel("Connection label").fill(label);
	if (source) await dialog.getByLabel("Connection source").fill(source);
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
}

async function restoreFromFile(page: Page, path: string, password: string) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(path);
	await page.getByRole("button", { name: "Preview", exact: true }).first().click();
	await expect(page.getByRole("button", { name: /Confirm ·/ })).toBeVisible();
	await page.getByRole("button", { name: /Confirm ·/ }).click();
	await expect(page.getByText(/Restored \d+ records/)).toBeVisible();
}

test("formal backup restores full local graph, history, ledger, tombstones and original images", async ({ browser }) => {
	test.setTimeout(180_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const password = `local-only-backup-${suffix}-2026`;
	const project = `Project ${suffix}`;
	const account = `Account ${suffix}`;
	const otherAccount = `Other account ${suffix}`;
	const subscription = `Subscription ${suffix}`;
	const item = `Camera ${suffix}`;
	const deletedProject = `Deleted project ${suffix}`;
	const task = `Inspect camera ${suffix}`;
	const source = await browser.newContext({ locale: "en-US", acceptDownloads: true, viewport: { width: 1280, height: 800 } });
	const page = await source.newPage();
	page.setDefaultTimeout(10_000);
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	try {
		for (const [kind, name] of [
			["project", project], ["account", account], ["account", otherAccount],
			["subscription", subscription], ["item", item], ["project", deletedProject],
		] as const) await addAsset(page, kind, name);

		await page.goto("/assets/project");
		await page.getByText(project, { exact: true }).first().click();
		await addRelation(page, account, "owner", `Account record ${suffix}`);
		await addRelation(page, otherAccount, "old owner");
		await page.getByRole("button", { name: "Add backlink" }).click();
		const backlink = page.getByRole("dialog");
		await backlink.getByLabel("Name").fill(`Directory ${suffix}`);
		await backlink.getByLabel("URL").fill(`https://example.com/${suffix}`);
		await backlink.getByRole("button", { name: "Save" }).click();
		await expect(backlink).toBeHidden();
		const ledgerRow = page.locator("tr").filter({ hasText: `Directory ${suffix}` });
		await ledgerRow.getByRole("button", { name: "Edit" }).click();
		await selectChoice(ledgerRow.getByRole("combobox"), "submitted");
		await ledgerRow.getByLabel(`Directory ${suffix} Submitted`).fill("2026-09-29");
		await ledgerRow.getByLabel(`Directory ${suffix} Evidence`).fill(`Local test receipt ${suffix}`);
		await ledgerRow.getByRole("button", { name: "Save" }).click();
		await expect(ledgerRow.locator(".backlink-status")).toHaveText("Submitted");
		await expect.poll(async () => {
			const row = (await snapshot(page)).rows.find(row => row.type === "submission");
			return row ? JSON.parse(row.payload).status : "missing";
		}).toBe("submitted");

		await page.goto("/assets/item");
		await page.getByText(item).first().click();
		await page.getByLabel("Notes").fill(`Lens cleaned ${suffix}`);
		await page.getByRole("button", { name: "Log maintenance" }).click();
		await expect(page.getByText(`Lens cleaned ${suffix}`)).toBeVisible();
		await page.locator("section").filter({ has: page.getByRole("heading", { name: "Tasks" }) }).getByRole("button", { name: "Add" }).click();
		const taskDialog = page.getByRole("dialog");
		await taskDialog.getByLabel("Name").fill(task);
		await taskDialog.getByLabel("Date").fill("2026-10-01");
		await taskDialog.getByRole("button", { name: "Save" }).click();
		await expect(taskDialog).toBeHidden();
		await page.locator(".list-row").filter({ hasText: task }).getByRole("button", { name: "Complete" }).click();
		await expect(page.locator(".list-row").filter({ hasText: task }).getByText("Completed")).toBeVisible();

		const imageBytes: number[][] = [];
		for (const color of ["#d93636", "#246ac2"]) {
			const base64 = await page.evaluate(color => {
				const canvas = document.createElement("canvas");
				canvas.width = 8; canvas.height = 8;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw Error("canvas unavailable");
				ctx.fillStyle = color; ctx.fillRect(0, 0, 8, 8);
				return canvas.toDataURL("image/png").split(",")[1];
			}, color);
			const bytes = Array.from(Buffer.from(base64, "base64"));
			imageBytes.push(bytes);
			await page.getByLabel("Add image").setInputFiles({ name: `camera-${imageBytes.length}.png`, mimeType: "image/png", buffer: Buffer.from(bytes) });
			const preview = page.getByRole("dialog");
			await expect(preview.getByRole("button", { name: "Confirm" })).toBeEnabled();
			await preview.getByRole("button", { name: "Confirm" }).click();
			await expect(preview).toBeHidden();
		}
		await expect(page.locator(".asset-image")).toHaveCount(2);
		await page.goto("/assets/subscription");
		await page.getByText(subscription).first().click();
		await page.getByRole("button", { name: "Record renewal" }).click();
		await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "History" }) }).locator(".list-row")).toHaveCount(1);

		await page.goto("/assets/project");
		await page.getByText(deletedProject).first().click();
		await page.getByRole("button", { name: "Move to trash" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
		await expect(page).toHaveURL(/\/assets\/project$/);
		await page.goto("/trash");
		await expect(page.getByText(deletedProject)).toBeVisible();

		await page.goto("/assets/project");
		await page.getByText(project, { exact: true }).first().click();
		await page.getByRole("button", { name: `Delete connection · old owner · ${otherAccount}` }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Delete connection" }).click();
		await expect(page.locator(".relation-row").filter({ hasText: "old owner" })).toHaveCount(0);
		await page.goto("/trash");
		await expect(page.locator(".relation-row").filter({ hasText: "old owner" })).toBeVisible();
		const before = await snapshot(page);
		const parsed = before.rows.map(row => ({ ...row, value: JSON.parse(row.payload) }));
		const mainProjectId = parsed.find(row => row.type === "asset" && row.value.name === project)?.value.id;
		expect(parsed.filter(row => row.type === "asset")).toHaveLength(6);
		expect(parsed.filter(row => row.type === "relation" && row.value.deleted)).toHaveLength(1);
		expect(parsed.filter(row => row.type === "relation" && !row.value.deleted && row.value.from === mainProjectId)).toHaveLength(1);
		expect(parsed.filter(row => row.type === "asset" && row.value.deleted)).toHaveLength(1);
		expect(parsed.filter(row => row.type === "submission" && row.value.status === "submitted" && row.value.assetId === mainProjectId)).toHaveLength(1);
		expect(parsed.filter(row => row.type === "history")).toHaveLength(2);
		expect(parsed.filter(row => row.type === "task" && row.value.done && row.value.completedAt)).toHaveLength(1);
		expect(before.files.map(file => file.name).sort()).toEqual(["camera-1.png", "camera-2.png"]);
		for (const file of before.files) {
			expect(file.type).toBe("image/png");
			expect(file.bytes).toEqual(imageBytes[Number(file.name.match(/camera-(\d+)\.png/)?.[1]) - 1]);
		}

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const saveFile = page.getByRole("link", { name: "Save backup file" });
		await expect(saveFile).toBeVisible();
		await page.screenshot({ path: `${evidence}/backup-ready-en-desktop.png`, fullPage: true });
		const downloadEvent = page.waitForEvent("download");
		await saveFile.click();
		const download = await downloadEvent;
		expect(download.suggestedFilename()).toMatch(/^keepany-\d{4}-\d{2}-\d{2}\.ka1$/);
		const path = await download.path();
		if (!path) throw Error("backup download missing");
		expect(readFileSync(path).length).toBeGreaterThan(52);
		await page.locator("#backup-password").fill(`wrong-password-${suffix}`);
		await page.locator("#restore-file").setInputFiles(path);
		await page.getByRole("button", { name: "Preview", exact: true }).first().click();
		await expect(page.getByText("Incorrect password or damaged backup.")).toBeVisible();
		await expect(page.getByRole("button", { name: /Confirm ·/ })).toHaveCount(0);
		await page.screenshot({ path: `${evidence}/restore-error-en-desktop.png`, fullPage: true });
		expect(await snapshot(page)).toEqual(before);
		await restoreFromFile(page, path, password);
		await page.screenshot({ path: `${evidence}/restore-success-en-desktop.png`, fullPage: true });
		expect(await snapshot(page)).toEqual(before);

		const destination = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
		const restored = await destination.newPage();
		restored.setDefaultTimeout(10_000);
		restored.on("pageerror", error => errors.push(error.message));
		try {
			await restored.goto("/assets/project");
			await expect(restored.getByText(project)).toHaveCount(0);
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(`wrong-password-${suffix}`);
			await restored.locator("#restore-file").setInputFiles(path);
			await restored.getByRole("button", { name: "Preview", exact: true }).first().click();
			await expect(restored.getByText("Incorrect password or damaged backup.")).toBeVisible();
			await restored.screenshot({ path: `${evidence}/restore-error-en-390.png`, fullPage: true });
			expect((await snapshot(restored)).rows).toHaveLength(0);
			await restoreFromFile(restored, path, password);
			await restored.screenshot({ path: `${evidence}/restore-success-en-390.png`, fullPage: true });
			const after = await snapshot(restored);
			expect(after).toEqual(before);
			await restored.locator("#backup-password").fill(password);
			await restored.getByRole("button", { name: "Create backup" }).click();
			await expect(restored.getByRole("link", { name: "Save backup file" })).toBeVisible();
			await restored.screenshot({ path: `${evidence}/backup-ready-en-390.png`, fullPage: true });
			await restored.reload();
			expect(await snapshot(restored)).toEqual(before);
			await restoreFromFile(restored, path, password);
			expect(await snapshot(restored)).toEqual(before);
			await restored.goto("/assets/project");
			await expect(restored.getByText(project, { exact: true }).first()).toBeVisible();
			await expect(restored.getByText(deletedProject)).toHaveCount(0);
			await restored.getByText(project, { exact: true }).first().click();
			await expect(restored.getByText(account).first()).toBeVisible();
			await expect(restored.getByText(otherAccount)).toHaveCount(0);
			await restored.locator(".asset-backlinks-card summary").click();
			await expect(restored.getByText(`Directory ${suffix}`)).toBeVisible();
			await restored.goto("/assets/item");
			await restored.getByText(item).first().click();
			await expect(restored.getByText(`Lens cleaned ${suffix}`)).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveCount(2);
			await expect(restored.locator(".list-row").filter({ hasText: task }).getByText("Completed")).toBeVisible();
			await restored.goto("/trash");
			await expect(restored.getByText(deletedProject)).toBeVisible();
			await restored.goto("/settings");
			await selectChoice(restored.locator("section.card").filter({ has: restored.getByRole("heading", { name: "Language" }) }).getByRole("combobox"), "zh-CN");
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.getByRole("button", { name: "创建备份" }).click();
			await expect(restored.getByRole("link", { name: "保存备份文件" })).toBeVisible();
			await restored.screenshot({ path: `${evidence}/backup-ready-zh-390.png`, fullPage: true });
			await restored.locator("#backup-password").fill(`wrong-password-${suffix}`);
			await restored.locator("#restore-file").setInputFiles(path);
			await restored.getByRole("button", { name: "预览", exact: true }).first().click();
			await expect(restored.getByText("密码不正确或备份已损坏。")).toBeVisible();
			await restored.screenshot({ path: `${evidence}/restore-error-zh-390.png`, fullPage: true });
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(path);
			await restored.getByRole("button", { name: "预览", exact: true }).first().click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.screenshot({ path: `${evidence}/restore-success-zh-390.png`, fullPage: true });
			expect(await restored.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		} finally { await destination.close(); }

		const conflict = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
		const conflictPage = await conflict.newPage();
		conflictPage.setDefaultTimeout(10_000);
		conflictPage.on("pageerror", error => errors.push(error.message));
		try {
			await addAsset(conflictPage, "item", `Keep local ${suffix}`);
			const archivedProject = parsed.find(row => row.type === "asset" && row.value.name === project)?.value;
			if (!archivedProject) throw Error("archived project missing");
			// Fixture only: force a same-ID local edit that the UI cannot assign directly.
			await conflictPage.evaluate(async ({ modulePath, value }) => {
				const { localRepository } = await import(modulePath);
				await (await localRepository()).save("asset", value);
			}, { modulePath: repositoryModuleUrl, value: { ...archivedProject, name: `Local edit ${suffix}` } });
			const conflictBefore = await snapshot(conflictPage);
			await conflictPage.goto("/intake");
			await conflictPage.locator("#backup-password").fill(password);
			await conflictPage.locator("#restore-file").setInputFiles(path);
			await conflictPage.getByRole("button", { name: "Preview", exact: true }).first().click();
			await conflictPage.getByRole("button", { name: /Confirm ·/ }).click();
			await expect(conflictPage.getByText("A local record with the same ID has different content. The backup was not restored.")).toBeVisible();
			await conflictPage.screenshot({ path: `${evidence}/restore-conflict-en-390.png`, fullPage: true });
			expect(await snapshot(conflictPage)).toEqual(conflictBefore);

			const plain = await decryptBackup(new Uint8Array(readFileSync(path)), password);
			const originals = unzipSync(plain);
			const asInvalid = async (label: string, change: (entries: Record<string, Uint8Array>, manifest: Record<string, unknown>) => void) => {
				const entries = Object.fromEntries(Object.entries(originals).map(([key, bytes]) => [key, new Uint8Array(bytes)]));
				const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as Record<string, unknown>;
				change(entries, manifest);
				entries["manifest.json"] = strToU8(JSON.stringify(manifest));
				const encrypted = await encryptBackup(zipSync(entries), password);
				await conflictPage.locator("#restore-file").setInputFiles({ name: `${label}.ka1`, mimeType: "application/octet-stream", buffer: Buffer.from(encrypted) });
				await conflictPage.getByRole("button", { name: "Preview", exact: true }).first().click();
				await expect(conflictPage.getByText("Backup contents are invalid, missing or incompatible. No records were restored.")).toBeVisible();
				await expect(conflictPage.getByRole("button", { name: /Confirm ·/ })).toHaveCount(0);
				expect(await snapshot(conflictPage)).toEqual(conflictBefore);
			};
			await asInvalid("unsupported-version", (_entries, manifest) => { manifest.version = 2; });
			await asInvalid("missing-photo", (entries, manifest) => {
				const attachments = manifest.attachments as { id: string }[];
				delete entries[`files/${attachments[0].id}`];
			});
			await asInvalid("altered-photo", (entries, manifest) => {
				const attachments = manifest.attachments as { id: string }[];
				entries[`files/${attachments[0].id}`][0] ^= 0xff;
			});
			await asInvalid("duplicate-record", (entries, manifest) => {
				const rows = JSON.parse(strFromU8(entries["records.json"])) as unknown[];
				rows.push(rows[0]);
				entries["records.json"] = strToU8(JSON.stringify(rows));
				manifest.recordCount = rows.length;
				manifest.recordsHash = createHash("sha256").update(entries["records.json"]).digest("hex");
			});
			await asInvalid("dangling-relation", (entries, manifest) => {
				const rows = JSON.parse(strFromU8(entries["records.json"])) as { type: string; payload: string }[];
				const relation = rows.find(row => row.type === "relation");
				if (!relation) throw Error("relation missing");
				relation.payload = JSON.stringify({ ...JSON.parse(relation.payload), to: crypto.randomUUID() });
				entries["records.json"] = strToU8(JSON.stringify(rows));
				manifest.recordsHash = createHash("sha256").update(entries["records.json"]).digest("hex");
			});
		} finally { await conflict.close(); }

		await page.goto("/settings");
		await selectChoice(page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Language" }) }).getByRole("combobox"), "zh-CN");
		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "创建备份" }).click();
		await expect(page.getByRole("link", { name: "保存备份文件" })).toBeVisible();
		await page.screenshot({ path: `${evidence}/backup-ready-zh-desktop.png`, fullPage: true });
		await page.locator("#backup-password").fill(`wrong-password-${suffix}`);
		await page.locator("#restore-file").setInputFiles(path);
		await page.getByRole("button", { name: "预览", exact: true }).first().click();
		await expect(page.getByText("密码不正确或备份已损坏。")).toBeVisible();
		await page.screenshot({ path: `${evidence}/restore-error-zh-desktop.png`, fullPage: true });
		await page.locator("#backup-password").fill(password);
		await page.locator("#restore-file").setInputFiles(path);
		await page.getByRole("button", { name: "预览", exact: true }).first().click();
		await page.getByRole("button", { name: /确认 ·/ }).click();
		await expect(page.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
		await page.screenshot({ path: `${evidence}/restore-success-zh-desktop.png`, fullPage: true });
		expect(errors).toEqual([]);
	} finally { await source.close(); }
});
