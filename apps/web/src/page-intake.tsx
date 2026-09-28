import { useTranslation } from "react-i18next";
import { IntakeTools } from "./workflows";
import { PageTitle } from "./view-shared";
export function IntakePage() {
	const { t } = useTranslation();
	return (
		<main className="page">
			<PageTitle title={t("intake")} subtitle={t("storageHint")} />
			<IntakeTools />
		</main>
	);
}
