import { expect, type Page, test } from "@playwright/test";

async function addAsset(
	page: Page,
	kind: "project" | "account" | "subscription" | "item",
	name: string,
	location?: string,
) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	if (kind === "subscription") {
		await dialog.locator("#amount").fill("12.50");
		await dialog.locator("#dueDate").fill("2026-10-31");
	}
	if (location) await dialog.locator("#location").fill(location);
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText(name).first()).toBeVisible();
}

test("project, account, subscription, located item, linked reminder and downloaded backup survive a fresh browser restore", async ({
	browser,
}) => {
	const source = await browser.newContext({
		locale: "en-US",
		acceptDownloads: true,
		viewport: { width: 1280, height: 800 },
	});
	const page = await source.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const unique = crypto.randomUUID().slice(0, 8);
	const project = `Flow Project ${unique}`;
	const editedProject = `${project} edited`;
	const account = `Flow Account ${unique}`;
	const subscription = `Flow Subscription ${unique}`;
	const item = `Flow Item ${unique}`;
	const location = `Study desk Drawer ${unique}`;
	const task = `Review renewal ${unique}`;
	const password = `test-only-backup-${unique}-2026`;
	try {
		await addAsset(page, "project", project);
		await addAsset(page, "account", account);
		await addAsset(page, "subscription", subscription);
		await addAsset(page, "item", item, location);
		await page.locator(".top-search-trigger").click();
		await page.locator("#top-search-query").fill(location);
		await expect(page.locator(".top-search-panel .search-results a")).toHaveCount(1);
		await expect(page.locator("main .asset-library-card")).toHaveCount(1);
		await page.locator(".top-search-panel .search-results a").click();
		await expect(page.getByRole("heading", { name: item, exact: true })).toBeVisible();

		await page.goto("/assets/project");
		await page.getByText(project).first().click();
		await expect(page.getByRole("heading", { name: project })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const edit = page.getByRole("dialog");
		await edit.getByLabel("Name", { exact: true }).fill(editedProject);
		await edit.getByRole("button", { name: "Save", exact: true }).click();
		await expect(edit).toBeHidden();
		await page.reload();
		await expect(page.getByRole("heading", { name: editedProject })).toBeVisible();
		await page.getByRole("button", { name: "Add connection" }).click();
		const relation = page.getByRole("dialog");
		await relation.getByLabel("Connect to").selectOption({ label: account });
		await relation.getByLabel("Connection label").fill("owner");
		await relation.getByRole("button", { name: "Save" }).click();
		await expect(relation).toBeHidden();
		await expect(page.getByText(account).first()).toBeVisible();

		await page
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "Tasks" }) })
			.getByRole("button", { name: "Add" })
			.click();
		const taskDialog = page.getByRole("dialog");
		await taskDialog.getByLabel("Name").fill(task);
		await taskDialog.getByLabel("Date").fill("2026-10-01");
		await taskDialog.getByRole("button", { name: "Save" }).click();
		await expect(taskDialog).toBeHidden();
		await expect(page.getByText(task)).toBeVisible();
		await page.goto("/tasks");
		const reminder = page.locator("main .list-row").filter({ hasText: task });
		await reminder.getByLabel("Remind later", { exact: true }).fill("2026-12-31");
		await reminder.getByRole("button", { name: "Postpone 1 day", exact: true }).click();
		await expect(reminder.getByLabel("Remind later", { exact: true })).toHaveValue("2027-01-01");
		await page.reload();
		await expect(reminder.getByLabel("Remind later", { exact: true })).toHaveValue("2027-01-01");
		await reminder.getByRole("link", { name: editedProject, exact: true }).click();
		await expect(page.getByRole("heading", { name: editedProject, exact: true })).toBeVisible();

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const saveFile = page.getByRole("link", { name: "Save backup file" });
		await expect(saveFile).toBeVisible();
		const downloadPromise = page.waitForEvent("download");
		await saveFile.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(
			/^keepany-\d{4}-\d{2}-\d{2}\.ka1$/,
		);
		const backupPath = await download.path();
		if (!backupPath) throw Error("download file did not land");

		const destination = await browser.newContext({
			locale: "en-US",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/assets/project");
			await expect(restored.getByText(project)).toHaveCount(0);
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored
				.getByRole("button", { name: "Preview", exact: true })
				.first()
				.click();
			const confirm = restored.getByRole("button", { name: /Confirm ·/ });
			await expect(confirm).toBeVisible();
			await confirm.click();
			await expect(restored.getByText(/Restored \d+ records/)).toBeVisible();
			await restored.goto("/assets/project");
			const restoredProject = restored.locator("a.asset-project-card").filter({ hasText: editedProject });
			await expect(restoredProject).toHaveCount(1);
			await expect(restoredProject).toBeVisible();
			await restored.reload();
			await expect(restoredProject).toBeVisible();
			await restoredProject.click();
			await expect(restored.getByText(account).first()).toBeVisible();
			await expect(restored.getByText(task)).toBeVisible();
			await restored.goto("/assets/subscription");
			await expect(restored.getByText(subscription)).toBeVisible();
			await restored.goto("/tasks");
			const restoredReminder = restored.locator("main .list-row").filter({ hasText: task });
			await expect(restoredReminder.getByLabel("Remind later", { exact: true })).toHaveValue("2027-01-01");
			await expect(restoredReminder.getByRole("link", { name: editedProject, exact: true })).toBeVisible();
			await restored.goto("/assets/item");
			await restored.locator(".top-search-trigger").click();
			await restored.locator("#top-search-query").fill(location);
			await expect(restored.locator("main .asset-library-card")).toHaveCount(1);
			await expect(restored.locator("main .asset-library-card")).toContainText(item);
			await restored.goto("/settings");
			await restored.locator("section.card").filter({ has: restored.getByRole("heading", { name: "Language" }) }).locator("select").selectOption("zh-CN");
			await expect(
				restored.getByRole("heading", { name: "设置" }),
			).toBeVisible();
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBe(390);
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("both languages fit key pages and the task dialog at target widths", async ({
	browser,
}) => {
	for (const locale of ["en-US", "zh-CN"]) {
		for (const width of [360, 390, 768, 1280, 1440]) {
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 844 },
			});
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				for (const route of [
					"/",
					"/assets/subscription",
					"/tasks",
					"/intake",
					"/settings",
				]) {
					await page.goto(route);
					await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
						`${locale} ${width}px ${route}`,
					).toBeLessThanOrEqual(width);
				}
				await page.goto("/tasks");
				await page.getByRole("button", { name: locale === "zh-CN" ? "新建待办" : "New task", exact: true }).click();
				await expect(page.getByRole("dialog")).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
					`${locale} ${width}px task dialog`,
				).toBeLessThanOrEqual(width);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		}
	}
});
