import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import "./pwa-update.css";

function hasUncommittedEdit(): boolean {
	if (document.querySelector('[role="dialog"], dialog[open]')) return true;
	const active = document.activeElement;
	if (active instanceof HTMLElement && (active.isContentEditable || active.matches("textarea, select, input:not([type=search])"))) return true;
	for (const field of document.querySelectorAll("form input, form textarea, form select, [contenteditable]")) {
		if (field instanceof HTMLInputElement) {
			if (field.disabled || field.readOnly || field.type === "search") continue;
			if (field.type === "file" ? field.files && field.files.length > 0 : field.type === "checkbox" || field.type === "radio" ? field.checked !== field.defaultChecked : field.value !== field.defaultValue) return true;
		} else if (field instanceof HTMLTextAreaElement && !field.disabled && !field.readOnly && field.value !== field.defaultValue) return true;
		else if (field instanceof HTMLSelectElement && !field.disabled && Array.from(field.options).some((option) => option.selected !== option.defaultSelected)) return true;
		else if (field instanceof HTMLElement && field.isContentEditable) return true;
	}
	return false;
}

export function PwaUpdatePrompt() {
	const { t } = useTranslation();
	const [registration, setRegistration] = useState<ServiceWorkerRegistration | undefined>();
	const [updateReady, setUpdateReady] = useState(false);
	const [blocked, setBlocked] = useState(false);
	useRegisterSW({
		onNeedReload: () => setUpdateReady(true),
		onRegisteredSW: (_url, value) => setRegistration(value),
	});

	useEffect(() => {
		if (!registration) return;
		const check = () => {
			if (navigator.onLine && document.visibilityState === "visible") void registration.update().catch(() => undefined);
		};
		window.addEventListener("focus", check);
		window.addEventListener("online", check);
		document.addEventListener("visibilitychange", check);
		const timer = window.setInterval(check, 30 * 60 * 1000);
		return () => {
			window.removeEventListener("focus", check);
			window.removeEventListener("online", check);
			document.removeEventListener("visibilitychange", check);
			window.clearInterval(timer);
		};
	}, [registration]);

	if (!updateReady) return null;
	return (
		<aside className="pwa-update" role="status" aria-live="polite">
			<div>
				<strong>{t("appUpdateReady")}</strong>
				<p>{blocked ? t("appUpdateSaveFirst") : t("appUpdateHint")}</p>
			</div>
			<button type="button" onClick={() => {
				if (hasUncommittedEdit()) { setBlocked(true); return; }
				window.location.reload();
			}}>{t("appUpdateNow")}</button>
		</aside>
	);
}
