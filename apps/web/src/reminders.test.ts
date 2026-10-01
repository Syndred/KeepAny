import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newAsset, taskSchema } from "../../../packages/domain/src";
import { createTaskReminder } from "../../../packages/domain/src/task-reminder";
import { openLocalRepository, LocalRepository } from "../../../packages/local-db/src";
import { browserReminderPermission, defaultReminderSettings, dueReminders, reminderDeliveryId, showBrowserReminder } from "./reminders";

afterEach(() => vi.unstubAllGlobals());
describe("reminders from the current local records", () => {
	it("schedules a per-subscription lead time without editing its billing date", () => {
		const asset = { ...newAsset("subscription"), name: "Hosting", dueDate: "2026-10-10" };
		const settings = { ...defaultReminderSettings(), timeZone: "UTC", subscriptionOverrides: { [asset.id]: { enabled: true, leadDays: 3, time: "09:00", timeZone: "Asia/Shanghai" } } };
		expect(dueReminders([], [asset], settings, Date.parse("2026-10-07T00:59:59Z"))).toEqual([]);
		const [due] = dueReminders([], [asset], settings, Date.parse("2026-10-07T01:00:00Z"));
		expect(due).toMatchObject({ scheduledAt: "2026-10-07T01:00:00.000Z", dueAt: "2026-10-10T01:00:00.000Z" });
		expect(asset.dueDate).toBe("2026-10-10");
	});
	it("suppresses completed/deleted tasks and paused/cancelled/deleted subscriptions", () => {
		const asset = { ...newAsset("subscription"), name: "Hosting", dueDate: "2026-10-10" };
		const task = taskSchema.parse({ id: "task", name: "Renew", assetId: asset.id, dueDate: "2026-10-07", createdAt: "2026-10-01T00:00:00Z" });
		const settings = { ...defaultReminderSettings(), timeZone: "UTC" };
		const now = Date.parse("2026-10-10T09:00:00Z");
		for (const status of ["paused", "cancelled"] as const) expect(dueReminders([task], [{ ...asset, status }], settings, now)).toEqual([]);
		expect(dueReminders([task], [{ ...asset, deleted: true }], settings, now)).toEqual([]);
		expect(dueReminders([{ ...task, done: true }], [], settings, now)).toEqual([]);
		expect(dueReminders([{ ...task, deleted: true }], [], settings, now)).toEqual([]);
	});
	it("uses exact task instants and advances delivery identity only when the reminder changes", async () => {
		const reminder = createTaskReminder({ at: "2026-10-02T01:00:00.000Z", timeZone: "Asia/Shanghai", leadMinutes: 15 });
		const task = taskSchema.parse({ id: "task", name: "Check", dueDate: "2026-10-02", createdAt: reminder.at, reminder });
		const settings = defaultReminderSettings();
		const now = Date.parse("2026-10-02T00:45:00Z");
		const [due] = dueReminders([task], [], settings, now);
		expect(due.scheduledAt).toBe("2026-10-02T00:45:00.000Z");
		const [rename] = dueReminders([{ ...task, name: "Changed name" }], [], settings, now);
		expect(await reminderDeliveryId(rename)).toBe(await reminderDeliveryId(due));
		expect(dueReminders([task], [], { ...settings, enabled: false }, now)).toEqual([]);
	});
	it("issues a system notification only when supported and explicitly granted", () => {
		const created = vi.fn();
		class MockNotification {
			static permission: NotificationPermission = "granted";
			onclick: (() => void) | null = null;
			constructor(title: string, options: unknown) { created(title, options); }
			close() {}
		}
		vi.stubGlobal("Notification", MockNotification);
		vi.stubGlobal("isSecureContext", true);
		expect(showBrowserReminder("Check", "Due now", "receipt")).toBe("shown");
		expect(created).toHaveBeenCalledExactlyOnceWith("Check", { body: "Due now", tag: "receipt" });
		MockNotification.permission = "denied";
		expect(showBrowserReminder("Check", "Due now", "receipt")).toBe("unavailable");
		expect(created).toHaveBeenCalledTimes(1);
		vi.stubGlobal("isSecureContext", false);
		expect(browserReminderPermission()).toBe("unsupported");
	});
	it("emits one actual mock Notification for a due reminder across two clients", async () => {
		const created = vi.fn();
		class MockNotification {
			static permission: NotificationPermission = "granted";
			onclick: (() => void) | null = null;
			constructor(title: string, options: unknown) { created(title, options); }
			close() {}
		}
		vi.stubGlobal("Notification", MockNotification); vi.stubGlobal("isSecureContext", true);
		const repository = await openLocalRepository(`notify-${crypto.randomUUID().slice(0, 10)}`);
		try {
			const reminder = createTaskReminder({ at: new Date(Date.now() - 60_000).toISOString(), timeZone: "UTC" });
			const task = taskSchema.parse({ id: crypto.randomUUID(), name: "Due reminder", dueDate: reminder.at.slice(0, 10), createdAt: reminder.at, reminder });
			await repository.save("task", task);
			const [due] = dueReminders([task], [], defaultReminderSettings(), Date.now());
			const id = await reminderDeliveryId(due);
			const input = { id, sourceType: due.sourceType, expected: due.source, expectedPreference: null, scheduledAt: due.scheduledAt };
			const deliver = () => { showBrowserReminder(task.name, "Due now", id); };
			await Promise.all([repository.deliverReminderIfCurrent(input, deliver), new LocalRepository(repository.db, repository.fileStore).deliverReminderIfCurrent(input, deliver)]);
			expect(created).toHaveBeenCalledExactlyOnceWith("Due reminder", { body: "Due now", tag: id });
		} finally { await repository.close(); }
	});
});
