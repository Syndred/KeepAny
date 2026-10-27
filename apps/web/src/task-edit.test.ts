import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { taskSchema, newAsset } from "../../../packages/domain/src";
import { createTaskReminder } from "../../../packages/domain/src/task-reminder";
import { openLocalRepository } from "../../../packages/local-db/src";
import { manualTaskDedupeKey, prepareTaskEdit, taskWithinDateRange, validTaskDateRange } from "./task-edit";

const initial = () => taskSchema.parse({ id: crypto.randomUUID(), name: "Original", dueDate: "2026-10-28", createdAt: "2026-10-27T00:00:00Z", completionHistory: ["2026-10-20T00:00:00Z"] });
describe("ordinary task editing and date filtering", () => {
	it("matches date bounds inclusively without inventing dates for undated tasks", () => {
		const task = initial();
		expect(taskWithinDateRange(task, { from: task.dueDate, to: task.dueDate })).toBe(true);
		expect(taskWithinDateRange(task, { from: "2026-10-29", to: "" })).toBe(false);
		expect(taskWithinDateRange({ ...task, dueDate: "" }, { from: "2026-10-01", to: "" })).toBe(false);
		expect(taskWithinDateRange({ ...task, dueDate: "" }, { from: "", to: "" })).toBe(true);
		expect(validTaskDateRange({ from: "2026-02-30", to: "" })).toBe(false);
		expect(validTaskDateRange({ from: "2026-10-29", to: "2026-10-28" })).toBe(false);
	});
	it("changes only editable fields, recalculates dedupe and preserves complete history and reminders", async () => {
		const task = { ...initial(), assetId: "project", reminder: createTaskReminder({ at: "2026-10-28T01:00:00Z", timeZone: "Asia/Shanghai", leadMinutes: 15 }) };
		const next = await prepareTaskEdit(task, " New name ", task.dueDate);
		expect(next).toEqual({ ...task, name: "New name", dedupeKey: await manualTaskDedupeKey("New name", task.assetId, task.dueDate) });
		const rescheduled = await prepareTaskEdit(task, task.name, "2026-11-01");
		expect(rescheduled.reminder?.at).toBe("2026-11-01T01:00:00.000Z");
		expect(rescheduled.completionHistory).toEqual(task.completionHistory);
		await expect(prepareTaskEdit(task, " ", task.dueDate)).rejects.toThrow();
	});
	it("rejects stale saves and duplicate pending renames; a failed write can be retried", async () => {
		const repository = await openLocalRepository(`task-edit-${crypto.randomUUID()}`);
		try {
			const asset = { ...newAsset("project"), name: "Project" };
			const a = { ...initial(), assetId: asset.id };
			a.dedupeKey = await manualTaskDedupeKey(a.name, a.assetId, a.dueDate);
			const b = { ...initial(), name: "Occupied", assetId: asset.id };
			b.dedupeKey = await manualTaskDedupeKey(b.name, b.assetId, b.dueDate);
			await repository.saveBatch([{ type: "asset", value: asset }, { type: "task", value: a }, { type: "task", value: b }]);
			await expect(repository.saveTaskIfCurrent(a, await prepareTaskEdit(a, b.name, b.dueDate))).rejects.toThrow("task-duplicate");
			expect(await repository.get("task", a.id)).toEqual(a);
			const next = await prepareTaskEdit(a, "Updated", a.dueDate);
			await repository.saveTaskIfCurrent(a, next);
			await expect(repository.saveTaskIfCurrent(a, await prepareTaskEdit(a, "Late", a.dueDate))).rejects.toThrow("task-stale");
			expect(await repository.get("task", a.id)).toEqual(next);
		} finally { await repository.close(); }
	});
});
