import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IntakeTools } from "./workflow-intake-tools";
import { IntakeReview } from "./IntakeReview";
import { PageTitle } from "./view-shared";
import "./settings-intake-restoration.css";
import { AiImportPanel } from "./components/AiImportPanel";
import "./ai-workflow.css";
import { Button } from "./components/ui/button";
import { useAiConnection } from "./ai-settings-store";
export function IntakePage() {
	const { t } = useTranslation();
	const { connection } = useAiConnection();
	const [selected, setSelected] = useState<"local" | "ai" | null>(() => window.location.hash === "#ai" ? "ai" : null);
	const mode = selected ?? (connection ? "ai" : "local");
	const [reviewRevision, setReviewRevision] = useState(0);
	return (
		<main className="page intake-restored">
			<PageTitle eyebrow={t("intake")} title={t("intakePageTitle")} subtitle={t("intakePageSubtitle")} action={<Link className="button" to="/backup">{t("backupAndRestore")}</Link>} />
			<div className="tabs intake-channel-tabs" role="group" aria-label={t("intakeMode")}>
				<Button aria-pressed={mode === "local"} onClick={() => setSelected("local")}>{t("captureTab")}</Button>
				<Button aria-pressed={mode === "ai"} onClick={() => setSelected("ai")}>{t("aiCaptureTab")}</Button>
			</div>
			<div hidden={mode !== "local"}><IntakeTools section="capture" onCsvStaged={() => setReviewRevision((value) => value + 1)} /></div>
			<div hidden={mode !== "ai"}><AiImportPanel onStaged={() => setReviewRevision((value) => value + 1)} /></div>
			<section className="card padded intake-review-card"><h2>{t("reviewTitle")}</h2><IntakeReview key={reviewRevision} /></section>
		</main>
	);
}

export function BackupPage() {
	const { t } = useTranslation();
	return <main className="page intake-restored"><PageTitle title={t("backupAndRestore")} action={<Link className="button" to="/intake">{t("captureTab")}</Link>} /><IntakeTools section="backup" onCsvStaged={() => undefined} /></main>;
}
