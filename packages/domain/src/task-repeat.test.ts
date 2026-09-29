import { describe, expect, it } from "vitest";
import { taskSchema } from "./index";
import type { MaintenanceSchedule } from "./task-repeat";
import {
	advanceMaintenanceSchedule,
	createMaintenanceSchedule,
	deferMaintenanceSchedule,
	maintenanceReminderDate,
	maintenanceScheduleSchema,
} from "./task-repeat";

const ongoing = (schedule: MaintenanceSchedule | null): MaintenanceSchedule => {
	if (!schedule) throw Error("expected-recurring-schedule");
	return schedule;
};

describe("maintenance repeat schedule", () => {
	it("validates a Task backed by one maintenance schedule without changing ordinary tasks", () => {
		const schedule = createMaintenanceSchedule({ dueDate: "2026-09-30", rule: { mode: "once" } });
		const base = { id: crypto.randomUUID(), name: "Check asset", assetId: crypto.randomUUID(), dueDate: schedule.dueDate, done: false, completedAt: "", createdAt: new Date().toISOString(), dedupeKey: "", deleted: false };
		expect(taskSchema.safeParse(base).success).toBe(true);
		expect(taskSchema.safeParse({ ...base, maintenancePlan: { schedule, active: true, records: [] } }).success).toBe(true);
		expect(taskSchema.safeParse({ ...base, dueDate: "2026-10-01", maintenancePlan: { schedule, active: true, records: [] } }).success).toBe(false);
		expect(taskSchema.safeParse({ ...base, done: true, maintenancePlan: { schedule, active: true, records: [] } }).success).toBe(false);
	});
	it("keeps fixed month-end and leap-day anchors across completion and skip", () => {
		const monthly = createMaintenanceSchedule({
			dueDate: "2026-01-31",
			rule: { mode: "fixed", unit: "month", every: 1 },
			leadDays: 7,
			plannedAmountMinor: 5000,
		});
		expect(maintenanceReminderDate(monthly)).toBe("2026-01-24");
		expect(monthly.plannedAmountMinor).toBe(5000);
		const february = advanceMaintenanceSchedule(
			monthly,
			"complete",
			"2026-01-30",
		);
		expect(february.schedule?.dueDate).toBe("2026-02-28");
		expect(february.record.advancedOccurrences).toBe(1);
		const march = advanceMaintenanceSchedule(
			ongoing(february.schedule),
			"skip",
			"2026-02-20",
		);
		expect(march.schedule?.dueDate).toBe("2026-03-31");
		expect(march.schedule?.anchorDate).toBe("2026-01-31");
		const leap = createMaintenanceSchedule({
			dueDate: "2024-02-29",
			rule: { mode: "fixed", unit: "year", every: 1 },
		});
		const first = advanceMaintenanceSchedule(leap, "complete", "2024-02-29");
		expect(first.schedule?.dueDate).toBe("2025-02-28");
		expect(
			advanceMaintenanceSchedule(ongoing(first.schedule), "skip", "2025-02-28")
				.schedule?.dueDate,
		).toBe("2026-02-28");
		expect(
			advanceMaintenanceSchedule(leap, "skip", "2027-03-01").schedule?.dueDate,
		).toBe("2028-02-29");
	});

	it("advances overdue fixed plans to the first future occurrence without drifting", () => {
		const schedule = createMaintenanceSchedule({
			dueDate: "2026-01-31",
			rule: { mode: "fixed", unit: "month", every: 1 },
		});
		const result = advanceMaintenanceSchedule(
			schedule,
			"complete",
			"2026-04-10",
		);
		expect(result.schedule?.dueDate).toBe("2026-04-30");
		expect(result.record.advancedOccurrences).toBe(3);
		expect(
			advanceMaintenanceSchedule(ongoing(result.schedule), "skip", "2026-04-30")
				.schedule?.dueDate,
		).toBe("2026-05-31");
	});

	it("resets after-completion cadence only on completion; a skip preserves its anchor", () => {
		const start = createMaintenanceSchedule({
			dueDate: "2024-01-31",
			rule: { mode: "afterCompletion", unit: "month", every: 1 },
		});
		const skipped = advanceMaintenanceSchedule(start, "skip", "2024-01-31");
		expect(skipped.schedule?.dueDate).toBe("2024-02-29");
		expect(
			advanceMaintenanceSchedule(
				ongoing(skipped.schedule),
				"skip",
				"2024-02-20",
			).schedule?.dueDate,
		).toBe("2024-03-31");
		const completed = advanceMaintenanceSchedule(
			ongoing(skipped.schedule),
			"complete",
			"2024-03-03",
		);
		expect(completed.schedule?.anchorDate).toBe("2024-03-03");
		expect(completed.schedule?.dueDate).toBe("2024-04-03");
		expect(completed.record.action).toBe("complete");
	});

	it("ends a date-only plan and preserves an explicit skip record", () => {
		const once = createMaintenanceSchedule({
			dueDate: "2026-09-30",
			rule: { mode: "once" },
			leadDays: 0,
			plannedAmountMinor: null,
		});
		expect(maintenanceReminderDate(once)).toBe("2026-09-30");
		expect(advanceMaintenanceSchedule(once, "skip", "2026-09-29")).toEqual({
			schedule: null,
			record: {
				action: "skip",
				actionDate: "2026-09-29",
				previousDueDate: "2026-09-30",
				nextDueDate: null,
				advancedOccurrences: 0,
			},
		});
	});

	it("defers only the current occurrence with a recorded date while preserving the fixed anchor", () => {
		const schedule = createMaintenanceSchedule({ dueDate: "2026-09-30", rule: { mode: "fixed", unit: "month", every: 1 }, leadDays: 2 });
		const first = deferMaintenanceSchedule(schedule, "", "2026-09-29");
		expect(first).toEqual({ nextDueDate: "2026-10-07", record: { action: "defer", actionDate: "2026-09-29", previousDueDate: "2026-09-30", nextDueDate: "2026-10-07", advancedOccurrences: 0 } });
		expect(maintenanceReminderDate(schedule, first.nextDueDate)).toBe("2026-10-05");
		const again = deferMaintenanceSchedule(schedule, first.nextDueDate, "2026-10-01");
		expect(again.nextDueDate).toBe("2026-10-14");
		const finished = advanceMaintenanceSchedule(schedule, "complete", "2026-10-14", again.nextDueDate);
		expect(finished.record.previousDueDate).toBe("2026-10-14");
		expect(finished.schedule?.dueDate).toBe("2026-10-30");
		expect(finished.schedule?.anchorDate).toBe("2026-09-30");
		const once = createMaintenanceSchedule({ dueDate: "2026-09-30", rule: { mode: "once" } });
		expect(advanceMaintenanceSchedule(once, "skip", "2026-10-07", first.nextDueDate).record.previousDueDate).toBe("2026-10-07");
		expect(() => deferMaintenanceSchedule(once, "2026-09-29", "2026-09-29")).toThrow("invalid-defer-date");
	});

	it("uses calendar days in every time zone including skipped civil days", () => {
		const previous = process.env.TZ;
		try {
			for (const timeZone of ["UTC", "Pacific/Apia", "America/Los_Angeles"]) {
				process.env.TZ = timeZone;
				const daily = createMaintenanceSchedule({
					dueDate: "2011-12-29",
					rule: { mode: "fixed", unit: "day", every: 1 },
					leadDays: 1,
				});
				expect(maintenanceReminderDate(daily), timeZone).toBe("2011-12-28");
				expect(
					advanceMaintenanceSchedule(daily, "complete", "2011-12-29").schedule
						?.dueDate,
					timeZone,
				).toBe("2011-12-30");
			}
		} finally {
			process.env.TZ = previous;
		}
	});

	it("rejects invalid dates, stale occurrence counters, invalid amounts and overflow", () => {
		expect(() =>
			createMaintenanceSchedule({
				dueDate: "2025-02-29",
				rule: { mode: "once" },
			}),
		).toThrow();
		expect(() =>
			createMaintenanceSchedule({
				dueDate: "2026-01-01",
				rule: { mode: "fixed", unit: "day", every: 0 },
			}),
		).toThrow();
		expect(() =>
			createMaintenanceSchedule({
				dueDate: "2026-01-01",
				rule: { mode: "once" },
				plannedAmountMinor: -1,
			}),
		).toThrow();
		expect(
			maintenanceScheduleSchema.safeParse({
				...createMaintenanceSchedule({
					dueDate: "2026-01-31",
					rule: { mode: "fixed", unit: "month", every: 1 },
				}),
				occurrence: 1,
			}).success,
		).toBe(false);
		expect(() =>
			advanceMaintenanceSchedule(
				createMaintenanceSchedule({
					dueDate: "9999-12-31",
					rule: { mode: "fixed", unit: "day", every: 1 },
				}),
				"complete",
				"9999-12-31",
			),
		).toThrow("schedule-overflow");
		expect(() =>
			advanceMaintenanceSchedule(
				createMaintenanceSchedule({
					dueDate: "9999-12-31",
					rule: { mode: "afterCompletion", unit: "month", every: 1 },
				}),
				"complete",
				"9999-12-31",
			),
		).toThrow();
		expect(() =>
			createMaintenanceSchedule({
				dueDate: "0000-01-01",
				rule: { mode: "once" },
				leadDays: 1,
			}),
		).toThrow();
	});
});
