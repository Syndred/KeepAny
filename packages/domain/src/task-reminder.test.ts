import { describe, expect, it } from "vitest";
import { taskSchema } from "./index";
import { advanceTaskReminder, createTaskReminder, localReminderInstant, rescheduleTaskReminder, zonedParts } from "./task-reminder";

describe("task reminders with absolute instants and calendar recurrence", () => {
	it("converts clock time in the selected zone rather than the host zone", () => {
		expect(localReminderInstant("2026-10-02", "09:00", "Asia/Shanghai")).toBe("2026-10-02T01:00:00.000Z");
		expect(zonedParts("2026-10-02T01:00:00.000Z", "America/New_York")).toEqual({ date: "2026-10-01", time: "21:00:00" });
	});
	it("rejects skipped DST times and consistently chooses the earlier repeated time", () => {
		expect(() => localReminderInstant("2026-03-08", "02:30", "America/New_York")).toThrow("invalid-reminder-time");
		expect(localReminderInstant("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
	});
	it("retains the original month-end anchor and local clock time after completion", () => {
		const first = createTaskReminder({ at: "2026-01-31T14:00:00.000Z", timeZone: "America/New_York", rule: { mode: "fixed", unit: "month", every: 1 } });
		const second = advanceTaskReminder(first, "2026-02-01T14:00:00.000Z");
		expect(second?.at).toBe("2026-02-28T14:00:00.000Z");
		if (!second) throw Error("repeat-missing");
		const third = advanceTaskReminder(second, "2026-03-01T14:00:00.000Z");
		expect(third?.at).toBe("2026-03-31T13:00:00.000Z");
		expect(third?.anchorAt).toBe(first.anchorAt);
	});
	it("resets after-completion recurrence and ends a one-time reminder", () => {
		const input = { at: "2026-10-01T01:00:00.000Z", timeZone: "Asia/Shanghai" };
		expect(advanceTaskReminder(createTaskReminder(input), "2026-10-02T08:00:00.000Z")).toBeNull();
		const repeated = createTaskReminder({ ...input, rule: { mode: "afterCompletion", unit: "week", every: 1 } });
		expect(advanceTaskReminder(repeated, "2026-10-02T08:00:00.000Z")?.at).toBe("2026-10-09T01:00:00.000Z");
	});
	it("keeps the task date aligned and explicitly restarts recurrence when a date is edited", () => {
		const reminder = createTaskReminder({ at: "2026-10-01T01:00:00.000Z", timeZone: "Asia/Shanghai", leadMinutes: 30, rule: { mode: "fixed", unit: "day", every: 1 } });
		expect(taskSchema.safeParse({ id: "task", name: "Check", dueDate: "2026-10-02", createdAt: reminder.at, reminder }).success).toBe(false);
		const next = rescheduleTaskReminder(reminder, "2026-10-03");
		expect(next).toMatchObject({ at: "2026-10-03T01:00:00.000Z", anchorAt: "2026-10-03T01:00:00.000Z", occurrence: 0, leadMinutes: 30 });
	});
});
