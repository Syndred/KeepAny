import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { localRepository } from "../../../packages/local-db/src";
import { REMINDER_CATCH_UP_MS, REMINDER_SETTINGS_ID, dueReminders, readReminderSettings, reminderDeliveryId, showBrowserReminder } from "./reminders";
import { useAppContext } from "./view-shared";
import "./reminder-runtime.css";
import { TextLink } from "./components/ui/text-link";

export function ReminderRuntime() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const [now, setNow] = useState(Date.now);
	const [browserFailed, setBrowserFailed] = useState(false);
	const running = useRef(false);
	const preference = data.preferences.find((row) => row.id === REMINDER_SETTINGS_ID) ?? null;
	const settings = useMemo(() => readReminderSettings(preference?.value), [preference?.value]);
	const due = useMemo(() => dueReminders(data.tasks, data.assets, settings, now), [data.tasks, data.assets, settings, now]);
	useEffect(() => {
		const update = () => setNow(Date.now());
		const timer = window.setInterval(update, 15_000);
		window.addEventListener("focus", update);
		document.addEventListener("visibilitychange", update);
		return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
	}, []);
	useEffect(() => {
		if (data.loading || running.current) return;
		let active = true;
		running.current = true;
		void (async () => {
			const repository = await localRepository();
			let delivered = 0;
			for (const reminder of due.filter((item) => now - Date.parse(item.scheduledAt) <= REMINDER_CATCH_UP_MS)) {
				if (!active) break;
				const id = await reminderDeliveryId(reminder);
				if (!active) break;
				await repository.deliverReminderIfCurrent({ id, sourceType: reminder.sourceType, expected: reminder.source, expectedPreference: preference, scheduledAt: reminder.scheduledAt }, () => {
					// A committed receipt must be dispatched even when its reactive update rerenders this effect.
					delivered++;
					if (settings.browserEnabled) {
						const body = t("reminderDueBody", { time: new Date(reminder.dueAt).toLocaleString(i18n.language, { timeZone: reminder.sourceType === "task" && "reminder" in reminder.source && reminder.source.reminder ? reminder.source.reminder.timeZone : settings.subscriptionOverrides[reminder.source.id]?.timeZone ?? settings.timeZone }) });
						const outcome = showBrowserReminder(reminder.source.name, body, id, () => {
							window.focus();
							if (reminder.sourceType === "task") void navigate({ to: "/tasks", hash: `task-${reminder.source.id}` });
							else void navigate({ to: "/assets/$kind/$id", params: { kind: "subscription", id: reminder.source.id } });
						});
						if (outcome !== "shown") setBrowserFailed(true);
					}
				});
			}
			if (delivered) notify(t("reminderArrived", { count: delivered }));
		})().catch(() => { /* Recovery or stale data will be retried on the next tick. */ }).finally(() => { running.current = false; });
		return () => { active = false; };
	}, [due, preference, settings, data.loading, now, t, i18n.language, navigate, notify]);
	if (!due.length) return null;
	return <aside className="card reminder-runtime-banner" aria-label={t("reminderDueTitle")}>
		<strong>{t("reminderDueCount", { count: due.length })}</strong>
		<div className="toolbar">{due.slice(0, 3).map((reminder) => <TextLink key={`${reminder.sourceType}:${reminder.source.id}`} asChild>{reminder.sourceType === "task" ? <Link to="/tasks" hash={`task-${reminder.source.id}`}>{reminder.source.name}</Link> : <Link to="/assets/$kind/$id" params={{ kind: "subscription", id: reminder.source.id }}>{reminder.source.name} · {t("reminderDueSubscription")}</Link>}</TextLink>)}{due.length > 3 && <TextLink asChild><Link to="/tasks">{t("reminderMore")}</Link></TextLink>}</div>
		{browserFailed && <p role="status">{t("reminderBrowserFailed")}</p>}
	</aside>;
}
