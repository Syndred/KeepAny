import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");

async function snapshot(page: Page) {
	return page.evaluate(async (path) => {
		const repository = await (await import(path)).localRepository();
		const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), value => value.toString(16).padStart(2, "0")).join("");
		return {
			rows: (await repository.allRecords()).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
			reviews: await repository.fileStore.intakeReview.toArray(),
			files: await Promise.all((await repository.fileStore.blobs.toArray()).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)).map(async (row: { id: string; name: string; blob: Blob }) => ({ id: row.id, name: row.name, type: row.blob.type, bytes: row.blob.size, sha256: await digest(row.blob) }))),
		};
	}, repositoryPath);
}

async function png(page: Page, fill: string) {
	return Buffer.from(await page.evaluate(color => {
		const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
		const paint = canvas.getContext("2d"); if (!paint) throw Error("canvas-unavailable");
		paint.fillStyle = color; paint.fillRect(0, 0, 8, 8);
		return canvas.toDataURL("image/png").split(",")[1];
	}, fill), "base64");
}

for (const language of ["en", "zh-CN"] as const) test(`${language} detail valid image write failure keeps draft and retries; invalid and stale remain distinct`, async ({ browser }, info) => {
	const context = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true });
	await context.addInitScript(value => localStorage.setItem("keepany-language", value), language);
	const page = await context.newPage(), errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const zh = language === "zh-CN", t = (en: string, cn: string) => zh ? cn : en;
	const persist = (name: string, value: unknown) => writeFileSync(info.outputPath(name), JSON.stringify(value, null, 2));
	try {
		await page.goto("/assets/project");
		await page.getByRole("button", { name: t("Add", "新增"), exact: true }).click();
		const dialog = page.getByRole("dialog");
		const name = `Synthetic image IO ${language}`;
		await dialog.locator("#name").fill(name);
		await dialog.getByRole("button", { name: t("Save", "保存"), exact: true }).click();
		await expect(dialog).toBeHidden(); await page.getByText(name, { exact: true }).first().click();
		await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
		const materials = page.locator("#asset-project-materials");
		if (await materials.getAttribute("open") === null) await materials.locator(":scope > summary").click();
		const images = page.locator(".asset-attachments-card"), input = images.locator("input[type=file]");
		const confirm = dialog.getByRole("button", { name: t("Confirm", "确认"), exact: true });
		await input.setInputFiles({ name: "original.png", mimeType: "image/png", buffer: await png(page, "#267bc0") });
		await expect(confirm).toBeEnabled(); await confirm.click(); await expect(dialog).toBeHidden();
		const before = await snapshot(page); persist("before.json", before); expect(before.files).toHaveLength(1);
		const replacement = await png(page, "#ef5737"); persist("replacement.json", { bytes: replacement.length, sha256: await import("node:crypto").then(({createHash}) => createHash("sha256").update(replacement).digest("hex")) });
		await images.getByRole("button", { name: t("Replace image", "替换图片"), exact: true }).click();
		await input.setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: replacement });
		await expect(dialog.getByRole("img", { name: "replacement.png" })).toHaveJSProperty("naturalWidth", 8);
		// C-assisted storage boundary only: first real blobs.add rejects, retry calls the original real writer.
		await page.evaluate(async path => {
			const repository = await (await import(path)).localRepository(), original = repository.fileStore.blobs.add.bind(repository.fileStore.blobs);
			const state = { attempts: 0, rejected: 0, succeeded: 0 };
			Object.assign(window, { syntheticImageWrite: state });
			repository.fileStore.blobs.add = async (...args: unknown[]) => {
				state.attempts++; if (state.attempts === 1) { state.rejected++; throw Error("synthetic-write-rejected"); }
				const value = await original(...args); state.succeeded++; return value;
			};
		}, repositoryPath);
		await confirm.click();
		await expect(confirm).toBeEnabled();
		const saveAlert = dialog.getByRole("alert");
		await expect(saveAlert).toBeVisible();
		persist("immediate-error.json", { text: await saveAlert.innerText() });
		persist("modal-error-accessibility.json", {
			defaultStatusCount: await page.getByRole("status").count(),
			dialogAlertCount: await dialog.getByRole("alert").count(),
			alertAncestors: await saveAlert.evaluate(element => {
				const values = []; for (let node: Element | null = element; node; node = node.parentElement) values.push({ tag: node.tagName, role: node.getAttribute("role"), ariaHidden: node.getAttribute("aria-hidden"), inert: node.hasAttribute("inert") }); return values;
			}),
		});
		await page.screenshot({ path: info.outputPath("immediate-error.png"), fullPage: false });
		const expectedError = t("The image could not be saved. Try again.", "图片未能保存，请重试。");
		try { await expect(dialog.getByRole("alert")).toHaveText(expectedError); }
		finally {
			persist("after-rejected-write.json", await snapshot(page));
			persist("write-failure-ui.json", { statuses: await page.getByRole("status").allTextContents(), draftVisible: await dialog.isVisible(), fileName: await dialog.getByText("replacement.png", {exact:true}).count() });
			await page.screenshot({ path: info.outputPath("write-failure.png"), fullPage: false });
		}
		const visibility = await saveAlert.evaluate(element => {
			const rect = element.getBoundingClientRect();
			const area = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) * Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
			const points = [0.1, 0.5, 0.9].flatMap(x => [0.1, 0.5, 0.9].map(y => {
				const target = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
				return { x, y, unobscured: !!target && (target === element || element.contains(target)) };
			}));
			return { ratio: area / (rect.width * rect.height), rect: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight }, points };
		});
		persist("alert-natural-visibility.json", visibility); expect(visibility.ratio).toBeGreaterThanOrEqual(0.99); expect(visibility.points.every(point => point.unobscured)).toBe(true);
		expect(await snapshot(page)).toEqual(before);
		await expect(dialog.getByRole("img", { name: "replacement.png" })).toHaveJSProperty("naturalWidth", 8);
		await confirm.click(); await expect(dialog).toBeHidden();
		const retried = await snapshot(page); persist("retry.json", retried);
		expect(retried.files).toHaveLength(1); expect(retried.files[0].sha256).not.toBe(before.files[0].sha256);
		expect(retried.rows.map((row: { id: string }) => row.id)).toEqual(before.rows.map((row: { id: string }) => row.id)); expect(retried.reviews).toEqual(before.reviews);
		const payload = JSON.parse(retried.rows[0].payload), oldPayload = JSON.parse(before.rows[0].payload);
		expect({ ...payload, attachments: oldPayload.attachments, projectMedia: oldPayload.projectMedia, updatedAt: oldPayload.updatedAt }).toEqual(oldPayload);
		expect(payload.attachments).toEqual([retried.files[0].id]);
		expect(await page.evaluate(() => (window as unknown as { syntheticImageWrite: unknown }).syntheticImageWrite)).toEqual({ attempts: 2, rejected: 1, succeeded: 1 });
		await page.reload(); if (await materials.getAttribute("open") === null) await materials.locator(":scope > summary").click();
		expect(await snapshot(page)).toEqual(retried); await expect(page.locator(".asset-image")).toHaveCount(1);
		// Decoder-invalid data never reaches persistence and keeps the format/size guidance.
		await input.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not-an-image") });
		await expect(dialog.getByRole("alert")).toHaveText(t("Choose a JPEG, PNG, WebP or GIF up to 20 MB.", "请选择不超过 20 MB 的 JPEG、PNG、WebP 或 GIF。"));
		await expect(confirm).toBeDisabled(); expect(await snapshot(page)).toEqual(retried);
		await dialog.getByRole("button", { name: t("Cancel", "取消"), exact: true }).click();
		// C-assisted deterministic CAS rejection verifies the separate existing stale mapping and orphan cleanup.
		await input.setInputFiles({ name: "stale.png", mimeType: "image/png", buffer: replacement });
		await expect(confirm).toBeEnabled();
		await page.evaluate(async path => { const repository = await (await import(path)).localRepository(); repository.saveAssetIfCurrent = async () => { throw Error("asset-stale"); }; }, repositoryPath);
		await confirm.click(); await expect(confirm).toBeEnabled();
		await expect(dialog.getByRole("alert")).toHaveText(t("This record changed elsewhere. Reopen it before saving.", "资料已在另一处更新，请重新打开后再保存。"));
		expect(await snapshot(page)).toEqual(retried); await expect(dialog.getByText("stale.png", { exact: true })).toBeVisible();
		persist("stale-readback.json", await snapshot(page));
		await dialog.getByRole("button", { name: t("Cancel", "取消"), exact: true }).click();
		await expect(dialog).toBeHidden();
		await input.setInputFiles({ name: "reopened.png", mimeType: "image/png", buffer: replacement });
		await expect(confirm).toBeEnabled(); await expect(dialog.getByRole("alert")).toHaveCount(0);
		expect(await snapshot(page)).toEqual(retried);
		expect(errors).toEqual([]); persist("result.json", { language, width: 390, coarse: await page.evaluate(() => matchMedia("(pointer: coarse)").matches), layer: "B / C-assisted write and CAS rejection; not OS Native", sameDraftRetryRealWrite: true, fullRowsAndFilesPreservedOnFailure: true, invalidAndStaleSeparate: true });
	} finally { await context.close(); }
});

