import { calendarDayDistance, taskSchema, type Task } from "../../../packages/domain/src";
import { rescheduleTaskReminder } from "../../../packages/domain/src/task-reminder";
import { maintenanceReminderDate } from "../../../packages/domain/src/task-repeat";

export type TaskDateRange = { from: string; to: string };
export function validTaskDate(value: string): boolean {
	try { return !value || calendarDayDistance(value, value) === 0; } catch { return false; }
}
export function validTaskDateRange(range: TaskDateRange): boolean {
	return validTaskDate(range.from) && validTaskDate(range.to) && (!range.from || !range.to || range.from <= range.to);
}
export function taskWithinDateRange(task: Task, range: TaskDateRange): boolean {
	if (!range.from && !range.to) return true;
	const due = task.maintenancePlan?.active
		? maintenanceReminderDate(task.maintenancePlan.schedule, task.maintenancePlan.deferredUntil) : task.dueDate;
	return !!due && validTaskDateRange(range) && (!range.from || due >= range.from) && (!range.to || due <= range.to);
}
export async function manualTaskDedupeKey(name: string, assetId: string, dueDate: string): Promise<string> {
	const normalized = name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en");
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
	const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
	return `manual:${assetId || "global"}:${hash}:${dueDate || "none"}`;
}
export async function prepareTaskEdit(task: Task, name: string, dueDate: string): Promise<Task> {
	if (task.deleted || task.purged || task.impactSnapshot || task.projectWorkflow || task.maintenancePlan) throw Error("task-stale");
	const parsed = taskSchema.parse({ ...task, name: name.trim(), dueDate,
		...(task.reminder && dueDate !== task.dueDate ? { reminder: dueDate ? rescheduleTaskReminder(task.reminder, dueDate) : undefined } : {}) });
	return { ...parsed, dedupeKey: !task.dedupeKey || task.dedupeKey.startsWith("manual:")
		? await manualTaskDedupeKey(parsed.name, task.assetId, dueDate) : task.dedupeKey };
}
