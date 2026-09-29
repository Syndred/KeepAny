import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
	currencies, financeActions, formatMinorUnits, historySchema, monthlyMinorUnits,
	parseMinorUnits, type Asset, type History,
} from "../../../packages/domain/src";
import { localRepository, save } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { date, liveAssets, PageTitle, useAppContext } from "./view-shared";
import "./finance.css";

type ManualAction = typeof financeActions[number];
type LedgerAction = ManualAction | "renew";
type EntryDraft = { action: ManualAction; assetId: string; title: string; amount: string; currency: typeof currencies[number]; eventDate: string; source: string; note: string };
const ledgerActions = new Set<string>([...financeActions, "renew"]);
const isManualAction = (action: string): action is ManualAction => financeActions.includes(action as ManualAction);
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`; };

function groupedMoney(entries: ReadonlyArray<{ currency: string; amount: number | bigint }>): Map<string, bigint> {
	const totals = new Map<string, bigint>();
	for (const entry of entries) totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + BigInt(entry.amount));
	return totals;
}

function MoneyLines({ totals, language, empty }: { totals: Map<string, bigint>; language: string; empty: string }) {
	return totals.size ? <div className="finance-money-lines">{[...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) =>
		<strong key={currency}>{formatMinorUnits(amount, currency, language)}</strong>)}</div> : <strong>{empty}</strong>;
}

export function FinancePage() {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const targets = liveAssets(data).filter((asset) => asset.kind === "subscription" || asset.kind === "account");
	const subscriptions = targets.filter((asset) => asset.kind === "subscription");
	const assetsById = new Map(data.assets.map((asset) => [asset.id, asset]));
	const records = data.history.filter((entry) => {
		if (entry.deleted || !ledgerActions.has(entry.action)) return false;
		const kind = assetsById.get(entry.assetId)?.kind;
		return entry.action === "renew" ? kind === "subscription" : kind === "subscription" || kind === "account";
	});
	const [recordOpen, setRecordOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [error, setError] = useState("");
	const [typeFilter, setTypeFilter] = useState<LedgerAction | "all">("all");
	const [assetFilter, setAssetFilter] = useState("");
	const [sourceFilter, setSourceFilter] = useState("all");
	const [draft, setDraft] = useState<EntryDraft>(() => ({ action: "expense", assetId: "", title: "", amount: "", currency: "CNY", eventDate: today(), source: "", note: "" }));
	const thisMonth = today().slice(0, 7);
	const planned = groupedMoney(subscriptions.filter((asset) => asset.status === "active")
		.map((asset) => ({ currency: asset.currency, amount: monthlyMinorUnits(asset) })));
	const confirmed = groupedMoney(records.filter((entry) =>
		(entry.action === "expense" && entry.eventDate?.startsWith(thisMonth)) ||
		(entry.action === "renew" && entry.billDate?.startsWith(thisMonth)))
		.filter((entry): entry is History & { amount: number; currency: string } => entry.amount !== undefined && !!entry.currency)
		.map((entry) => ({ currency: entry.currency, amount: entry.amount })));
	const latestBalances = new Map<string, History>();
	for (const entry of records.filter((item) => item.action === "balance" && item.currency && item.amount !== undefined)) {
		const key = `${entry.assetId}:${entry.currency}`;
		const previous = latestBalances.get(key);
		if (!previous || `${entry.eventDate}:${entry.createdAt}` > `${previous.eventDate}:${previous.createdAt}`) latestBalances.set(key, entry);
	}
	const balances = groupedMoney([...latestBalances.values()].map((entry) => ({ currency: entry.currency!, amount: entry.amount! })));
	const sources = [...new Set(records.map((entry) => entry.source?.trim()).filter((source): source is string => !!source))].sort((a, b) => a.localeCompare(b));
	const hasEmptySource = records.some((entry) => !entry.source?.trim());
	const filtered = records.filter((entry) => (typeFilter === "all" || entry.action === typeFilter) && (!assetFilter || entry.assetId === assetFilter)
		&& (sourceFilter === "all" || (sourceFilter === "empty" ? !entry.source?.trim() : entry.source?.trim() === sourceFilter.slice(7))))
		.sort((a, b) => (b.eventDate || b.billDate || b.createdAt).localeCompare(a.eventDate || a.billDate || a.createdAt) || b.createdAt.localeCompare(a.createdAt));
	function openRecord() {
		const target = targets[0];
		setDraft({ action: "expense", assetId: target?.id ?? "", title: "", amount: "", currency: target?.currency ?? "CNY", eventDate: today(), source: "", note: "" });
		setError("");
		setRecordOpen(true);
	}
	function closeRecord() { if (!inFlight.current) setRecordOpen(false); }
	async function saveRecord(event: FormEvent) {
		event.preventDefault();
		if (inFlight.current || !targets.length) return;
		const amount = parseMinorUnits(draft.amount, draft.currency);
		if (!draft.amount.trim() || !Number.isSafeInteger(amount) || amount < 0 || (draft.action !== "balance" && amount === 0)) { setError(t("financeInvalidAmount")); return; }
		const candidate = historySchema.safeParse({
			id: crypto.randomUUID(), assetId: draft.assetId, action: draft.action,
			title: draft.title.trim(), amount, currency: draft.currency,
			eventDate: draft.eventDate, source: draft.source.trim(), note: draft.note.trim(),
			createdAt: new Date().toISOString(), deleted: false,
		});
		if (!candidate.success) { setError(t("financeInvalidRecord")); return; }
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			const asset = await (await localRepository()).get<Asset>("asset", draft.assetId);
			if (!asset || asset.deleted || (asset.kind !== "subscription" && asset.kind !== "account")) { setError(t("financeTargetChanged")); return; }
			await save("history", candidate.data);
			setRecordOpen(false);
			notify(t("financeRecordSaved"));
		} catch { setError(t("error")); }
		finally { inFlight.current = false; setBusy(false); }
	}
	const historyLabel = (entry: History) => entry.action === "renew" ? t("financeRenewalRecorded") : t(`financeAction${entry.action[0].toUpperCase()}${entry.action.slice(1)}`);
	return <main className="page finance-page">
		<PageTitle eyebrow={t("financeEyebrow")} title={t("financeTitle")} subtitle={t("financeSubtitle")}
			action={<Button variant="primary" onClick={openRecord}><Plus size={16}/>{t("financeAddRecord")}</Button>} />
		<div className="finance-summary">
			<section className="card"><span>{t("financeMonthlyPlan")}</span><MoneyLines totals={planned} language={i18n.language} empty={t("financeNoPlan")}/><small>{t("financePlanHint")}</small></section>
			<section className="card"><span>{t("financeConfirmedSpent")}</span><MoneyLines totals={confirmed} language={i18n.language} empty={t("financeNoRecords")}/><small>{t("financeConfirmedHint")}</small></section>
			<section className="card"><span>{t("financeBalances")}</span><MoneyLines totals={balances} language={i18n.language} empty={t("financeNoBalance")}/><small>{t("financeBalanceHint")}</small></section>
		</div>
		<div className="finance-columns">
			<section className="card"><div className="card-header"><h2>{t("financeSubscriptions")}</h2></div>
				{subscriptions.length ? <div className="list">{subscriptions.sort((a,b) => a.dueDate.localeCompare(b.dueDate)).map((asset) => <Link className="list-row finance-subscription" key={asset.id} to="/assets/$kind/$id" params={{kind:"subscription",id:asset.id}}><span><strong>{asset.name}</strong><small>{asset.dueDate ? `${t("dueDate")}: ${date(asset.dueDate,i18n.language)} · ` : ""}{formatMinorUnits(asset.amount,asset.currency,i18n.language)}</small></span><span className="chip">{t(asset.status)}</span></Link>)}</div> : <p>{t("financeNoSubscriptions")}</p>}
			</section>
			<section className="card"><div className="card-header"><h2>{t("financeRecentRecords")}</h2></div>
				<div className="finance-filters"><label>{t("financeFilterType")}<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as LedgerAction | "all")}><option value="all">{t("all")}</option>{(["expense","topup","refund","balance","renew"] as const).map((action) => <option key={action} value={action}>{action === "renew" ? t("financeRenewalRecorded") : t(`financeAction${action[0].toUpperCase()}${action.slice(1)}`)}</option>)}</select></label><label>{t("financeFilterAsset")}<select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}><option value="">{t("all")}</option>{[...new Set(records.map((entry) => entry.assetId))].map((id) => <option key={id} value={id}>{assetsById.get(id)?.name ?? t("financeMissingAsset")}</option>)}</select></label><label>{t("financeFilterSource")}<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">{t("all")}</option>{hasEmptySource && <option value="empty">{t("financeNoSource")}</option>}{sources.map((source) => <option key={source} value={`source:${source}`}>{source}</option>)}</select></label></div>
				{filtered.length ? <div className="list">{filtered.map((entry) => <div className="list-row finance-entry" key={entry.id}><div><strong>{entry.title || assetsById.get(entry.assetId)?.name || historyLabel(entry)}</strong><small>{historyLabel(entry)} · {assetsById.get(entry.assetId)?.name ?? t("financeMissingAsset")} · {date(entry.eventDate || entry.billDate || entry.createdAt.slice(0,10), i18n.language)} · {entry.source?.trim() || t("financeNoSource")}{entry.note ? ` · ${entry.note}` : ""}</small></div>{entry.amount !== undefined && entry.currency && <b>{formatMinorUnits(entry.amount,entry.currency,i18n.language)}</b>}</div>)}</div> : <p>{t("financeNoRecords")}</p>}
			</section>
		</div>
		{recordOpen && <Dialog title={t("financeAddRecord")} onClose={closeRecord}>
			{targets.length ? <form className="finance-form" onSubmit={(event) => void saveRecord(event)}>
				<div className="field"><label htmlFor="finance-action">{t("financeRecordType")}</label><select id="finance-action" value={draft.action} disabled={busy} onChange={(event) => { setDraft({...draft,action:event.target.value as ManualAction});setError(""); }}>{financeActions.map((action) => <option key={action} value={action}>{t(`financeAction${action[0].toUpperCase()}${action.slice(1)}`)}</option>)}</select></div>
				<div className="field"><label htmlFor="finance-asset">{t("financeRelatedAsset")}</label><select id="finance-asset" value={draft.assetId} disabled={busy} onChange={(event) => { const asset=targets.find((item)=>item.id===event.target.value);setDraft({...draft,assetId:event.target.value,currency:asset?.currency??draft.currency});setError(""); }}>{targets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {t(asset.kind)}</option>)}</select></div>
				<div className="field"><label htmlFor="finance-title">{t("financeRecordTitle")}</label><input id="finance-title" value={draft.title} disabled={busy} onChange={(event) => {setDraft({...draft,title:event.target.value});setError("");}} /></div>
				<div className="finance-form-pair"><div className="field"><label htmlFor="finance-amount">{t("financeAmount")}</label><input id="finance-amount" inputMode="decimal" value={draft.amount} disabled={busy} onChange={(event)=>{setDraft({...draft,amount:event.target.value});setError("");}} /></div><div className="field"><label htmlFor="finance-currency">{t("currency")}</label><select id="finance-currency" value={draft.currency} disabled={busy} onChange={(event)=>{setDraft({...draft,currency:event.target.value as typeof currencies[number]});setError("");}}>{currencies.map((currency)=><option key={currency} value={currency}>{currency}</option>)}</select></div></div>
				<div className="field"><label htmlFor="finance-date">{t("financeDate")}</label><input id="finance-date" type="date" value={draft.eventDate} disabled={busy} onChange={(event)=>{setDraft({...draft,eventDate:event.target.value});setError("");}} /></div>
				<div className="field"><label htmlFor="finance-source">{t("financeSource")}</label><input id="finance-source" value={draft.source} disabled={busy} onChange={(event)=>{setDraft({...draft,source:event.target.value});setError("");}} /></div>
				<div className="field"><label htmlFor="finance-note">{t("financeNote")}</label><textarea id="finance-note" rows={2} value={draft.note} disabled={busy} onChange={(event)=>setDraft({...draft,note:event.target.value})}/></div>
				{error && <p role="alert" className="field-error">{error}</p>}
				<div className="actions"><Button variant="primary" type="submit" disabled={busy}>{busy?t("loading"):t("financeSaveRecord")}</Button><Button type="button" disabled={busy} onClick={closeRecord}>{t("cancel")}</Button></div>
			</form> : <div className="finance-no-target"><p>{t("financeNoTarget")}</p><div className="actions"><Button asChild><Link to="/assets/$kind" params={{kind:"subscription"}}>{t("financeGoSubscriptions")}</Link></Button><Button asChild><Link to="/assets/$kind" params={{kind:"account"}}>{t("financeGoAccounts")}</Link></Button></div></div>}
		</Dialog>}
	</main>;
}
