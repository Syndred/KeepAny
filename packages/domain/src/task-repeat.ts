import { z } from "zod";
import { type Asset, currencies, dueOnCycle } from "./index";

export type RepeatUnit = Asset["cycle"];
const dateOnly = z.string().refine((value) => {
	try {
		return dueOnCycle(value, "day", 1, 0) === value;
	} catch {
		return false;
	}
}, "date");
const interval = z.number().int().min(1).max(1000);

/** A fixed interval keeps its original calendar anchor; afterCompletion resets it only on completion. */
export const repeatRuleSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("once") }),
	z.object({
		mode: z.literal("fixed"),
		unit: z.enum(["day", "week", "month", "year"]),
		every: interval,
	}),
	z.object({
		mode: z.literal("afterCompletion"),
		unit: z.enum(["day", "week", "month", "year"]),
		every: interval,
	}),
]);
export type RepeatRule = z.infer<typeof repeatRuleSchema>;

/** plannedAmountMinor is an estimate, never proof that a payment occurred. */
export const maintenanceScheduleSchema = z
	.object({
		rule: repeatRuleSchema,
		dueDate: dateOnly,
		anchorDate: dateOnly,
		occurrence: z.number().int().nonnegative().safe(),
		leadDays: z.number().int().min(0).max(3650),
		plannedAmountMinor: z
			.number()
			.int()
			.min(0)
			.max(Number.MAX_SAFE_INTEGER)
			.nullable(),
		// Resolved on parse so taskSchema can import this module without an initialization cycle.
		currency: z.lazy(() => z.enum(currencies)),
	})
	.superRefine((value, context) => {
		try {
			const expected =
				value.rule.mode === "once"
					? value.anchorDate
					: dueOnCycle(
							value.anchorDate,
							value.rule.unit,
							value.rule.every,
							value.occurrence,
						);
			if (
				value.dueDate !== expected ||
				(value.rule.mode === "once" && value.occurrence !== 0)
			) {
				context.addIssue({
					code: "custom",
					path: ["dueDate"],
					message: "schedule-stale",
				});
			}
			subtractCalendarDays(value.dueDate, value.leadDays);
		} catch {
			context.addIssue({
				code: "custom",
				path: ["dueDate"],
				message: "schedule-overflow",
			});
		}
	});
export type MaintenanceSchedule = z.infer<typeof maintenanceScheduleSchema>;

