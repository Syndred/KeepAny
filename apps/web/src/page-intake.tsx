import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IntakeTools } from "./workflows";
import { IntakeReview } from "./IntakeReview";
import { ExternalLinkImportPanel } from "./components/ExternalLinkImportPanel";
import { PageTitle } from "./view-shared";
import "./settings-intake-restoration.css";
import { AiImportPanel } from "./components/AiImportPanel";
import "./ai-workflow.css";
export function IntakePage() {
	const { t } = useTranslation();
	const [reviewRevision, setReviewRevision] = useState(0);
	return (
		<main className="page intake-restored">
			<PageTitle eyebrow={t("intake")} title={t("intakePageTitle")} subtitle={t("intakePageSubtitle")} />
			<AiImportPanel onStaged={() => setReviewRevision((value) => value + 1)} />
			<IntakeTools onCsvStaged={() => setReviewRevision((value) => value + 1)} />
			<section className="card padded intake-review-card"><h2>{t("reviewTitle")}</h2><IntakeReview key={reviewRevision} /></section>
			<details className="card intake-secondary"><summary>{t("intakeExternalLinkImport")}</summary><ExternalLinkImportPanel /></details>
		</main>
	);
}
