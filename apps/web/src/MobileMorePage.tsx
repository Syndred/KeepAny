import { Link } from "@tanstack/react-router";
import {
	Archive, ArrowRight, Bell, BookOpen, CreditCard, FolderOpen,
	KeyRound, Link2, LockKeyhole, Network, Package, Settings, ShieldCheck,
	Sparkles, Tags, Trash2, Upload, UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, type ComponentType, type ReactNode } from "react";
import { PageTitle } from "./view-shared";
import "./mobile-copy";
import "./mobile-shell.css";

function ToolContent({ icon: Icon, label, hint }: {
	icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
	label: string;
	hint?: string;
}) {
	return <><span className="mobile-tool-icon"><Icon size={21} aria-hidden /></span>
		<span className="mobile-tool-text"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
		<ArrowRight className="mobile-tool-arrow" size={17} aria-hidden />
	</>;
}

function ToolGroup({ title, children }: { title: string; children: ReactNode }) {
	return <section className="mobile-tool-group"><h2>{title}</h2><div className="mobile-tool-list">{children}</div></section>;
}

export function MobileMorePage() {
	const { t } = useTranslation();
	useEffect(() => {
		const saved = Number(sessionStorage.getItem("keepany-mobile-more-scroll") ?? "0");
		const frame = requestAnimationFrame(() => { if (Number.isFinite(saved) && saved >= 0) window.scrollTo(0, saved); });
		return () => cancelAnimationFrame(frame);
	}, []);
	return <main className="page mobile-more-page" onClickCapture={(event) => {
		if (event.target instanceof Element && event.target.closest(".mobile-tool")) sessionStorage.setItem("keepany-mobile-more-scroll", String(window.scrollY));
	}}>
		<PageTitle title={t("mobileMore")} subtitle={t("mobileMoreSubtitle")} />
		<ToolGroup title={t("mobileOrganize")}>
			<Link to="/intake" className="mobile-tool"><ToolContent icon={Upload} label={t("intake")} hint={t("mobileIntakeHint")} /></Link>
			<Link to="/finance" className="mobile-tool"><ToolContent icon={CreditCard} label={t("workspaceLedger")} hint={t("mobileLedgerHint")} /></Link>
			<Link to="/collections" className="mobile-tool"><ToolContent icon={FolderOpen} label={t("collectionsTitle")} hint={t("mobileCollectionsHint")} /></Link>
			<Link to="/change-impact" className="mobile-tool"><ToolContent icon={Network} label={t("checkChangeImpact")} hint={t("mobileImpactHint")} /></Link>
		</ToolGroup>
		<ToolGroup title={t("mobileCategoriesAndTags")}>
			<Link to="/assets/$kind" params={{ kind: "project" }} className="mobile-tool"><ToolContent icon={Tags} label={t("mobileProjectCategories")} /></Link>
			<Link to="/assets/$kind" params={{ kind: "item" }} className="mobile-tool"><ToolContent icon={Package} label={t("mobileItemCategories")} /></Link>
			<Link to="/assets/$kind" params={{ kind: "subscription" }} className="mobile-tool"><ToolContent icon={Bell} label={t("mobileSubscriptionCategories")} /></Link>
			<Link to="/accounts" className="mobile-tool"><ToolContent icon={UserRound} label={t("mobileAccountCategories")} /></Link>
		</ToolGroup>
		<ToolGroup title={t("mobileSecurityAndData")}>
			<Link to="/assets/$kind" params={{ kind: "vault" }} className="mobile-tool"><ToolContent icon={LockKeyhole} label={t("workspacePasswords")} hint={t("mobilePasswordsHint")} /></Link>
			<Link to="/assets/$kind" params={{ kind: "vault" }} hash="vault-references" className="mobile-tool"><ToolContent icon={KeyRound} label={t("mobileReferences")} hint={t("mobileReferencesHint")} /></Link>
			<Link to="/intake" hash="backup-password" className="mobile-tool"><ToolContent icon={Archive} label={t("backup")} hint={t("mobileBackupHint")} /></Link>
			<Link to="/trash" className="mobile-tool"><ToolContent icon={Trash2} label={t("trash")} hint={t("mobileTrashHint")} /></Link>
		</ToolGroup>
		<ToolGroup title={t("mobileAssistantAndConnections")}>
			<button type="button" className="mobile-tool" onClick={() => window.dispatchEvent(new Event("keepany-open-ai-dialog"))}><ToolContent icon={Sparkles} label={t("mobileAskAssistant")} hint={t("mobileAskAssistantHint")} /></button>
			<Link to="/settings" hash="assistant" className="mobile-tool"><ToolContent icon={BookOpen} label={t("mobileAiSettings")} hint={t("mobileAiSettingsHint")} /></Link>
			<Link to="/assistant-access" className="mobile-tool"><ToolContent icon={ShieldCheck} label={t("settingsAssistantAccess")} hint={t("mobileAccessHint")} /></Link>
			<Link to="/settings" hash="connections" className="mobile-tool"><ToolContent icon={Link2} label={t("settingsConnections")} hint={t("mobileConnectionsHint")} /></Link>
			<Link to="/settings" className="mobile-tool"><ToolContent icon={Settings} label={t("settings")} hint={t("mobileSettingsHint")} /></Link>
		</ToolGroup>
	</main>;
}
