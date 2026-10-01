import { z } from "zod";
import { dueOnCycle } from "./index";
import { advanceMaintenanceSchedule, repeatRuleSchema, type RepeatRule } from "./task-repeat";

export const timeZoneSchema = z.string().min(1).max(100).refine((value) => {
	try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
	catch { return false; }
}, "time-zone");
const instantSchema = z.string().datetime().refine((value) => Number.isFinite(Date.parse(value)), "instant");

export function zonedParts(at: string, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
	return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

/** Reject clock times skipped by a DST change; choose the earlier instant when a clock time repeats. */
export function localReminderInstant(date: string, time: string, timeZone: string): string {
	timeZoneSchema.parse(timeZone);
	if (dueOnCycle(date, "day", 1, 0) !== date || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw Error("invalid-reminder-time");
	const clock = time.length === 5 ? `${time}:00` : time;
	const wall = Date.parse(`${date}T${clock}.000Z`);
	const offsets = new Set<number>();
	for (const shift of [-36, -12, 0, 12, 36]) {
		const probe = wall + shift * 3_600_000;
		const local = zonedParts(new Date(probe).toISOString(), timeZone);
		offsets.add(Date.parse(`${local.date}T${local.time}.000Z`) - probe);
	}
	const possible = [...offsets].map((offset) => wall - offset).filter((value) => {
		const local = zonedParts(new Date(value).toISOString(), timeZone);
		return local.date === date && local.time === clock;
	});
	if (!possible.length) throw Error("invalid-reminder-time");
	return new Date(Math.min(...possible)).toISOString();
}

export const taskReminderSchema = z.object({
	at: instantSchema, timeZone: timeZoneSchema, leadMinutes: z.number().int().min(0).max(5_256_000).default(0),
	rule: repeatRuleSchema.default({ mode: "once" }), anchorAt: instantSchema, occurrence: z.number().int().min(0).max(3_652_059).default(0),
}).superRefine((value, context) => {
	try {
		if (value.rule.mode === "once") {
			if (value.at !== value.anchorAt || value.occurrence !== 0) throw Error("reminder-stale");
		} else {
			const anchor = zonedParts(value.anchorAt, value.timeZone);
			const expectedDate = dueOnCycle(anchor.date, value.rule.unit, value.rule.every, value.occurrence);
			if (zonedParts(value.at, value.timeZone).date !== expectedDate || zonedParts(value.at, value.timeZone).time !== anchor.time) throw Error("reminder-stale");
		}
	} catch { context.addIssue({ code: "custom", path: ["at"], message: "reminder-stale" }); }
});
export type TaskReminder = z.infer<typeof taskReminderSchema>;

export function createTaskReminder(input: { at: string; timeZone: string; leadMinutes?: number; rule?: RepeatRule }): TaskReminder {
	const at = new Date(instantSchema.parse(input.at)).toISOString();
	return taskReminderSchema.parse({ ...input, at, anchorAt: at, occurrence: 0 });
}

/** An explicit date edit starts recurrence from the new date, retaining the chosen clock time. */
export function rescheduleTaskReminder(input: TaskReminder, dueDate: string): TaskReminder {
	const value = taskReminderSchema.parse(input);
	return createTaskReminder({ at: localReminderInstant(dueDate, zonedParts(value.at, value.timeZone).time, value.timeZone), timeZone: value.timeZone, leadMinutes: value.leadMinutes, rule: value.rule });
}

/** Reuse maintenance recurrence: complete advances the next due date, never records a payment. */
export function advanceTaskReminder(input: TaskReminder, completedAt: string): TaskReminder | null {
	const value = taskReminderSchema.parse(input);
	const anchor = zonedParts(value.anchorAt, value.timeZone);
	const current = zonedParts(value.at, value.timeZone);
	const action = zonedParts(instantSchema.parse(completedAt), value.timeZone);
	const next = advanceMaintenanceSchedule({ rule: value.rule, dueDate: current.date, anchorDate: anchor.date, occurrence: value.occurrence, leadDays: 0, plannedAmountMinor: null, currency: "CNY" }, "complete", action.date);
	if (!next.schedule) return null;
	const at = localReminderInstant(next.schedule.dueDate, current.time, value.timeZone);
	const anchorAt = value.rule.mode === "afterCompletion" ? localReminderInstant(action.date, current.time, value.timeZone) : value.anchorAt;
	return taskReminderSchema.parse({ ...value, at, anchorAt, occurrence: next.schedule.occurrence });
}