test("en late rejected image job cannot mark a different asset's new preview", async ({ browser }, info) => {
	const context = await browser.newContext({ locale: "en", viewport: { width: 390, height: 844 }, hasTouch: true });
	await context.addInitScript(() => localStorage.setItem("keepany-language", "en"));
	const page = await context.newPage();
	try {
		await page.goto("/assets/project");
		for (const name of ["Synthetic late image A", "Synthetic new image B"]) {
			await page.getByRole("button", { name: "Add", exact: true }).click();
			await page.getByRole("dialog").locator("#name").fill(name);
			await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
		}
		const before = await snapshot(page);
		await page.getByText("Synthetic late image A", { exact: true }).first().click();
		const materials = page.locator("#asset-project-materials");
		if (await materials.getAttribute("open") === null) await materials.locator(":scope > summary").click();
		const input = page.locator(".asset-attachments-card input[type=file]");
		await input.setInputFiles({ name: "old-held.png", mimeType: "image/png", buffer: await png(page, "#bb4422") });
		const dialog = page.getByRole("dialog"), confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
		await expect(confirm).toBeEnabled();
		await page.evaluate(async path => {
			const repository = await (await import(path)).localRepository(), original = repository.fileStore.blobs.add.bind(repository.fileStore.blobs);
			const state = { attempts: 0, started: false, settled: false, release: () => {} };
			Object.assign(window, { syntheticLateImage: state });
			repository.fileStore.blobs.add = async (...args: unknown[]) => {
				if (++state.attempts !== 1) return original(...args);
				state.started = true;
				try { await new Promise<void>((_, reject) => { state.release = () => reject(Error("synthetic-late-image-write")); }); }
				finally { state.settled = true; }
			};
		}, repositoryPath);
		await confirm.click();
		await expect.poll(() => page.evaluate(() => (window as unknown as { syntheticLateImage: { started: boolean } }).syntheticLateImage.started)).toBe(true);
		await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
		await dialog.press("Escape"); await expect(dialog).toBeVisible();
		await page.goBack();
		await page.getByText("Synthetic new image B", { exact: true }).first().click();
		await expect(page.getByRole("heading", { name: "Synthetic new image B", exact: true })).toBeVisible();
		if (await materials.getAttribute("open") === null) await materials.locator(":scope > summary").click();
		await input.setInputFiles({ name: "new-current.png", mimeType: "image/png", buffer: await png(page, "#2299bb") });
		await expect(confirm).toBeEnabled(); await expect(dialog.getByRole("alert")).toHaveCount(0);
		await page.evaluate(() => (window as unknown as { syntheticLateImage: { release: () => void } }).syntheticLateImage.release());
		await expect.poll(() => page.evaluate(() => (window as unknown as { syntheticLateImage: { settled: boolean } }).syntheticLateImage.settled)).toBe(true);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await expect(dialog.getByRole("alert")).toHaveCount(0);
		await expect(dialog.getByText("new-current.png", { exact: true })).toBeVisible();
		await expect(page.locator(".toast").filter({ hasText: "The image could not be saved. Try again." })).toHaveCount(0);
		expect(await snapshot(page)).toEqual(before);
		await page.screenshot({ path: info.outputPath("late-job-new-preview.png"), fullPage: false });
		await confirm.click(); await expect(dialog).toBeHidden();
		const after = await snapshot(page);
		const oldA = before.rows.find((row: { payload: string }) => JSON.parse(row.payload).name === "Synthetic late image A");
		expect(after.rows.find((row: { id: string }) => row.id === oldA.id)).toEqual(oldA);
		expect(after.files).toHaveLength(1); expect(after.files[0].name).toBe("new-current.png");
		writeFileSync(info.outputPath("late-job-result.json"), JSON.stringify({ before, after, currentPreviewUnaffected: true, oldFailureDidNotNotify: true, pendingCancelCloseEscapeBlocked: true }, null, 2));
	} finally {
		await page.evaluate(() => (window as unknown as { syntheticLateImage?: { release: () => void } }).syntheticLateImage?.release()).catch(() => {});
		await context.close();
	}
});
