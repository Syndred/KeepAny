import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import "./asset-views.css";

export function useAssetView() {
	const [view, setView] = useState<"list" | "cards">(() =>
		sessionStorage.getItem("keepany-asset-view") === "cards" ? "cards" : "list",
	);
	return [
		view,
		(next: "list" | "cards") => {
			sessionStorage.setItem("keepany-asset-view", next);
			setView(next);
		},
	] as const;
}
export function AssetViewToggle({
	value,
	onChange,
}: {
	value: "list" | "cards";
	onChange: (view: "list" | "cards") => void;
}) {
	const { t } = useTranslation();
	return (
		<fieldset className="asset-view-toggle" aria-label={t("assetView")}>
			<Button
				size="small"
				variant={value === "list" ? "primary" : "default"}
				aria-pressed={value === "list"}
				onClick={() => onChange("list")}
			>
				<List size={15} />
				{t("assetListView")}
			</Button>
			<Button
				size="small"
				variant={value === "cards" ? "primary" : "default"}
				aria-pressed={value === "cards"}
				onClick={() => onChange("cards")}
			>
				<LayoutGrid size={15} />
				{t("assetCardView")}
			</Button>
		</fieldset>
	);
}
