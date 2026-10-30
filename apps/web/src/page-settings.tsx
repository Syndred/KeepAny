import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SampleLibraryButton } from "./components/SampleLibraryButton";
import { McpPanel } from "./components/McpPanel";
import { AiSettingsPanel } from "./components/AiSettingsPanel";
import { ReminderSettingsPanel } from "./components/ReminderSettingsPanel";
import { Button } from "./components/ui/button";
import { Select, SelectOption } from "./components/ui/select";
import { PageTitle, useAppContext } from "./view-shared";
import "./settings-intake-restoration.css";

export function SettingsPage() {
  const { data, notify } = useAppContext();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [requested, setRequested] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(() => window.location.hash === "#assistant");
  const [advancedOpen, setAdvancedOpen] = useState(() => window.location.hash === "#advanced-settings");
  useEffect(() => {
    const openLinkedSection = () => {
      if (window.location.hash === "#assistant") setAssistantOpen(true);
      if (window.location.hash === "#advanced-settings") setAdvancedOpen(true);
    };
    window.addEventListener("hashchange", openLinkedSection);
    return () => window.removeEventListener("hashchange", openLinkedSection);
  }, []);
  useEffect(() => {
    if (location.hash === "assistant" || location.hash === "#assistant") setAssistantOpen(true);
    if (location.hash === "advanced-settings" || location.hash === "#advanced-settings") setAdvancedOpen(true);
  }, [location.hash]);
  useEffect(() => {
    if (assistantOpen && window.location.hash === "#assistant")
      document.getElementById("mcp-panel-title")?.focus();
  }, [assistantOpen]);
  useEffect(() => {
    let current = true;
    void navigator.storage?.persisted?.().then(value => { if (current) setPersistent(value); });
    return () => { current = false; };
  }, []);
	return (
		<main className="page settings-restored">
			<PageTitle title={t("settings")} />
			<div className="card-grid">
				<section className="card padded">
					<h2 id="settings-language-label">{t("language")}</h2>
					<Select
						aria-labelledby="settings-language-label"
						value={i18n.language}
						onValueChange={(selectValue) => {
							const value = selectValue;
							localStorage.setItem("keepany-language", value);
							void i18n.changeLanguage(value);
						}}
					>
						<SelectOption value="zh-CN">{t("languageChinese")}</SelectOption>
						<SelectOption value="en">{t("languageEnglish")}</SelectOption>
					</Select>
				</section>
				<section className="card padded">
					<h2>{t("storage")}</h2>
					<p>{t("storageHint")}</p>
					<div className="actions">
						<Button
							onClick={async () => {
								const value = await navigator.storage?.persist?.();
								setRequested(true);
								setPersistent(Boolean(value));
								notify(t(value ? "persistent" : "persistDenied"));
							}}
						>
							{t("persist")}
						</Button>
						<Link className="button" to="/backup">
							{t("backupAndRestore")}
						</Link>
					</div>
					{(persistent === true || requested) && (
						<small>{t(persistent ? "persistent" : "persistDenied")}</small>
					)}
				</section>
			</div>
			<ReminderSettingsPanel />
			<details id="assistant" className="settings-section" open={assistantOpen} onToggle={event => setAssistantOpen(event.currentTarget.open)}>
				<summary><span><strong>{t("settingsAssistantAccess")}</strong><small>{t("settingsAssistantHint")}</small></span></summary>
				<div className="settings-section-body">
					<div className="actions"><Button onClick={() => window.dispatchEvent(new Event("keepany-open-ai-dialog"))}>{t("settingsAskAssistant")}</Button></div>
					<AiSettingsPanel />
					<McpPanel />
				</div>
			</details>
			<details id="advanced-settings" className="settings-section" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
				<summary><span><strong>{t("settingsAdvanced")}</strong><small>{t("settingsAdvancedHint")}</small></span></summary>
				<div className="settings-section-body">
			<section className="card padded">
				<h2>{t("trial")}</h2>
				<p>{t("sampleLibraryDescription")}</p>
				<SampleLibraryButton />
			</section>
				</div>
			</details>
		</main>
	);
}
