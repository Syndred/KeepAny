import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, duplicates, formatMinorUnits, historySchema, parseMinorUnits, type Asset } from "../../../packages/domain/src";
import { allRecords, localRepository, saveBatch } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { FinanceEntryFields, type FinanceEntryDraft } from "./components/FinanceEntryFields";
import { date, liveAssets, useAppContext } from "./view-shared";
import "./finance.css";
import {
	decideReviewedCandidate, editReviewedCandidate, getReviewedCandidate,
	listReviewedCandidates, editReviewedExpenseDraft, setReviewedCandidateMode, type ReviewedCandidate,
} from "./intake-review-store";
import "./intake-review.css";
import { useSearchRowLocation } from "./search-location";

const importKinds = ["project", "account", "subscription", "item"] as const;

function withReviewLock<T>(id: string, action: () => Promise<T>): Promise<T> {
	return navigator.locks
		? navigator.locks.request(`keepany-intake-review:${id}`, action)
		: action();
}

export function IntakeReview() {
	const { t, i18n } = useTranslation();
	const { data, notify } = useAppContext();
	const targets = liveAssets(data).filter((asset) => asset.kind === "subscription" || asset.kind === "account");
	const [rows, setRows] = useState<ReviewedCandidate[]>([]);
	const [message, setMessage] = useState("");
	const [messageId, setMessageId] = useState("");
	const [workingId, setWorkingId] = useState("");
	const [savingIds, setSavingIds] = useState(new Set<string>());
	const [expenseRecoveryPending, setExpenseRecoveryPending] = useState(false);
	const [expenseRecoveryBusy, setExpenseRecoveryBusy] = useState(false);
	const [expenseIntents, setExpenseIntents] = useState<Array<{ candidateId: string; historyId: string; committed: boolean }>>([]);
	const [migrationPending, setMigrationPending] = useState(false);
	const [migrationBusy, setMigrationBusy] = useState(false);
	const migrationInFlight = useRef(false);
	const expenseRecoveryInFlight = useRef(false);
	const inFlight = useRef(new Set<string>());
	const drafts = useRef(new Map<string, ReviewedCandidate>());
	const pendingSaves = useRef(new Map<string, Promise<void>>());
	const savingIdsRef = useRef(savingIds);
	savingIdsRef.current = savingIds;
	useSearchRowLocation("intake-review-", rows.map((row) => row.id), rows.map((row) => row.id), undefined, (id) => {
		let active = true;
		const pendingAtRead = pendingSaves.current.get(id);
		void getReviewedCandidate(id).then((latest) => {
			if (!active || !latest || inFlight.current.has(id) || savingIdsRef.current.has(id)
				|| pendingAtRead !== pendingSaves.current.get(id)) return;
			drafts.current.delete(id);
			setRows((current) => current.some((row) => row.id === id)
				? current.map((row) => row.id === id ? latest : row)
				: [...current, latest]);
		}).catch(() => { if (active) setMessage(t("error")); });
		return () => { active = false; };
	});
	const refresh = async () => {
		const repository = await localRepository();
		const [items, pending] = await Promise.all([listReviewedCandidates(), repository.pendingReviewedExpenseConfirmations()]);
		setRows(items);
		setExpenseIntents(pending);
		setExpenseRecoveryPending(pending.length > 0 || !!repository.intakeExpenseRecoveryError);
	};
	const flushEdits = async () => Promise.all([...pendingSaves.current.values()]);
	useEffect(() => {
		let active = true;
		void (async () => {
			const repository = await localRepository();
			const [items, pending] = await Promise.all([listReviewedCandidates(), repository.pendingReviewedExpenseConfirmations()]);
			if (active) {
				setRows(items);
				setMigrationPending(!!repository.intakeReviewMigrationError);
				setExpenseIntents(pending);
				setExpenseRecoveryPending(pending.length > 0 || !!repository.intakeExpenseRecoveryError);
			}
		})().catch(() => { if (active) setMessage(t("error")); });
		return () => { active = false; };
	}, [t]);
	async function retryMigration() {
		if (migrationInFlight.current) return;
		migrationInFlight.current = true;
		setMigrationBusy(true);
		try {
			await (await localRepository()).retryIntakeReviewMigration();
			await refresh();
			setMigrationPending(false);
			setMessage("");
		} catch { setMigrationPending(true); }
		finally { migrationInFlight.current = false; setMigrationBusy(false); }
	}
	async function retryExpenses() {
		if (expenseRecoveryInFlight.current) return;
		expenseRecoveryInFlight.current = true;
		setExpenseRecoveryBusy(true);
		try {
			await (await localRepository()).retryReviewedExpenseConfirmations();
			await refresh();
			setMessage("");
		} catch { setExpenseRecoveryPending(true); }
		finally { expenseRecoveryInFlight.current = false; setExpenseRecoveryBusy(false); }
	}

	async function cancelExpense(id: string) {
		if (inFlight.current.has(id)) return;
		inFlight.current.add(id); setWorkingId(id); setMessage(""); setMessageId(id);
		try {
			const result = await (await localRepository()).cancelReviewedExpenseConfirmation(id);
			await refresh();
			notify(t(result === "completed" ? "financeRecordSaved" : "reviewExpenseCancelled"));
		} catch { setMessage(t("error")); await refresh().catch(() => undefined); }
		finally { inFlight.current.delete(id); setWorkingId(""); }
	}

	function queueEdit(id: string, nextRow: ReviewedCandidate, action: () => Promise<boolean>) {
		drafts.current.set(id, nextRow);
		setSavingIds((current) => new Set(current).add(id));
		setRows((current) => current.map((item) => item.id === id ? nextRow : item));
		if (messageId === id) setMessage("");
		const previous = pendingSaves.current.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(() => withReviewLock(id, async () => {
			if (await action()) return;
			const latest = await getReviewedCandidate(id);
			if (latest) {
				drafts.current.delete(id);
				setRows((current) => current.map((item) => item.id === id ? latest : item));
			}
		}));
		pendingSaves.current.set(id, next);
		void next.catch(() => { setMessageId(id); setMessage(t("error")); }).finally(() => {
			if (pendingSaves.current.get(id) === next) setSavingIds((current) => { const updated = new Set(current); updated.delete(id); return updated; });
		});
	}

	function editableRow(id: string) {
		if (inFlight.current.has(id)) return;
		const row = drafts.current.get(id) ?? rows.find((item) => item.id === id);
		return row?.status === "pending" ? row : undefined;
	}

	function edit(id: string, field: "name" | "url" | "description", value: string) {
		const row = editableRow(id);
		if (!row) return;
		const asset = { ...row.asset, [field]: value };
		queueEdit(id, { ...row, asset }, () => editReviewedCandidate(id, asset));
	}

	function selectType(id: string, value: string) {
		const row = editableRow(id);
		if (!row) return;
		if (value === "expense" && row.source === "pdf") {
			const expenseDraft = row.expenseDraft ?? { assetId: "", title: row.asset.name, amount: "", currency: "CNY" as const, eventDate: "", source: row.fileName, note: "" };
			queueEdit(id, { ...row, reviewMode: "expense", expenseDraft }, () => setReviewedCandidateMode(id, "expense", expenseDraft));
		} else {
			const asset = { ...row.asset, kind: value as Asset["kind"] };
			queueEdit(id, { ...row, ...(row.source === "pdf" ? { reviewMode: "asset" as const } : {}), asset, kindSelected: true }, async () => {
				if (row.source === "pdf" && !(await setReviewedCandidateMode(id, "asset"))) return false;
				return editReviewedCandidate(id, asset, true);
			});
		}
	}

	function editExpense(id: string, change: Partial<FinanceEntryDraft>) {
		const row = editableRow(id);
		if (!row?.expenseDraft) return;
		const expenseDraft = { ...row.expenseDraft, ...change };
		queueEdit(id, { ...row, expenseDraft }, () => editReviewedExpenseDraft(id, expenseDraft));
	}

	async function decide(id: string, decision: "accepted" | "ignored") {
		if (inFlight.current.has(id)) return;
		inFlight.current.add(id);
		setWorkingId(id);
		setMessage("");
		setMessageId(id);
		const commit = async () => {
			const row = await getReviewedCandidate(id);
			if (row?.status !== "pending") { await refresh(); return; }
			if (decision === "ignored") {
				await decideReviewedCandidate(id, "ignored");
				await refresh();
				return;
			}
			if (row.reviewMode === "expense") {
				const draft = row.expenseDraft;
				const amount = draft ? parseMinorUnits(draft.amount, draft.currency) : Number.NaN;
				if (!draft?.amount.trim() || !Number.isSafeInteger(amount) || amount <= 0) { setMessage(t("financeInvalidAmount")); return; }
				if (!historySchema.safeParse({ ...draft, id: `pdf-expense-${row.fileHash}`, action: "expense", amount, createdAt: new Date().toISOString(), deleted: false }).success) { setMessage(t("financeInvalidRecord")); return; }
				await (await localRepository()).confirmReviewedExpense(row);
				await refresh();
				return;
			}
			if (row.source === "pdf" && !row.kindSelected) { setMessage(t("reviewSelectKind")); return; }
			const candidate = assetSchema.safeParse({ ...row.asset, name: row.asset.name.trim(), updatedAt: new Date().toISOString() });
			if (!candidate.success) { setMessage(t("reviewInvalidCandidate")); return; }
			const repository = await localRepository();
			const alreadySaved = await repository.get<Asset>("asset", candidate.data.id);
			if (!alreadySaved) {
				const existing = (await allRecords()).filter((item) => item.type === "asset").map((item) => JSON.parse(item.payload) as Asset);
				if (duplicates(candidate.data, existing).length) { setMessage(t("duplicate")); return; }
				try { await saveBatch([{ type: "asset", value: candidate.data }]); }
				catch (error) {
					if (!(error instanceof Error && error.message === "batch-existing") ||
						!(await repository.get<Asset>("asset", candidate.data.id))) throw error;
				}
			}
			await decideReviewedCandidate(id, "accepted");
			await refresh();
		};
		try {
			await flushEdits();
			await withReviewLock(id, commit);
		} catch (error) {
			const code = error instanceof Error ? error.message : "";
			setMessage(t(code === "review-expense-target" ? "financeTargetChanged" : code === "review-expense-invalid" ? "financeInvalidRecord" : code === "review-expense-stale" ? "reviewChanged" : code === "review-expense-pending" ? "reviewExpensePending" : "error"));
			setExpenseRecoveryPending(!!(await localRepository()).intakeExpenseRecoveryError);
			await refresh().catch(() => undefined);
		}
		finally { inFlight.current.delete(id); setWorkingId(""); }
	}

	return <div className="intake-review">
		<p>{t("reviewIntro")}</p>
		<p className="muted">{t("reviewPdfHint")}</p>
		{migrationPending && <div role="alert" className="notice">
			<p>{t("reviewMigrationPending")}</p>
			<Button disabled={migrationBusy} onClick={() => void retryMigration()}>{t("reviewRetryMigration")}</Button>
		</div>}
		{expenseRecoveryPending && <div role="alert" className="notice"><p>{t("reviewExpenseRecoveryHint")}</p><Button disabled={expenseRecoveryBusy} onClick={() => void retryExpenses()}>{t("reviewExpenseRetry")}</Button></div>}
		{message && !messageId && <p role="status" className="intake-review-message">{message}</p>}
		{rows.length > 0 && <div className="intake-review-list">
			<h3>{t("reviewCandidates")}</h3>
			{rows.map((row) => {
				const intent = expenseIntents.find((entry) => entry.candidateId === row.id);
				const disabled = workingId === row.id || !!intent;
				return <div className="intake-review-row" key={row.id} id={`intake-review-${row.id}`} tabIndex={-1}>
				<div className="intake-review-source"><strong>{row.fileName}</strong><small>{row.source === "pdf" ? t("reviewPdfDocument") : t("reviewRowNumber", { number: row.rowNumber })}</small>
					<span className={`chip ${row.status === "pending" ? "warn" : ""}`}>{t(`reviewStatus${row.status[0].toUpperCase()}${row.status.slice(1)}`)}</span></div>
				{row.sourceText && <details><summary>{t("reviewPdfOriginal")}</summary><pre className="intake-pdf-text">{row.sourceText}</pre></details>}
				{row.status === "accepted" && row.reviewMode === "expense" && row.expenseDraft && <div className="intake-expense-receipt">
					<strong>{row.expenseDraft.title}</strong>
					<span>{formatMinorUnits(parseMinorUnits(row.expenseDraft.amount, row.expenseDraft.currency), row.expenseDraft.currency, i18n.language)} · {date(row.expenseDraft.eventDate, i18n.language)}</span>
					<small>{data.assets.find((asset) => asset.id === row.expenseDraft?.assetId)?.name ?? t("financeMissingAsset")} · {row.expenseDraft.source}</small>
					<Link to="/finance">{t("reviewViewFinance")}</Link>
				</div>}
				{row.status === "pending" && <>
					<div className="field"><label htmlFor={`${row.id}-kind`}>{t("intakeRecordType")}</label><select id={`${row.id}-kind`} value={row.reviewMode === "expense" ? "expense" : row.source === "pdf" && !row.kindSelected ? "" : row.asset.kind} disabled={disabled} onChange={(event) => selectType(row.id, event.target.value)}><option value="" disabled>{t("reviewSelectKind")}</option>{importKinds.map((kind) => <option value={kind} key={kind}>{t(kind)}</option>)}{row.source === "pdf" && <option value="expense">{t("reviewExpense")}</option>}</select></div>
					{row.reviewMode === "expense" && row.expenseDraft ? <>
						<p className="muted">{t("reviewExpenseHint")}</p>
						{!targets.length && <div className="notice"><p>{t("financeNoTarget")}</p><div className="actions"><Button asChild><Link to="/assets/$kind" params={{ kind: "subscription" }}>{t("financeGoSubscriptions")}</Link></Button><Button asChild><Link to="/assets/$kind" params={{ kind: "account" }}>{t("financeGoAccounts")}</Link></Button></div></div>}
						<FinanceEntryFields draft={row.expenseDraft} targets={targets} disabled={disabled} idPrefix={row.id} onChange={(change) => editExpense(row.id, change)} />
					</> : <>
						<div className="field"><label htmlFor={`${row.id}-name`}>{t("name")}</label><input id={`${row.id}-name`} value={row.asset.name} disabled={disabled} onChange={(event) => edit(row.id, "name", event.target.value)} /></div>
						<div className="field"><label htmlFor={`${row.id}-url`}>{t("url")}</label><input id={`${row.id}-url`} value={row.asset.url} disabled={disabled} onChange={(event) => edit(row.id, "url", event.target.value)} /></div>
						<div className="field"><label htmlFor={`${row.id}-description`}>{t("description")}</label><textarea rows={row.source === "pdf" ? 6 : 2} id={`${row.id}-description`} value={row.asset.description} disabled={disabled} onChange={(event) => edit(row.id, "description", event.target.value)} /></div>
					</>}
					{message && messageId === row.id && <p role="alert" className="field-error">{message}</p>}
					{savingIds.has(row.id) && <small role="status">{t("reviewSaving")}</small>}
					{intent ? <div className="actions"><Button variant="primary" disabled={workingId === row.id} onClick={() => void decide(row.id, "accepted")}>{t("reviewExpenseRetry")}</Button>{!intent.committed && <Button disabled={workingId === row.id} onClick={() => void cancelExpense(row.id)}>{t("reviewExpenseCancel")}</Button>}</div> : <div className="actions"><Button variant="primary" disabled={workingId === row.id || savingIds.has(row.id) || (row.reviewMode === "expense" ? !targets.length : row.source === "pdf" && !row.kindSelected)} onClick={() => void decide(row.id, "accepted")}>{t(row.reviewMode === "expense" ? "reviewConfirmExpense" : "reviewConfirm")}</Button><Button disabled={workingId === row.id || savingIds.has(row.id)} onClick={() => void decide(row.id, "ignored")}>{t("reviewIgnore")}</Button></div>}
				</>}

			</div>;
			})}
		</div>}
	</div>;
}
