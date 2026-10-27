import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { newAsset, taskSchema, type Asset, type Task } from "../../domain/src";
import { createTaskReminder } from "../../domain/src/task-reminder";
import { LocalRepository, openLocalRepository } from "./index";

const name = () => `reminder-${crypto.randomUUID().slice(0, 10)}`;
const receipt = (char: string) => `reminder-delivery:${char.repeat(64)}`;
const taskFixture = (): Task & { reminder: NonNullable<Task["reminder"]> } => {
	const task = taskSchema.parse({ id: crypto.randomUUID(), name: "Reminder", dueDate: "2020-01-01", createdAt: "2020-01-01T00:00:00.000Z", reminder: createTaskReminder({ at: "2020-01-01T01:00:00.000Z", timeZone: "Asia/Shanghai" }) });
	if (!task.reminder) throw Error("reminder-missing");
	return { ...task, reminder: task.reminder };
};

describe("atomic local reminder delivery", () => {
	it("allows only one delivery across concurrent repository clients and after reload", async () => {
		const db = await openLocalRepository(name());
		try {
			const task = taskFixture(); await db.save("task", task);
			const other = new LocalRepository(db.records, db.fileStore);
			const deliver = vi.fn();
			const input = { id: receipt("a"), sourceType: "task" as const, expected: task, expectedPreference: null, scheduledAt: task.reminder.at };
			const attempts = await Promise.all([db.deliverReminderIfCurrent(input, deliver), other.deliverReminderIfCurrent(input, deliver)]);
			expect(attempts.filter(Boolean)).toHaveLength(1);
			expect(deliver).toHaveBeenCalledTimes(1);
			expect(await new LocalRepository(db.records, db.fileStore).deliverReminderIfCurrent(input, deliver)).toBe(false);
		} finally { await db.close(); }
	});
	it("rejects old task and preference snapshots before emitting a notification", async () => {
		const db = await openLocalRepository(name());
		try {
			const task = taskFixture(); await db.save("task", task);
			const deliver = vi.fn();
			const input = { id: receipt("b"), sourceType: "task" as const, expected: task, expectedPreference: null, scheduledAt: task.reminder.at };
			await db.saveTaskIfCurrent(task, { ...task, name: "Latest" });
			expect(await db.deliverReminderIfCurrent(input, deliver)).toBe(false);
			const latest = await db.get<Task>("task", task.id);
			if (!latest) throw Error("task-missing");
			await db.save("preference", { id: "reminder-settings", value: { enabled: false } });
			expect(await db.deliverReminderIfCurrent({ ...input, expected: latest }, deliver)).toBe(false);
			expect(deliver).not.toHaveBeenCalled();
		} finally { await db.close(); }
	});
	it("filters completed tasks, deleted linked assets and paused subscriptions at the gate", async () => {
		const db = await openLocalRepository(name());
		try {
			const asset = { ...newAsset("subscription"), name: "Hosting", dueDate: "2020-01-04" };
			await db.save("asset", asset);
			const task = { ...taskFixture(), assetId: asset.id }; await db.save("task", task);
			const deliver = vi.fn();
			await db.saveAssetIfCurrent(asset, { ...asset, status: "paused" });
			expect(await db.deliverReminderIfCurrent({ id: receipt("c"), sourceType: "task", expected: task, expectedPreference: null, scheduledAt: task.reminder.at }, deliver)).toBe(false);
			const paused = await db.get<Asset>("asset", asset.id);
			if (!paused) throw Error("asset-missing");
			expect(await db.deliverReminderIfCurrent({ id: receipt("d"), sourceType: "asset", expected: paused, expectedPreference: null, scheduledAt: task.reminder.at }, deliver)).toBe(false);
			await db.setTaskDone(task.id, false);
			const completed = await db.get<Task>("task", task.id);
			if (!completed) throw Error("task-missing");
			expect(await db.deliverReminderIfCurrent({ id: receipt("e"), sourceType: "task", expected: completed, expectedPreference: null, scheduledAt: task.reminder.at }, deliver)).toBe(false);
			expect(deliver).not.toHaveBeenCalled();
		} finally { await db.close(); }
	});
	it("advances a repeating task once and rejects an old completion button", async () => {
		const db = await openLocalRepository(name());
		try {
			const task = { ...taskFixture(), reminder: createTaskReminder({ at: "2020-01-01T01:00:00.000Z", timeZone: "Asia/Shanghai", rule: { mode: "fixed", unit: "month", every: 1 } }) }; await db.save("task", task);
			const current = await db.setTaskDone(task.id, false, task.reminder.at);
			expect(current.done).toBe(false);
			expect(current.reminder?.at).not.toBe(task.reminder.at);
			expect(current.completionHistory).toHaveLength(1);
			await expect(db.setTaskDone(task.id, false, task.reminder.at)).rejects.toThrow("task-stale");
		} finally { await db.close(); }
	});
	it("rejects changes to the complete AI-confirmed snapshot inside the completion gate", async () => {
		const db = await openLocalRepository(name());
		try {
			const task = taskFixture(); await db.save("task", task);
			const preview = await db.get<Task>("task", task.id);
			if (!preview) throw Error("task-missing");
			await new LocalRepository(db.records, db.fileStore).saveTaskIfCurrent(preview, { ...preview, name: "Edited after preview" });
			await expect(db.setTaskDone(preview.id, preview.done, preview.reminder?.at, preview)).rejects.toThrow("task-stale");
			const current = await db.get<Task>("task", task.id);
			if (!current) throw Error("task-missing");
			expect(current.done).toBe(false);
			expect(current.completionHistory).toEqual([]);
			const completed = await db.setTaskDone(current.id, current.done, current.reminder?.at, current);
			expect(completed.done).toBe(true);
			await expect(db.setTaskDone(completed.id, true, completed.reminder?.at, { ...completed, name: "Stale reopen name" })).rejects.toThrow("task-stale");
		} finally { await db.close(); }
	});
	it("saves per-subscription settings only against the reviewed live subscription", async () => {
		const db = await openLocalRepository(name());
		try {
			const asset = { ...newAsset("subscription"), name: "Hosting" }; await db.save("asset", asset);
			const next = { id: "reminder-settings", value: { subscriptionOverrides: { [asset.id]: { enabled: true, leadDays: 3, time: "09:00", timeZone: "Asia/Shanghai" } } } };
			await db.saveAssetIfCurrent(asset, { ...asset, name: "New name" });
			await expect(db.saveReminderPreferenceIfCurrent(null, next, asset)).rejects.toThrow("asset-stale");
			expect(await db.get("preference", "reminder-settings")).toBeNull();
		} finally { await db.close(); }
	});
});
