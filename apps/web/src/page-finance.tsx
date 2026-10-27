import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { lazy, Suspense, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
	effectiveFinanceEntry, financeActions, formatMinorUnits, historyAssetIds, historySchema, inputFromMinorUnits, monthlyMinorUnits,
	parseMinorUnits, type Asset, type History,
} from "../../../packages/domain/src";
import { createFinanceEntry, saveFinanceEntryIfCurrent } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { FinanceEntryFields, type FinanceEntryDraft } from "./components/FinanceEntryFields";
import { Dialog } from "./components/ui/dialog";
import { date, liveAssets, PageTitle, useAppContext } from "./view-shared";
import "./finance.css";
import { useSearchRowLocation } from "./search-location";
import { Select, SelectOption } from "./components/ui/select";

type ManualAction = typeof financeActions[number];
type LedgerAction = ManualAction | "renew";
type EntryDraft = FinanceEntryDraft & { action: LedgerAction };
const ledgerActions = new Set<string>([...financeActions, "renew"]);
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`; };
const AssetEditor = lazy(() => import("./workflows").then((module) => ({ default: module.AssetEditor })));

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
	const targets = liveAssets(data).filter((asset) => asset.kind !== "vault");
	const subscriptions = targets.filter((asset) => asset.kind === "subscription");
	const assetsById = new Map(data.assets.map((asset) => [asset.id, asset]));
	const liveById = new Map(liveAssets(data).map((asset) => [asset.id, asset]));
	const records = data.history.map(effectiveFinanceEntry).filter((entry) => {
		if (entry.deleted || !ledgerActions.has(entry.action)) return false;
		return historyAssetIds(entry).some(id => assetsById.get(id)?.kind !== "vault");
	});
	const [recordOpen, setRecordOpen] = useState(false);
	const [editingRecord, setEditingRecord] = useState<History | null>(null);
	const [deletingRecord, setDeletingRecord] = useState<History | null>(null);
	const recordId = useRef("");
	const [editSubscription, setEditSubscription] = useState<Asset | "new" | null>(null);
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
	const balances = groupedMoney([...latestBalances.values()].flatMap((entry) =>
		entry.currency && entry.amount !== undefined ? [{ currency: entry.currency, amount: entry.amount }] : []));
	const sources = [...new Set(records.map((entry) => entry.source?.trim()).filter((source): source is string => !!source))].sort((a, b) => a.localeCompare(b));
	const hasEmptySource = records.some((entry) => !entry.source?.trim());
	const filtered = records.filter((entry) => (typeFilter === "all" || entry.action === typeFilter) && (!assetFilter || historyAssetIds(entry).includes(assetFilter))
		&& (sourceFilter === "all" || (sourceFilter === "empty" ? !entry.source?.trim() : entry.source?.trim() === sourceFilter.slice(7))))
		.sort((a, b) => (b.eventDate || b.billDate || b.createdAt).localeCompare(a.eventDate || a.billDate || a.createdAt) || b.createdAt.localeCompare(a.createdAt));
	useSearchRowLocation("finance-entry-", records.map((entry) => entry.id), filtered.map((entry) => entry.id), () => {
		setTypeFilter("all"); setAssetFilter(""); setSourceFilter("all");
	});
	function relatedAssets(subscriptionId: string) {
		return Array.from(new Map(data.relations.filter((relation) => !relation.deleted && (relation.from === subscriptionId || relation.to === subscriptionId))
			.map((relation) => liveById.get(relation.from === subscriptionId ? relation.to : relation.from))
			.filter((asset): asset is Asset => !!asset && (asset.kind === "project" || asset.kind === "account"))
			.map((asset) => [asset.id, asset])).values());
	}
	function latestRecordedSource(subscriptionId: string) {
		return records.filter((entry) => historyAssetIds(entry).includes(subscriptionId) && (entry.action === "expense" || entry.action === "renew") && entry.source?.trim())
			.sort((a, b) => (b.eventDate || b.billDate || b.createdAt).localeCompare(a.eventDate || a.billDate || a.createdAt) || b.createdAt.localeCompare(a.createdAt))[0]?.source?.trim();
	}
	function openRecord(entry?: History) {
		const target = targets[0];
		const original = entry ? data.history.find(value => value.id === entry.id) ?? null : null;
		setEditingRecord(original);
		recordId.current = original?.id ?? crypto.randomUUID();
		setDraft(entry ? { action: entry.action as LedgerAction, assetId: historyAssetIds(entry)[0], assetIds: historyAssetIds(entry),
			title: entry.title || historyLabel(entry), amount: inputFromMinorUnits(entry.amount ?? 0, entry.currency ?? "CNY"), currency: entry.currency ?? "CNY",
			eventDate: entry.eventDate || entry.billDate || entry.createdAt.slice(0,10), source: entry.source ?? "", note: entry.note }
			: { action: "expense", assetId: target?.id ?? "", assetIds: target ? [target.id] : [], title: "", amount: "", currency: target?.currency ?? "CNY", eventDate: today(), source: "", note: "" });
		setError("");
		setRecordOpen(true);
	}
	function closeRecord() { if (!inFlight.current) setRecordOpen(false); }
	async function saveRecord(event: FormEvent) {
		event.preventDefault();
		if (inFlight.current || !targets.length) return;
		const amount = parseMinorUnits(draft.amount, draft.currency);
		if (!draft.amount.trim() || !Number.isSafeInteger(amount) || amount < 0 || (draft.action !== "balance" && draft.action !== "renew" && amount === 0)) { setError(t("financeInvalidAmount")); return; }
		const assetIds = [...new Set([draft.assetId,...(draft.assetIds ?? [])])];
		const candidate = historySchema.safeParse(editingRecord?.action === "renew" ? {
			...editingRecord, financeCorrection: { title: draft.title.trim(), amount, currency: draft.currency,
				eventDate: draft.eventDate, source: draft.source.trim(), note: draft.note, assetIds, hidden: false },
		} : {
			...(editingRecord ?? {}), id: recordId.current, assetId: draft.assetId, assetIds, action: draft.action,
			title: draft.title.trim(), amount, currency: draft.currency,
			eventDate: draft.eventDate, source: draft.source.trim(), note: draft.note,
			createdAt: editingRecord?.createdAt ?? new Date().toISOString(), deleted: false,
		});
		if (!candidate.success || !draft.title.trim()) { setError(t("financeInvalidRecord")); return; }
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			if (editingRecord) await saveFinanceEntryIfCurrent(editingRecord, candidate.data);
			else await createFinanceEntry(candidate.data);
			setRecordOpen(false);
			notify(t("financeRecordSaved"));
		} catch (error) { setError(t(error instanceof Error && error.message === "history-stale" ? "financeRecordChanged" : error instanceof Error && error.message === "finance-target-changed" ? "financeTargetChanged" : "error")); }
		finally { inFlight.current = false; setBusy(false); }
	}
	async function deleteRecord() {
		if (!deletingRecord || inFlight.current) return;
		inFlight.current = true; setBusy(true); setError("");
		try {
			const effective = effectiveFinanceEntry(deletingRecord);
			await saveFinanceEntryIfCurrent(deletingRecord, deletingRecord.action === "renew" ? {
				...deletingRecord, financeCorrection: { title: effective.title, source: effective.source, note: effective.note,
					eventDate: effective.eventDate || effective.billDate || effective.createdAt.slice(0,10), amount: effective.amount ?? 0,
					currency: effective.currency ?? "CNY", assetIds: historyAssetIds(effective), hidden: true },
			} : { ...deletingRecord, deleted: true });
			setDeletingRecord(null); notify(t("financeRecordDeleted"));
		} catch (error) { setError(t(error instanceof Error && error.message === "history-stale" ? "financeRecordChanged" : "error")); }
		finally { inFlight.current = false; setBusy(false); }
	}
	const historyLabel = (entry: History) => entry.action === "renew" ? t("financeRenewalRecorded") : t(`financeAction${entry.action[0].toUpperCase()}${entry.action.slice(1)}`);
	return <main className="page finance-page">
		<PageTitle eyebrow={t("financeEyebrow")} title={t("financeTitle")} subtitle={t("financeSubtitle")}
			action={<Button variant="primary" onClick={() => openRecord()}><Plus size={16}/>{t("financeAddRecord")}</Button>} />
		<div className="finance-summary">
			<section className="card"><span>{t("financeMonthlyPlan")}</span><MoneyLines totals={planned} language={i18n.language} empty={t("financeNoPlan")}/><small>{t("financePlanHint")}</small></section>
			<section className="card"><span>{t("financeConfirmedSpent")}</span><MoneyLines totals={confirmed} language={i18n.language} empty={t("financeNoRecords")}/><small>{t("financeConfirmedHint")}</small></section>
			<section className="card"><span>{t("financeBalances")}</span><MoneyLines totals={balances} language={i18n.language} empty={t("financeNoBalance")}/><small>{t("financeBalanceHint")}</small></section>
		</div>
		<section className="card finance-linked-card" aria-labelledby="finance-linked-heading">
			<div className="card-header finance-linked-head"><div><h2 id="finance-linked-heading">{t("financeLinkedAssets")}</h2><p>{t("financeSubscriptions")}</p></div><Button onClick={() => setEditSubscription("new")}><Plus size={16}/>{t("financeGoSubscriptions")}</Button></div>
			{subscriptions.length ? <div className="finance-linked-list">{[...subscriptions].sort((a,b) => a.dueDate.localeCompare(b.dueDate)).map((asset) => {
				const related = relatedAssets(asset.id);
				const source = latestRecordedSource(asset.id);
				return <article className="finance-linked-row" key={asset.id}>
					<div className="finance-linked-top"><Link className="finance-subscription" to="/assets/$kind/$id" params={{kind:"subscription",id:asset.id}}><strong>{asset.name}</strong></Link><strong>{formatMinorUnits(asset.amount,asset.currency,i18n.language)} / {asset.interval} {t(asset.cycle)}</strong><Button size="small" onClick={() => setEditSubscription(asset)}>{t("edit")}</Button></div>
					<div className="finance-linked-tags">{related.length ? related.map((neighbor) => <Link key={neighbor.id} to="/assets/$kind/$id" params={{kind:neighbor.kind,id:neighbor.id}}>{neighbor.name} ↗</Link>) : <span>{t("financeNoLinkedAssets")}</span>}</div>
					<small>{asset.dueDate ? `${t("dueDate")}: ${date(asset.dueDate,i18n.language)} · ` : ""}{t(asset.status)} · {t("subscriptionPaymentMethod")}: {asset.subscriptionPaymentMethod || t("accountNotRecorded")} · {t("financeLatestSource")}: {source || t("financeNoSource")}</small>
				</article>;
			})}</div> : <p>{t("financeNoSubscriptions")}</p>}
		</section>
		<div className="finance-columns">
			<section className="card"><div className="card-header"><h2>{t("financeRecentRecords")}</h2></div>
				<div className="finance-filters"><label htmlFor="finance-filter-type" className="field">{t("financeFilterType")}<Select id="finance-filter-type" value={typeFilter} onValueChange={(selectValue) => setTypeFilter(selectValue as LedgerAction | "all")}><SelectOption value="all">{t("all")}</SelectOption>{(["expense","topup","refund","balance","renew"] as const).map((action) => <SelectOption key={action} value={action}>{action === "renew" ? t("financeRenewalRecorded") : t(`financeAction${action[0].toUpperCase()}${action.slice(1)}`)}</SelectOption>)}</Select></label><label htmlFor="finance-filter-asset" className="field">{t("financeFilterAsset")}<Select id="finance-filter-asset" value={assetFilter} onValueChange={(selectValue) => setAssetFilter(selectValue)}><SelectOption value="">{t("all")}</SelectOption>{[...new Set(records.flatMap(historyAssetIds))].map((id) => <SelectOption key={id} value={id}>{assetsById.get(id)?.name ?? t("financeMissingAsset")}</SelectOption>)}</Select></label><label htmlFor="finance-filter-source" className="field">{t("financeFilterSource")}<Select id="finance-filter-source" value={sourceFilter} onValueChange={(selectValue) => setSourceFilter(selectValue)}><SelectOption value="all">{t("all")}</SelectOption>{hasEmptySource && <SelectOption value="empty">{t("financeNoSource")}</SelectOption>}{sources.map((source) => <SelectOption key={source} value={`source:${source}`}>{source}</SelectOption>)}</Select></label></div>
				{filtered.length ? <div className="list">{filtered.map((entry) => <div className="list-row finance-entry" key={entry.id} id={`finance-entry-${entry.id}`} tabIndex={-1}>
					<div className="finance-entry-content"><strong>{entry.title || assetsById.get(entry.assetId)?.name || historyLabel(entry)}</strong><small>{historyLabel(entry)} · {historyAssetIds(entry).map(id => assetsById.get(id)?.name ?? t("financeMissingAsset")).join(" · ")} · {date(entry.eventDate || entry.billDate || entry.createdAt.slice(0,10), i18n.language)} · {entry.source?.trim() || t("financeNoSource")}{entry.note ? ` · ${entry.note}` : ""}</small></div>
					{entry.amount !== undefined && entry.currency && <b>{formatMinorUnits(entry.amount,entry.currency,i18n.language)}</b>}
					<div className="finance-entry-actions"><Button size="small" onClick={() => openRecord(entry)}>{t("edit")}</Button><Button size="small" onClick={() => { setDeletingRecord(data.history.find(value => value.id === entry.id) ?? null); setError(""); }}>{t("financeDeleteAction")}</Button></div>
				</div>)}</div> : <p>{t("financeNoRecords")}</p>}
			</section>
		</div>
		{editSubscription && <Suspense fallback={<div className="toast" role="status">{t("loading")}</div>}><AssetEditor kind="subscription" asset={editSubscription === "new" ? undefined : editSubscription} categories={data.categories} onClose={() => setEditSubscription(null)} /></Suspense>}
		{recordOpen && <Dialog title={t(editingRecord ? "financeEditRecord" : "financeAddRecord")} onClose={closeRecord} closeDisabled={busy}>
			{targets.length ? <form className="finance-form" onSubmit={(event) => void saveRecord(event)}>
				<div className="field"><label htmlFor="finance-action">{t("financeRecordType")}</label><Select id="finance-action" value={draft.action} disabled={busy || !!editingRecord} onValueChange={(selectValue) => { setDraft({...draft,action:selectValue as ManualAction});setError(""); }}>{editingRecord?.action === "renew" && <SelectOption value="renew">{t("financeRenewalRecorded")}</SelectOption>}{financeActions.map((action) => <SelectOption key={action} value={action}>{t(`financeAction${action[0].toUpperCase()}${action.slice(1)}`)}</SelectOption>)}</Select></div>
				{editingRecord?.action === "renew" && <p className="finance-renewal-hint">{t("financeRenewalCorrectionHint")}</p>}
				<FinanceEntryFields draft={draft} targets={targets} disabled={busy} idPrefix="finance" allowMultiple preserveCurrency={!!editingRecord} onChange={(change) => { setDraft({ ...draft, ...change }); setError(""); }} />
				{error && <p role="alert" className="field-error">{error}</p>}
				<div className="actions"><Button variant="primary" type="submit" disabled={busy}>{busy?t("loading"):t("financeSaveRecord")}</Button><Button type="button" disabled={busy} onClick={closeRecord}>{t("cancel")}</Button></div>
			</form> : <div className="finance-no-target"><p>{t("financeNoTarget")}</p><div className="actions"><Button asChild><Link to="/assets/$kind" params={{kind:"subscription"}}>{t("financeGoSubscriptions")}</Link></Button><Button asChild><Link to="/assets/$kind" params={{kind:"account"}}>{t("financeGoAccounts")}</Link></Button></div></div>}
		</Dialog>}
		{deletingRecord && <Dialog title={t("financeDeleteRecord")} closeDisabled={busy} onClose={() => { if (!inFlight.current) setDeletingRecord(null); }}>
			<p>{t("financeDeletePrompt")}</p><strong>{effectiveFinanceEntry(deletingRecord).title || historyLabel(deletingRecord)}</strong>
			{deletingRecord.action === "renew" && <p>{t("financeRenewalCorrectionHint")}</p>}
			{error && <p role="alert" className="field-error">{error}</p>}
			<div className="actions"><Button variant="danger" disabled={busy} onClick={() => void deleteRecord()}>{busy ? t("loading") : t("financeDeleteAction")}</Button><Button disabled={busy} onClick={() => setDeletingRecord(null)}>{t("cancel")}</Button></div>
		</Dialog>}
	</main>;
}
