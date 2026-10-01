import "fake-indexeddb/auto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { taskSchema, type Task } from "../../../packages/domain/src";
import { createTaskReminder } from "../../../packages/domain/src/task-reminder";
import { openLocalRepository } from "../../../packages/local-db/src";
import { TaskRow } from "./TaskRow";
import { reminderCopy } from "./reminder-copy";

vi.mock("./view-shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./view-shared")>();
	return { ...original, useAppContext: () => ({ data: { assets: [] }, notify: () => {} }) };
});

async function render(task: Task, language: "zh-CN" | "en") {
	const i18n = createInstance();
	await i18n.init({ lng: language, interpolation: { escapeValue: false }, resources: {
		[language]: { translation: Object.fromEntries(Object.entries(reminderCopy).map(([key, value]) => [key, value[language === "zh-CN" ? 0 : 1]])) },
	} });
	return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(TaskRow, { task })));
}

describe("saved task reminder summary", () => {
	it.each(["zh-CN", "en"] as const)("renders the reloaded reminder time, zone, lead and recurrence in %s", async (language) => {
		const dbName = `summary-${crypto.randomUUID().slice(0, 10)}`;
		const repository = await openLocalRepository(dbName);
		const task = taskSchema.parse({ id: crypto.randomUUID(), name: "Review", dueDate: "2026-10-02", createdAt: "2026-10-01T00:00:00.000Z", reminder: createTaskReminder({ at: "2026-10-02T01:00:00.000Z", timeZone: "Asia/Shanghai", leadMinutes: 30, rule: { mode: "fixed", unit: "week", every: 2 } }) });
		await repository.save("task", task);
		await repository.close();
		const reloaded = await openLocalRepository(dbName);
		try {
			const stored = await reloaded.get<Task>("task", task.id);
			if (!stored) throw Error("task-missing");
			const html = await render(stored, language);
			expect(html).toContain('dateTime="2026-10-02T00:30:00.000Z"');
			expect(html).toContain('dateTime="2026-10-02T01:00:00.000Z"');
			expect(html).toContain("Asia/Shanghai");
			expect(html).toContain(language === "zh-CN" ? "08:30" : "08:30 AM");
			expect(html).toContain(language === "zh-CN" ? "提前 30 分钟" : "30 minutes before");
			expect(html).toContain(language === "zh-CN" ? "每 2 周" : "Every 2 weeks");
		} finally { await reloaded.close(); }
	});
	it("describes one-time and after-completion rules, including singular English units", async () => {
		const reminder = createTaskReminder({ at: "2026-10-02T01:00:00.000Z", timeZone: "Asia/Shanghai", leadMinutes: 1 });
		const task = taskSchema.parse({ id: "summary", name: "Review", dueDate: "2026-10-02", createdAt: reminder.at, reminder });
		expect(await render(task, "en")).toContain("1 minute before · One time");
		const repeated = { ...task, reminder: createTaskReminder({ ...reminder, rule: { mode: "afterCompletion", unit: "month", every: 1 } }) };
		expect(await render(repeated, "en")).toContain("Every month after completion");
	});
});
