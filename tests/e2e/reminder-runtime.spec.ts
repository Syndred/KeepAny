import { mkdirSync } from "node:fs";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";

const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const reminderDomainUrl = `/@fs${process.cwd()}/packages/domain/src/task-reminder.ts`;
const remindersUrl = `/@fs${process.cwd()}/apps/web/src/reminders.ts`;
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-10-01";
type CapturedNotification = { title: string; body: string; tag: string };
type MockWindow = Window & { __captureMockReminder?: (value: CapturedNotification) => Promise<void> };

test.use({ timezoneId: "Asia/Shanghai" });

const copy = {
	en: { card: "Reminders to review", browser: "Browser notifications", complete: "Complete", due: "Due:", time: "Reminder:", blocked: "Notifications are blocked. Allow them in this site's browser settings. In-app reminders remain available.", fallback: "The browser notification could not be sent. Check browser or system notification settings. In-app reminders remain available." },
	"zh-CN": { card: "需要留意的提醒", browser: "浏览器系统通知", complete: "完成", due: "到期时间：", time: "提醒时间：", blocked: "通知被浏览器阻止。请在此网站的浏览器设置中允许通知，应用内提醒仍可查看。", fallback: "浏览器通知未能发出，请检查浏览器或系统通知设置。应用内提醒仍可查看。" },
} as const;

/** Software dispatch evidence only: this constructor does not produce an OS notification. */
async function mockNotifications(context: BrowserContext, permission: "granted" | "denied", language: "en" | "zh-CN") {
	const captured: CapturedNotification[] = [];
	await context.exposeBinding("__captureMockReminder", (_source, value: CapturedNotification) => { captured.push(value); });
	await context.addInitScript(({ state, lng }) => {
		if (location.protocol === "http:") localStorage.setItem("keepany-language", lng);
		class MockNotification {
			static permission = state;
			onclick: (() => void) | null = null;
			constructor(title: string, options: { body?: string; tag?: string }) {
				const capture = (window as MockWindow).__captureMockReminder;
				if (!capture) throw Error("Mock notification capture binding missing");
				void capture({ title, body: options.body ?? "", tag: options.tag ?? "" });
			}
			close() {}
			static requestPermission() { return Promise.resolve(state); }
		}
		Object.defineProperty(window, "Notification", { value: MockNotification, configurable: true });
	}, { state: permission, lng: language });
	return captured;
}

async function saveSettings(page: Page) {
	await page.evaluate(async ({ repositoryPath, remindersPath }) => {
		const { localRepository } = await import(repositoryPath);
		const { defaultReminderSettings, REMINDER_SETTINGS_ID } = await import(remindersPath);
		const repository = await localRepository();
		await repository.saveReminderPreferenceIfCurrent(null, { id: REMINDER_SETTINGS_ID, value: { ...defaultReminderSettings(), browserEnabled: true, subscriptionEnabled: false, timeZone: "Asia/Shanghai" } });
	}, { repositoryPath: repositoryUrl, remindersPath: remindersUrl });
}

async function saveDueTask(page: Page, name: string) {
	return page.evaluate(async ({ repositoryPath, domainPath, reminderPath, taskName }) => {
		const { localRepository } = await import(repositoryPath);
		const { taskSchema } = await import(domainPath);
		const { createTaskReminder, zonedParts } = await import(reminderPath);
		const at = new Date(Date.now() - 120_000).toISOString();
		const reminder = createTaskReminder({ at, timeZone: "Asia/Shanghai", leadMinutes: 1 });
		const task = taskSchema.parse({ id: crypto.randomUUID(), name: taskName, dueDate: zonedParts(at, reminder.timeZone).date, createdAt: new Date().toISOString(), reminder });
		await (await localRepository()).save("task", task);
		return { id: task.id as string, name: task.name as string, dueAt: at, scheduledAt: new Date(Date.parse(at) - 60_000).toISOString() };
	}, { repositoryPath: repositoryUrl, domainPath: domainUrl, reminderPath: reminderDomainUrl, taskName: name });
}

