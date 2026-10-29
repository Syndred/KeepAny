import { Input } from "./ui/input";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { localRepository } from "../../../../packages/local-db/src";
import { browserReminderPermission, defaultReminderSettings, readReminderSettings, REMINDER_SETTINGS_ID, reminderSettingsSchema, showBrowserReminder, type BrowserReminderPermission, type ReminderPreference, type ReminderSettings } from "../reminders";
import { useAppContext } from "../view-shared";
import { Button } from "./ui/button";

export function ReminderSettingsPanel() {
	const { data } = useAppContext();
	const { t } = useTranslation();
	const preference = data.preferences.find((row) => row.id === REMINDER_SETTINGS_ID) ?? null;
	const [draft, setDraft] = useState<ReminderSettings>(defaultReminderSettings);
	const [permission, setPermission] = useState<BrowserReminderPermission>(browserReminderPermission);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const expected = useRef<ReminderPreference | null>(null);
	const dirty = useRef(false);
	const running = useRef(false);
	const requesting = useRef(false);
	useEffect(() => {
		if (!dirty.current) { setDraft(readReminderSettings(preference?.value)); expected.current = preference; }
	}, [preference]);
	useEffect(() => {
		const update = () => setPermission(browserReminderPermission());
		window.addEventListener("focus", update);
		return () => window.removeEventListener("focus", update);
	}, []);
	function change(patch: Partial<ReminderSettings>) {
		dirty.current = true;
		setMessage("");
		setDraft((current) => ({ ...current, ...patch }));
	}
	async function persist(next: ReminderSettings) {
		if (running.current || data.loading) return;
		const parsed = reminderSettingsSchema.safeParse(next);
		if (!parsed.success) { setMessage("reminderSettingsInvalid"); return; }
		running.current = true; setBusy(true); setMessage("");
		try {
			const repository = await localRepository();
			const saved = { id: REMINDER_SETTINGS_ID, value: parsed.data };
			await repository.saveReminderPreferenceIfCurrent(expected.current, saved);
			expected.current = saved; dirty.current = false; setDraft(parsed.data); setMessage("reminderSettingsSaved");
		} catch (cause) { setMessage(cause instanceof Error && cause.message === "preference-stale" ? "reminderSettingsStale" : "error"); }
		finally { running.current = false; setBusy(false); }
	}
	async function allowBrowser() {
		if (running.current || requesting.current || data.loading) return;
		const state = browserReminderPermission();
		if (state === "unsupported" || state === "denied") { setPermission(state); return; }
		// This call must occur directly from the user's click, before any asynchronous storage work.
		requesting.current = true;
		setBusy(true);
		try {
			const allowed = state === "granted" ? "granted" : await Notification.requestPermission();
			setPermission(allowed);
			requesting.current = false;
			if (allowed === "granted") await persist({ ...draft, browserEnabled: true });
		} catch { setPermission(browserReminderPermission()); setMessage("reminderBrowserFailed"); }
		finally { requesting.current = false; setBusy(false); }
	}
	return <section className="card padded">
		<h2>{t("reminderSettingsTitle")}</h2>
		<p className="muted">{t("reminderRuntimeScope")}</p>
		<form className="reminder-settings-form" onSubmit={(event) => { event.preventDefault(); void persist(draft); }}>
			<div className="form-grid">
				<label><input type="checkbox" checked={draft.enabled} disabled={busy || data.loading} onChange={(event) => change({ enabled: event.target.checked })} /> {t("reminderEnabled")}</label>
				<label><input type="checkbox" checked={draft.subscriptionEnabled} disabled={busy || data.loading} onChange={(event) => change({ subscriptionEnabled: event.target.checked })} /> {t("reminderSubscriptionEnabled")}</label>
				<label className="field" htmlFor="reminder-lead-days">{t("reminderLeadDays")}<Input id="reminder-lead-days" type="number" min="0" max="3650" required value={draft.leadDays} disabled={busy || data.loading} onChange={(event) => change({ leadDays: event.target.valueAsNumber })} /></label>
				<label className="field" htmlFor="reminder-clock">{t("reminderClockTime")}<Input id="reminder-clock" type="time" required value={draft.time} disabled={busy || data.loading} onChange={(event) => change({ time: event.target.value })} /></label>
				<label className="field" htmlFor="reminder-time-zone">{t("reminderTimeZone")}<Input id="reminder-time-zone" required value={draft.timeZone} disabled={busy || data.loading} onChange={(event) => change({ timeZone: event.target.value })} /></label>
				<label><input type="checkbox" checked={draft.browserEnabled} disabled={busy || data.loading || (permission !== "granted" && !draft.browserEnabled)} onChange={(event) => change({ browserEnabled: event.target.checked })} /> {t("reminderBrowserEnabled")}</label>
			</div>
			<p role="status">{t(`reminderPermission_${permission}`)}</p>
			<div className="toolbar">
				<Button type="submit" variant="primary" disabled={busy || data.loading}>{t("save")}</Button>
				{permission === "default" && <Button type="button" disabled={busy || data.loading} onClick={() => void allowBrowser()}>{t("reminderEnableBrowser")}</Button>}
				{permission === "granted" && <Button type="button" disabled={busy} onClick={() => { const result = showBrowserReminder(t("reminderTestTitle"), t("reminderTestBody"), "keepany-reminder-test"); setMessage(result === "shown" ? "reminderTestBody" : "reminderBrowserFailed"); }}>{t("reminderTest")}</Button>}
			</div>
			{message && <p role="status">{t(message)}</p>}
		</form>
	</section>;
}
