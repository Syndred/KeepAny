import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IntakeTools } from "./workflow-intake-tools";
import { IntakeReview } from "./IntakeReview";
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
		</main>
	);
}
