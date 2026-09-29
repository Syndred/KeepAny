import { useTranslation } from "react-i18next";
import { IntakeTools } from "./workflows";
import { PageTitle } from "./view-shared";
import "./settings-intake-restoration.css";
export function IntakePage() {
	const { t } = useTranslation();
	return (
		<main className="page intake-restored">
			<PageTitle eyebrow={t("intake")} title={t("intakePageTitle")} subtitle={t("intakePageSubtitle")} />
			<IntakeTools />
		</main>
	);
}
