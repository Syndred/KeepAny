import { describe, expect, it } from "vitest";
import { newAsset, taskSchema, type Asset, type Task } from "../../../packages/domain/src";
import { createTaskReminder, advanceTaskReminder } from "../../../packages/domain/src/task-reminder";
import { createMaintenanceSchedule, advanceMaintenanceSchedule } from "../../../packages/domain/src/task-repeat";
import { REMINDER_READ_PREFIX, buildReminderCenterItems, reminderReadPreference, resolveReminderTarget } from "./reminder-center-model";
import { REMINDER_SETTINGS_ID, defaultReminderSettings } from "./reminders";

const asset = (id: string, dueDate = "", kind: Asset["kind"] = "subscription"): Asset => ({ ...newAsset(kind), id, name: id, dueDate });
const task = (id: string, dueDate = "", extra: Partial<Task> = {}): Task => taskSchema.parse({ id, name: id, dueDate, createdAt: "", ...extra });
const build = (assets: Asset[] = [], tasks: Task[] = [], preferences: { id: string; value: unknown }[] = [], today = "2026-11-05", zone = "UTC") => buildReminderCenterItems(assets, tasks, preferences, today, zone);

describe("reminder center occurrence projection", () => {
	it("NR02 keeps overdue, today, seven-day, later and undated work ordered without a seven-day cutoff", () => {
		const rows = build([asset("late", "2026-11-04"), asset("today", "2026-11-05"), asset("seven", "2026-11-12"), asset("later", "2027-01-01")], [task("undated"), task("tomorrow", "2026-11-06")]);
		expect(rows.map(row => [row.id, row.days, row.group])).toEqual([
			["renew-late", -1, "overdue"], ["renew-today", 0, "today"], ["task-tomorrow", 1, "week"],
			["renew-seven", 7, "week"], ["renew-later", 57, "later"], ["task-undated", null, "undated"],
		]);
		expect(rows.every(row => !row.read)).toBe(true);
	});
	it("NR03 excludes deleted, purged, archived and disabled owners as well as completed/inactive tasks", () => {
		const owners = [asset("live", "2026-11-05"), { ...asset("deleted", "2026-11-05"), deleted: true },
			{ ...asset("purged", "2026-11-05"), purged: true as const }, { ...asset("archived", "2026-11-05", "project"), status: "archived" as const },
			{ ...asset("paused", "2026-11-05"), status: "paused" as const }, { ...asset("cancelled", "2026-11-05"), status: "cancelled" as const }, asset("vault", "2026-11-05", "vault")];
		const tasks = owners.map(owner => task(`for-${owner.id}`, "2026-11-05", { assetId: owner.id }));
		tasks.push(task("done", "2026-11-05", { done: true }), task("deleted", "2026-11-05", { deleted: true }), task("missing", "2026-11-05", { assetId: "missing" }));
		expect(build(owners, tasks).map(row => row.id)).toEqual(["renew-live", "task-for-live"]);
		const schedule = createMaintenanceSchedule({ dueDate: "2026-11-05", rule: { mode: "once" } });
		const inactive = { ...task("inactive", "2026-11-05"), assetId: "live", maintenancePlan: { schedule, active: false, deferredUntil: "", records: [] } };
		expect(build(owners, [inactive]).map(row => row.id)).toEqual(["renew-live"]);
	});
	it("NR02 ignores invalid dates instead of reclassifying them as undated", () => {
		expect(build([asset("invalid", "2026-02-30"), asset("empty")], [{ ...task("invalid"), dueDate: "bad-date" }])).toEqual([]);
		const invalidInstant = { ...task("broken", "2026-11-05"), reminder: { ...createTaskReminder({ at: "2026-11-05T00:00:00Z", timeZone: "UTC" }), at: "not-an-instant" } };
		expect(build([], [invalidInstant])).toEqual([]);
	});
	it("NR12 uses the viewer's natural day for timed work but preserves date-only dates and receipt identity", () => {
		const reminder = createTaskReminder({ at: "2026-11-06T07:00:00Z", timeZone: "America/Los_Angeles" });
		const timed = task("timed", "2026-11-05", { reminder });
		const shanghai = build([], [timed], [], "2026-11-06", "Asia/Shanghai")[0];
		const la = build([], [timed], [], "2026-11-05", "America/Los_Angeles")[0];
		expect(shanghai).toMatchObject({ dueDate: "2026-11-06", days: 0, group: "today" });
		expect(la).toMatchObject({ dueDate: "2026-11-05", days: 0, group: "today" });
		expect(shanghai.signature).toBe(la.signature);
		expect(build([asset("date-only", "2026-11-05")], [], [], "2026-11-06", "Asia/Shanghai")[0]).toMatchObject({ dueDate: "2026-11-05", days: -1 });
		expect(build([asset("leap", "2028-03-01")], [], [], "2028-02-28")[0].days).toBe(2);
	});
	it("NR03 honors global/subscription settings without suppressing a separate explicit linked task", () => {
		const subscription = asset("subscription", "2026-11-05");
		const linked = task("linked", "2026-11-05", { assetId: subscription.id });
		const settings = { ...defaultReminderSettings(), subscriptionEnabled: false };
		expect(build([subscription], [linked], [{ id: REMINDER_SETTINGS_ID, value: settings }]).map(row => row.id)).toEqual(["task-linked"]);
		const override = { ...settings, subscriptionOverrides: { subscription: { enabled: true, leadDays: 3, time: "09:00", timeZone: "UTC" } } };
		expect(build([subscription], [], [{ id: REMINDER_SETTINGS_ID, value: override }])).toHaveLength(1);
		expect(build([subscription], [linked, task("undated")], [{ id: REMINDER_SETTINGS_ID, value: { ...override, enabled: false } }])).toEqual([]);
	});
	it("NR05 read receipts survive projection and renaming without modifying source records or marking them complete", async () => {
		const a = asset("host", "2026-11-05"), t = task("check", "2026-11-05");
		const before = JSON.stringify([a, t]);
		const items = build([a], [t]), receipts = await Promise.all(items.map(row => reminderReadPreference(row.signature)));
		expect(receipts.every(row => row.id.startsWith(REMINDER_READ_PREFIX) && row.id.length <= 96)).toBe(true);
		expect(new Set(receipts.map(row => row.id)).size).toBe(2);
		expect(build([a], [t], receipts).every(row => row.read)).toBe(true);
		expect(build([{ ...a, name: "Renamed" }], [{ ...t, name: "New task title" }], receipts).every(row => row.read)).toBe(true);
		expect(build([{ ...a, dueDate: "2026-11-06" }], [t], receipts).find(row => row.type === "renewal")?.read).toBe(false);
		expect(JSON.stringify([a, t])).toBe(before);
	});
	it("NR05 independent receipts preserve separate item marks across clients", async () => {
		const rows = build([], [task("one", "2026-11-05"), task("two", "2026-11-05")]);
		const first = await reminderReadPreference(rows[0].signature), second = await reminderReadPreference(rows[1].signature);
		expect(first.id).not.toBe(second.id);
		expect(build([], rows.map(row => row.task!), [first]).map(row => row.read)).toEqual([true, false]);
		expect(build([], rows.map(row => row.task!), [first, second]).map(row => row.read)).toEqual([true, true]);
	});
	it("NR05 maintenance defer and next occurrence get a fresh identity while completion history is irrelevant", async () => {
		const item = asset("device", "", "item"), schedule = createMaintenanceSchedule({ dueDate: "2026-11-05", rule: { mode: "fixed", unit: "month", every: 1 } });
		const maintenance = task("clean", "2026-11-05", { assetId: item.id, maintenancePlan: { schedule, active: true, deferredUntil: "", records: [] } });
		const original = build([item], [maintenance])[0], receipt = await reminderReadPreference(original.signature);
		const deferred = { ...maintenance, dueDate: "2026-11-08", maintenancePlan: { ...maintenance.maintenancePlan!, deferredUntil: "2026-11-08" } };
		expect(build([item], [deferred], [receipt])[0]).toMatchObject({ dueDate: "2026-11-08", days: 3, read: false });
		const nextSchedule = advanceMaintenanceSchedule(schedule, "complete", "2026-11-05").schedule!;
		const next = { ...maintenance, dueDate: nextSchedule.dueDate, maintenancePlan: { ...maintenance.maintenancePlan!, schedule: nextSchedule } };
		expect(build([item], [next], [receipt])[0].read).toBe(false);
		expect(build([item], [{ ...maintenance, completionHistory: ["2026-10-05T00:00:00Z"] }], [receipt])[0].read).toBe(true);
	});
	it("NR05 advancing a timed recurring reminder makes only its new occurrence unread", async () => {
		const reminder = createTaskReminder({ at: "2026-11-05T09:00:00Z", timeZone: "UTC", rule: { mode: "fixed", unit: "day", every: 1 } });
		const t = task("repeat", "2026-11-05", { reminder }), row = build([], [t])[0];
		const read = await reminderReadPreference(row.signature), nextReminder = advanceTaskReminder(reminder, "2026-11-05T10:00:00Z")!;
		const next = task("repeat", "2026-11-06", { reminder: nextReminder });
		expect(build([], [t], [read])[0].read).toBe(true);
		expect(build([], [next], [read])[0].read).toBe(false);
	});
	it("NR15 never persists source names, notes, account identifiers or extra credential-shaped fields", async () => {
		const a = { ...asset("public-id", "2026-11-05", "project"), name: "PRIVATE-TITLE", notes: "PRIVATE-NOTES", url: "https://private.example.test", password: "NEVER-SERIALIZE" };
		const t = task("task-id", "2026-11-05", { name: "PRIVATE-TASK-TITLE", assetId: a.id });
		const receipts = await Promise.all(build([a], [t]).map(row => reminderReadPreference(row.signature)));
		expect(JSON.stringify(receipts)).not.toMatch(/PRIVATE|NEVER-SERIALIZE|private\.example/);
		expect(receipts.every(row => Object.keys(row.value).join() === "signature")).toBe(true);
	});
	it("NR05 malformed and unrelated preferences cannot mark occurrences read", async () => {
		const a = asset("host", "2026-11-05"), row = build([a])[0], valid = await reminderReadPreference(row.signature);
		for (const value of [null, [], {}, { signature: 9 }, { signature: "not-json" }, { signature: JSON.stringify(["other.v1"]) }]) {
			expect(build([a], [], [{ id: valid.id, value }])[0].read).toBe(false);
		}
		expect(build([a], [], [{ id: "unrelated", value: valid.value }])[0].read).toBe(false);
		expect(build([a], [], [{ id: `${REMINDER_READ_PREFIX}legacy`, value: valid.value }])[0].read).toBe(false);
		expect(build([a], [], [{ id: REMINDER_SETTINGS_ID, value: { broken: true } }])).toHaveLength(1);
	});
	it("NR06 links source tasks to their on-demand context and routes wallet cards to their real record page", () => {
		const device = asset("device", "", "item"), linked = task("space / 特殊", "2026-11-05", { assetId: device.id });
		const row = build([device], [linked])[0];
		expect(resolveReminderTarget(row)).toEqual({ to: "/assets/$kind/$id", params: { kind: "item", id: device.id }, hash: `reminder-task-${encodeURIComponent(linked.id)}` });
		expect(resolveReminderTarget({ ...row, asset: { ...device, walletCard: {} } as Asset })).toEqual({ to: "/records/$id", params: { id: "asset:device" }, hash: `reminder-task-${encodeURIComponent(linked.id)}` });
		expect(resolveReminderTarget(build([asset("host", "2026-11-05")])[0])).toEqual({ to: "/assets/$kind/$id", params: { kind: "subscription", id: "host" } });
		expect(resolveReminderTarget(build([], [task("unlinked", "2026-11-05")])[0])).toBeNull();
		expect(resolveReminderTarget({ ...row, asset: { ...device, deleted: true } })).toBeNull();
	});
	it("NR02 duplicate input identities do not duplicate reminders or mutate input state", () => {
		const a = asset("one", "2026-11-05"), t = task("two", "2026-11-05"), input = JSON.stringify([a, t]);
		expect(build([a, a], [t, t]).map(row => row.id)).toEqual(["renew-one", "task-two"]);
		expect(JSON.stringify([a, t])).toBe(input);
	});
});