function utcDay(value: string): Date {
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		dueOnCycle(value, "day", 1, 0) !== value
	)
		throw Error("invalid-date");
	const date = new Date(0);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCFullYear(
		Number(value.slice(0, 4)),
		Number(value.slice(5, 7)) - 1,
		Number(value.slice(8, 10)),
	);
	return date;
}
function dateString(date: Date): string {
	const year = date.getUTCFullYear();
	if (!Number.isFinite(date.getTime()) || year < 0 || year > 9999)
		throw Error("schedule-overflow");
	return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
function subtractCalendarDays(value: string, days: number): string {
	const date = utcDay(value);
	date.setUTCDate(date.getUTCDate() - days);
	return dateString(date);
}

export function createMaintenanceSchedule(input: {
	dueDate: string;
	rule: RepeatRule;
	leadDays?: number;
	plannedAmountMinor?: number | null;
	currency?: MaintenanceSchedule["currency"];
}): MaintenanceSchedule {
	return maintenanceScheduleSchema.parse({
		rule: input.rule,
		dueDate: input.dueDate,
		anchorDate: input.dueDate,
		occurrence: 0,
		leadDays: input.leadDays ?? 7,
		plannedAmountMinor: input.plannedAmountMinor ?? null,
		currency: input.currency ?? "CNY",
	});
}

export function effectiveMaintenanceDueDate(schedule: MaintenanceSchedule, deferredUntil = ""): string {
	const value = maintenanceScheduleSchema.parse(schedule);
	if (deferredUntil) {
		utcDay(deferredUntil);
		if (deferredUntil <= value.dueDate) throw Error("invalid-defer-date");
	}
	return deferredUntil || value.dueDate;
}

export function maintenanceReminderDate(schedule: MaintenanceSchedule, deferredUntil = ""): string {
	const value = maintenanceScheduleSchema.parse(schedule);
	return subtractCalendarDays(effectiveMaintenanceDueDate(value, deferredUntil), value.leadDays);
}

/** Delay only the current occurrence. The recurrence anchor remains unchanged. */
export function deferMaintenanceSchedule(input: MaintenanceSchedule, deferredUntil: string, actionDate: string) {
	const schedule = maintenanceScheduleSchema.parse(input);
	utcDay(actionDate);
	const previousDueDate = effectiveMaintenanceDueDate(schedule, deferredUntil);
	const nextDueDate = dueOnCycle(actionDate > previousDueDate ? actionDate : previousDueDate, "day", 7, 1);
	return { nextDueDate, record: { action: "defer" as const, actionDate, previousDueDate, nextDueDate, advancedOccurrences: 0 } };
}

function lastIndex(
	anchorDate: string,
	unit: RepeatUnit,
	every: number,
): number {
	const start = utcDay(anchorDate);
	const end = utcDay("9999-12-31");
	if (unit === "day" || unit === "week") {
		return Math.floor(
			(end.getTime() - start.getTime()) /
				(86_400_000 * every * (unit === "week" ? 7 : 1)),
		);
	}
	const months =
		(9999 - start.getUTCFullYear()) * 12 + (11 - start.getUTCMonth());
	return Math.floor(months / (every * (unit === "year" ? 12 : 1)));
}

/** First anchored occurrence strictly after the current due date and action date. */
function nextFixedOccurrence(
	anchorDate: string,
	unit: RepeatUnit,
	every: number,
	occurrence: number,
	threshold: string,
) {
	let low = occurrence + 1;
	let high = lastIndex(anchorDate, unit, every);
	if (low > high) throw Error("schedule-overflow");
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (dueOnCycle(anchorDate, unit, every, middle) <= threshold)
			low = middle + 1;
		else high = middle;
	}
	const dueDate = dueOnCycle(anchorDate, unit, every, low);
	if (dueDate <= threshold) throw Error("schedule-overflow");
	return { occurrence: low, dueDate };
}

export type MaintenanceAction = "complete" | "skip";
export type MaintenanceAdvance = {
	schedule: MaintenanceSchedule | null;
	record: {
		action: MaintenanceAction;
		actionDate: string;
		previousDueDate: string;
		nextDueDate: string | null;
		advancedOccurrences: number;
	};
};

/** Pure transition. Persist the returned record separately from the next schedule in one repository operation. */
export function advanceMaintenanceSchedule(
	input: MaintenanceSchedule,
	action: MaintenanceAction,
	actionDate: string,
	deferredUntil = "",
): MaintenanceAdvance {
	const schedule = maintenanceScheduleSchema.parse(input);
	utcDay(actionDate);
	const currentDueDate = effectiveMaintenanceDueDate(schedule, deferredUntil);
	if (action !== "complete" && action !== "skip") throw Error("invalid-action");
	if (schedule.rule.mode === "once")
		return {
			schedule: null,
			record: {
				action,
				actionDate,
				previousDueDate: currentDueDate,
				nextDueDate: null,
				advancedOccurrences: 0,
			},
		};
	let next: MaintenanceSchedule;
	if (schedule.rule.mode === "afterCompletion" && action === "complete") {
		const dueDate = dueOnCycle(
			actionDate,
			schedule.rule.unit,
			schedule.rule.every,
			1,
		);
		next = maintenanceScheduleSchema.parse({
			...schedule,
			anchorDate: actionDate,
			occurrence: 1,
			dueDate,
		});
	} else {
		const following = nextFixedOccurrence(
			schedule.anchorDate,
			schedule.rule.unit,
			schedule.rule.every,
			schedule.occurrence,
			actionDate > currentDueDate ? actionDate : currentDueDate,
		);
		next = maintenanceScheduleSchema.parse({ ...schedule, ...following });
	}
	return {
		schedule: next,
		record: {
			action,
			actionDate,
			previousDueDate: currentDueDate,
			nextDueDate: next.dueDate,
			advancedOccurrences:
				schedule.rule.mode === "afterCompletion" && action === "complete"
					? 1
					: next.occurrence - schedule.occurrence,
		},
	};
}
