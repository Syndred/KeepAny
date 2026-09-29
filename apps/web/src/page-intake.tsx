import { useTranslation } from "react-i18next";
import { IntakeTools } from "./workflows";
import { IntakeReview } from "./IntakeReview";
import { PageTitle } from "./view-shared";
import "./settings-intake-restoration.css";
export function IntakePage() {
	const { t } = useTranslation();
	return (
		<main className="page intake-restored">
			<PageTitle eyebrow={t("intake")} title={t("intakePageTitle")} subtitle={t("intakePageSubtitle")} />
			<section className="card padded intake-review-card"><h2>{t("reviewTitle")}</h2><IntakeReview /></section>
			<IntakeTools />
		</main>
	);
}
