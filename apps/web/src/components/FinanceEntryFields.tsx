import { useTranslation } from "react-i18next";
import { currencies, type Asset } from "../../../../packages/domain/src";
import { Select, SelectOption } from "./ui/select";

export type FinanceEntryDraft = {
	assetId: string; title: string; amount: string;
	currency: typeof currencies[number]; eventDate: string; source: string; note: string;
};

/** Shared fields for manually reviewed transactions and ordinary ledger entries. */
export function FinanceEntryFields({ draft, targets, onChange, disabled, idPrefix }: {
	draft: FinanceEntryDraft; targets: Asset[];
	onChange: (change: Partial<FinanceEntryDraft>) => void;
	disabled: boolean; idPrefix: string;
}) {
	const { t } = useTranslation();
	return <>
		<div className="field"><label htmlFor={`${idPrefix}-asset`}>{t("financeRelatedAsset")}</label><Select id={`${idPrefix}-asset`} value={draft.assetId} disabled={disabled} onValueChange={(selectValue) => {
			const asset = targets.find((item) => item.id === selectValue);
			onChange({ assetId: selectValue, currency: asset?.currency ?? draft.currency });
		}}><SelectOption value="" disabled>{t("reviewSelectFinanceTarget")}</SelectOption>{draft.assetId && !targets.some((asset) => asset.id === draft.assetId) && <SelectOption value={draft.assetId} disabled>{t("financeMissingAsset")}</SelectOption>}{targets.map((asset) => <SelectOption key={asset.id} value={asset.id}>{asset.name} · {t(asset.kind)}</SelectOption>)}</Select></div>
		<div className="field"><label htmlFor={`${idPrefix}-title`}>{t("financeRecordTitle")}</label><input id={`${idPrefix}-title`} value={draft.title} disabled={disabled} onChange={(event) => onChange({ title: event.target.value })} /></div>
		<div className="finance-form-pair"><div className="field"><label htmlFor={`${idPrefix}-amount`}>{t("financeAmount")}</label><input id={`${idPrefix}-amount`} inputMode="decimal" value={draft.amount} disabled={disabled} onChange={(event) => onChange({ amount: event.target.value })} /></div><div className="field"><label htmlFor={`${idPrefix}-currency`}>{t("currency")}</label><Select id={`${idPrefix}-currency`} value={draft.currency} disabled={disabled} onValueChange={(selectValue) => onChange({ currency: selectValue as typeof currencies[number] })}>{currencies.map((currency) => <SelectOption key={currency} value={currency}>{currency}</SelectOption>)}</Select></div></div>
		<div className="field"><label htmlFor={`${idPrefix}-date`}>{t("financeDate")}</label><input id={`${idPrefix}-date`} type="date" value={draft.eventDate} disabled={disabled} onChange={(event) => onChange({ eventDate: event.target.value })} /></div>
		<div className="field"><label htmlFor={`${idPrefix}-source`}>{t("financeSource")}</label><input id={`${idPrefix}-source`} value={draft.source} disabled={disabled} onChange={(event) => onChange({ source: event.target.value })} /></div>
		<div className="field"><label htmlFor={`${idPrefix}-note`}>{t("financeNote")}</label><textarea id={`${idPrefix}-note`} rows={2} value={draft.note} disabled={disabled} onChange={(event) => onChange({ note: event.target.value })} /></div>
	</>;
}
