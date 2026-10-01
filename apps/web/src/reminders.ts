import { z } from "zod";
import type { Asset, Task } from "../../../packages/domain/src";
import { localReminderInstant, timeZoneSchema } from "../../../packages/domain/src/task-reminder";
import { createMaintenanceSchedule, maintenanceReminderDate } from "../../../packages/domain/src/task-repeat";
import { localRepository } from "../../../packages/local-db/src";

export const REMINDER_SETTINGS_ID = "reminder-settings";
export const REMINDER_CATCH_UP_MS = 7 * 86_400_000;
const subscriptionReminderSchema = z.object({ enabled: z.boolean(), leadDays: z.number().int().min(0).max(3650), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: timeZoneSchema });
export type SubscriptionReminder = z.infer<typeof subscriptionReminderSchema>;
export const reminderSettingsSchema = subscriptionReminderSchema.extend({
	browserEnabled: z.boolean(), subscriptionEnabled: z.boolean(),
	subscriptionOverrides: z.record(z.string().min(1).max(96), subscriptionReminderSchema).default({}),
});
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;
export type ReminderPreference = { id: string; value: unknown };

export function defaultReminderSettings(): ReminderSettings {
	return { enabled: true, browserEnabled: false, subscriptionEnabled: true, leadDays: 3, time: "09:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", subscriptionOverrides: {} };
}
export function readReminderSettings(value: unknown): ReminderSettings {
	const parsed = reminderSettingsSchema.safeParse(value);
	return parsed.success ? parsed.data : defaultReminderSettings();
}
export function readSubscriptionReminder(assetId: string, settings: ReminderSettings): SubscriptionReminder {
	return settings.subscriptionOverrides[assetId] ?? { enabled: settings.subscriptionEnabled, leadDays: settings.leadDays, time: settings.time, timeZone: settings.timeZone };
}

/** Save only after the user has reviewed the AI proposal. No dates or payment history are changed. */
export async function configureSubscriptionReminder(assetId: string, input: SubscriptionReminder, expectedAsset?: Asset): Promise<ReminderSettings> {
	const override = subscriptionReminderSchema.parse(input);
	const repository = await localRepository();
	const asset = expectedAsset ?? await repository.get<Asset>("asset", assetId);
	if (!asset || asset.id !== assetId || asset.deleted || asset.kind !== "subscription" || asset.status !== "active") throw Error("asset-stale");
	for (let attempt = 0; attempt < 3; attempt++) {
		const expected = await repository.get<ReminderPreference>("preference", REMINDER_SETTINGS_ID);
		const settings = readReminderSettings(expected?.value);
		const next = reminderSettingsSchema.parse({ ...settings, subscriptionOverrides: { ...settings.subscriptionOverrides, [assetId]: override } });
		try { await repository.saveReminderPreferenceIfCurrent(expected, { id: REMINDER_SETTINGS_ID, value: next }, asset); return next; }
		catch (cause) { if (!(cause instanceof Error) || cause.message !== "preference-stale" || attempt === 2) throw cause; }
	}
	throw Error("preference-stale");
}

export type DueReminder = { sourceType: "task" | "asset"; source: Task | Asset; scheduledAt: string; dueAt: string; signature: string };
function signature(sourceType: DueReminder["sourceType"], id: string, schedule: unknown): string { return JSON.stringify([sourceType, id, schedule]); }

/** Derive reminders from RxDB records; this is not another asset or task store. */
export function dueReminders(tasks: readonly Task[], assets: readonly Asset[], settings: ReminderSettings, now: number): DueReminder[] {
	if (!settings.enabled) return [];
	const live = new Map(assets.filter((asset) => !asset.deleted).map((asset) => [asset.id, asset]));
	const result: DueReminder[] = [];
	const add = (item: DueReminder) => { if (Number.isFinite(Date.parse(item.scheduledAt)) && Date.parse(item.scheduledAt) <= now) result.push(item); };
	for (const task of tasks) {
		if (task.deleted || task.done || !task.dueDate || (task.maintenancePlan && !task.maintenancePlan.active)) continue;
		const linked = task.assetId ? live.get(task.assetId) : null;
		if (task.assetId && (!linked || (linked.kind === "subscription" && linked.status !== "active"))) continue;
		try {
			const dueAt = task.reminder?.at ?? localReminderInstant(task.dueDate, settings.time, settings.timeZone);
			const scheduledAt = task.reminder ? new Date(Date.parse(dueAt) - task.reminder.leadMinutes * 60_000).toISOString() : localReminderInstant(task.maintenancePlan ? maintenanceReminderDate(task.maintenancePlan.schedule, task.maintenancePlan.deferredUntil) : task.dueDate, settings.time, settings.timeZone);
			add({ sourceType: "task", source: task, dueAt, scheduledAt, signature: signature("task", task.id, [task.reminder ?? null, task.dueDate, task.maintenancePlan?.schedule.leadDays ?? 0, task.reminder ? null : [settings.time, settings.timeZone]]) });
		} catch { /* An invalid/skipped calendar time stays visible as a task; never guess a notification time. */ }
	}
	for (const asset of live.values()) {
		if (asset.kind !== "subscription" || asset.status !== "active" || !asset.dueDate) continue;
		const option = readSubscriptionReminder(asset.id, settings);
		if (!option.enabled) continue;
		try {
			const day = maintenanceReminderDate(createMaintenanceSchedule({ dueDate: asset.dueDate, rule: { mode: "once" }, leadDays: option.leadDays }));
			const dueAt = localReminderInstant(asset.dueDate, option.time, option.timeZone);
			const scheduledAt = localReminderInstant(day, option.time, option.timeZone);
			add({ sourceType: "asset", source: asset, dueAt, scheduledAt, signature: signature("asset", asset.id, [asset.dueDate, option]) });
		} catch { /* Invalid legacy dates do not produce guessed reminders. */ }
	}
	return result.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.source.id.localeCompare(b.source.id));
}

export async function reminderDeliveryId(reminder: DueReminder): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reminder.signature));
	return `reminder-delivery:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
export type BrowserReminderPermission = NotificationPermission | "unsupported";
export function browserReminderPermission(): BrowserReminderPermission {
	return typeof Notification === "undefined" || (typeof isSecureContext !== "undefined" && !isSecureContext) ? "unsupported" : Notification.permission;
}
export function showBrowserReminder(title: string, body: string, tag: string, onClick?: () => void): "shown" | "unavailable" | "failed" {
	if (browserReminderPermission() !== "granted") return "unavailable";
	try {
		const notification = new Notification(title, { body, tag });
		notification.onclick = () => { notification.close(); onClick?.(); };
		return "shown";
	} catch { return "failed"; }
}
