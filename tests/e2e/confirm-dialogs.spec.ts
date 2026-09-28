import { expect, test } from "@playwright/test";

for (const scenario of [
	{
		language: "en",
		width: 390,
		add: "Add",
		name: "Name",
		save: "Save",
		move: "Move to trash",
		cancel: "Cancel",
		warning:
			"Move to trash? Connections are retained and available after restoring.",
	},
	{
		language: "zh-CN",
		width: 1280,
		add: "新增",
		name: "名称",
		save: "保存",
		move: "移至回收站",
		cancel: "取消",
		warning: "移到回收站？关联记录会保留，恢复后可继续使用。",
	},
]) {
	test(`${scenario.language} asset deletion dialog cancels, closes and confirms at ${scenario.width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			viewport: { width: scenario.width, height: 844 },
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			scenario.language,
		);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const name = `Dialog project ${crypto.randomUUID().slice(0, 8)}`;
		try {
			await page.goto("/assets/project");
			await page
				.getByRole("button", { name: scenario.add, exact: true })
				.click();
			const create = page.getByRole("dialog");
			await create.getByLabel(scenario.name, { exact: true }).fill(name);
			await create.getByRole("button", { name: scenario.save }).click();
			await expect(create).toBeHidden();
			await page.getByText(name).first().click();
			await expect(page.getByRole("heading", { name })).toBeVisible();

			await page
				.locator("main.page > .page-header")
				.getByRole("button", { name: scenario.move })
				.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog.getByText(scenario.warning)).toBeVisible();
			await testInfo.attach(`${scenario.language}-asset-delete`, {
				body: await page.screenshot({
					path: process.env.KEEPANY_DIALOG_EVIDENCE_DIR
						? `${process.env.KEEPANY_DIALOG_EVIDENCE_DIR}/${scenario.language}-asset-delete.png`
						: undefined,
				}),
				contentType: "image/png",
			});
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(scenario.width);
			await dialog.getByRole("button", { name: scenario.cancel }).click();
			await expect(dialog).toBeHidden();
			await expect(page.getByRole("heading", { name })).toBeVisible();

			await page
				.locator("main.page > .page-header")
				.getByRole("button", { name: scenario.move })
				.click();
			await page.keyboard.press("Escape");
			await expect(dialog).toBeHidden();
			await expect(page.getByRole("heading", { name })).toBeVisible();

			await page
				.locator("main.page > .page-header")
				.getByRole("button", { name: scenario.move })
				.click();
			await dialog.getByRole("button", { name: scenario.move }).click();
			await expect(dialog).toBeHidden();
			await page.goto("/trash");
			await expect(page.getByText(name)).toHaveCount(1);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}

test("local binding removal dialog stays local and fits both languages", async ({
	browser,
}, testInfo) => {
	test.skip(
		process.env.VITE_KEEPANY_BINDING_ISSUER !== "http://127.0.0.1:3100" ||
			process.env.VITE_KEEPANY_BINDING_BRIDGE_ORIGIN !==
				"http://127.0.0.1:3191",
		"Run with the fixed local binding fixture origins",
	);
	for (const scenario of [
		{
			language: "en",
			width: 390,
			connected: "Connection saved on this device",
			remove: "Remove from this device",
			cancel: "Cancel",
			close: "Close",
			warning:
				"This removes the local connection only. Revoke device access in your account settings.",
			removed: "Connection removed from this device",
		},
		{
			language: "zh-CN",
			width: 1280,
			connected: "本机已保存账号连接",
			remove: "从本机移除",
			cancel: "取消",
			close: "关闭",
			warning: "仅移除本机连接。要撤销设备授权，请到账号页面操作。",
			removed: "已从本机移除连接",
		},
	]) {
		const context = await browser.newContext({
			viewport: { width: scenario.width, height: 844 },
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			scenario.language,
		);
		const page = await context.newPage();
		const remoteRequests: string[] = [];
		page.on("request", (request) => {
			if (request.url().startsWith("http://127.0.0.1:3191/"))
				remoteRequests.push(request.url());
		});
		try {
			await page.goto("/settings");
			await expect(
				page.getByRole("button", {
					name: scenario.language === "en" ? "Start connecting" : "开始连接",
				}),
			).toBeVisible();
			await page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open("keepany-binding-v1");
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				try {
					let identity:
						| { localAccountId: string; instanceId: string }
						| undefined;
					for (let attempt = 0; attempt < 100 && !identity; attempt++) {
						identity = await new Promise((resolve, reject) => {
							const request = db
								.transaction("identities")
								.objectStore("identities")
								.get("default");
							request.onsuccess = () => resolve(request.result);
							request.onerror = () => reject(request.error);
						});
						if (!identity)
							await new Promise((resolve) => setTimeout(resolve, 20));
					}
					if (!identity) throw Error("local identity unavailable");
					const bytes = new Uint8Array(
						await crypto.subtle.digest(
							"SHA-256",
							new TextEncoder().encode(identity.instanceId),
						),
					);
					const hash = Array.from(bytes, (byte) =>
						byte.toString(16).padStart(2, "0"),
					).join("");
					const now = new Date().toISOString();
					await new Promise<void>((resolve, reject) => {
						const transaction = db.transaction("bindings", "readwrite");
						transaction.oncomplete = () => resolve();
						transaction.onerror = () => reject(transaction.error);
						transaction.objectStore("bindings").put({
							bindingId: crypto.randomUUID(),
							localAccountId: identity.localAccountId,
							instanceIdHash: hash,
							subject: "keepanyadm:local-fixture",
							allowedScopes: ["sync:read"],
							status: "active",
							createdAt: now,
							updatedAt: now,
						});
					});
				} finally {
					db.close();
				}
			});
			await page.reload();
			await expect(page.getByText(scenario.connected)).toBeVisible();
			await page.getByRole("button", { name: scenario.remove }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog.getByText(scenario.warning)).toBeVisible();
			await testInfo.attach(`${scenario.language}-binding-remove`, {
				body: await page.screenshot({
					path: process.env.KEEPANY_DIALOG_EVIDENCE_DIR
						? `${process.env.KEEPANY_DIALOG_EVIDENCE_DIR}/${scenario.language}-binding-remove.png`
						: undefined,
				}),
				contentType: "image/png",
			});
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(scenario.width);
			await dialog.getByRole("button", { name: scenario.cancel }).click();
			await expect(dialog).toBeHidden();
			await expect(page.getByText(scenario.connected)).toBeVisible();
			await page.getByRole("button", { name: scenario.remove }).click();
			await dialog.getByRole("button", { name: scenario.close }).click();
			await expect(dialog).toBeHidden();
			await expect(page.getByText(scenario.connected)).toBeVisible();
			await page.getByRole("button", { name: scenario.remove }).click();
			await dialog.getByRole("button", { name: scenario.remove }).click();
			await expect(dialog).toBeHidden();
			await expect(page.getByText(scenario.removed)).toBeVisible();
			await page.reload();
			await expect(page.getByText(scenario.connected)).toHaveCount(0);
			expect(remoteRequests).toEqual([]);
		} finally {
			await context.close();
		}
	}
});