async function deliveryReceipts(page: Page, taskId: string) {
	return page.evaluate(async ({ repositoryPath, id }) => {
		const { localRepository } = await import(repositoryPath);
		const preferences = await (await localRepository()).list("preference");
		return preferences.filter((row: { id: string; value?: { sourceId?: string } }) => row.id.startsWith("reminder-delivery:") && row.value?.sourceId === id);
	}, { repositoryPath: repositoryUrl, id: taskId });
}

for (const language of ["en", "zh-CN"] as const) {
	test(`${language} real RxDB due reminder: in-app link, cross-tab once-only software notification, refresh and completion`, async ({ context, page }) => {
		const width = language === "en" ? 1280 : 390;
		await page.setViewportSize({ width, height: 900 });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const captured = await mockNotifications(context, "granted", language);
		const second = await context.newPage();
		await second.setViewportSize({ width, height: 900 });
		second.on("pageerror", (error) => errors.push(error.message));
		await Promise.all([page.goto("/settings"), second.goto("/settings")]);
		await saveSettings(page);
		await expect(page.getByLabel(copy[language].browser, { exact: true })).toBeChecked();
		await expect(second.getByLabel(copy[language].browser, { exact: true })).toBeChecked();
		const task = await saveDueTask(page, language === "en" ? "Review the due fixture" : "核对到期待办样例");
		const firstCard = page.getByRole("complementary", { name: copy[language].card, exact: true });
		const secondCard = second.getByRole("complementary", { name: copy[language].card, exact: true });
		await expect(firstCard).toBeVisible();
		await expect(secondCard).toBeVisible();
		await expect.poll(() => captured.length, { timeout: 20_000 }).toBe(1);
		expect(captured[0]).toMatchObject({ title: task.name, tag: expect.stringMatching(/^reminder-delivery:[a-f0-9]{64}$/) });
		expect(captured[0].body).toContain(language === "en" ? "Due:" : "到期时间：");
		await expect.poll(async () => (await deliveryReceipts(page, task.id)).length).toBe(1);
		await firstCard.getByRole("link", { name: task.name, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/tasks#task-${task.id}$`));
		const row = page.locator(`#task-${task.id}`);
		await expect(row).toBeFocused();
		await expect(row).toContainText("Asia/Shanghai");
		await expect(row.locator(`time[datetime="${task.dueAt}"]`)).toBeVisible();
		await expect(row.locator(`time[datetime="${task.scheduledAt}"]`)).toBeVisible();
		await expect(row).toContainText(language === "en" ? "1 minute before · One time" : "提前 1 分钟 · 仅一次");
		await page.reload();
		await expect(row).toBeVisible();
		await expect(firstCard).toBeVisible();
		await second.reload();
		await expect(secondCard).toBeVisible();
		await Promise.all([page.evaluate(() => window.dispatchEvent(new Event("focus"))), second.evaluate(() => window.dispatchEvent(new Event("focus")))]);
		// Let both re-mounted runtimes finish their async receipt checks; no new constructor may run.
		await page.waitForTimeout(500);
		expect(captured).toHaveLength(1);
		expect(await deliveryReceipts(page, task.id)).toHaveLength(1);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
		mkdirSync(evidence, { recursive: true });
		await page.screenshot({ path: `${evidence}/reminder-runtime-${language}-${width}.png`, fullPage: true });
		await row.getByRole("button", { name: copy[language].complete, exact: true }).click();
		await expect(firstCard).toHaveCount(0);
		await expect(secondCard).toHaveCount(0);
		expect(captured).toHaveLength(1);
		expect(errors).toEqual([]);
	});
}

test("denied notification permission keeps the in-app reminder and visible fallback without throwing", async ({ context, page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const captured = await mockNotifications(context, "denied", "en");
	await page.goto("/settings");
	await saveSettings(page);
	await expect(page.getByText(copy.en.blocked, { exact: true })).toBeVisible();
	const task = await saveDueTask(page, "Denied permission reminder fixture");
	const card = page.getByRole("complementary", { name: copy.en.card, exact: true });
	await expect(card.getByRole("link", { name: task.name, exact: true })).toBeVisible();
	await expect(card.getByText(copy.en.fallback, { exact: true })).toBeVisible({ timeout: 20_000 });
	expect(await deliveryReceipts(page, task.id)).toHaveLength(1);
	expect(captured).toEqual([]);
	expect(errors).toEqual([]);
});
