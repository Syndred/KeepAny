import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, duplicates, formatMinorUnits, inputFromMinorUnits, historySchema, parseMinorUnits, type Asset } from "../../../packages/domain/src";
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
import { ensureReviewedAccountLinks, previewAccountIdentity } from "./intake-account-links";
import { useSearchRowLocation } from "./search-location";
import { Select, SelectOption } from "./components/ui/select";

class ReviewValidationError extends Error {}

const importKinds = ["project", "account", "subscription", "item"] as const;

function withReviewLock<T>(id: string, action: () => Promise<T>): Promise<T> {
	return navigator.locks
		? navigator.locks.request(`keepany-intake-review:${id}`, action)
		: action();
}

export function IntakeReview() {
	const { t, i18n } = useTranslation();
	const { data, notify } = useAppContext();
	const assetsById = useMemo(() => new Map(data.assets.map((asset) => [asset.id, asset])), [data.assets]);
	const targets = liveAssets(data).filter((asset) => asset.kind === "subscription" || asset.kind === "account");
	const [rows, setRows] = useState<ReviewedCandidate[]>([]);
	const batches = useMemo(() => {
		const grouped = new Map<string, ReviewedCandidate[]>();
		for (const row of rows) {
			const key = `${row.source ?? "csv"}:${row.fileHash}`;
			const batch = grouped.get(key);
			if (batch) batch.push(row);
			else grouped.set(key, [row]);
		}
		return [...grouped].map(([key, items]) => ({
			key, items, fileName: items[0].fileName,
			sourceText: items.find((row) => row.sourceText)?.sourceText,
			models: [...new Set(items.flatMap((row) => row.ai ? [`${row.ai.provider} · ${row.ai.model}`] : []))],
		}));
	}, [rows]);
	const [message, setMessage] = useState("");
	const [messageId, setMessageId] = useState("");
	const [workingId, setWorkingId] = useState("");
	const [selectedIds, setSelectedIds] = useState(new Set<string>());
	const [bulkBusy, setBulkBusy] = useState(false);
	const bulkInFlight = useRef(false);
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [batchMessages, setBatchMessages] = useState<Record<string, string>>(
		{},
	);
	const [intervalDrafts, setIntervalDrafts] = useState<Record<string, string>>({});
	const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
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
	const failedSaves = useRef(new Set<string>());
	const reviewRevision = useRef(0);
	const readGeneration = useRef(0);
	const savingIdsRef = useRef(savingIds);
	savingIdsRef.current = savingIds;
	useSearchRowLocation("intake-review-", rows.map((row) => row.id), rows.map((row) => row.id), undefined, (id) => {
		let active = true;
		const pendingAtRead = pendingSaves.current.get(id);
		void (async () => {
			try { await pendingAtRead; }
			catch { return; }
			if (!active) return;
			const revision = reviewRevision.current;
			const generation = readGeneration.current;
			const latest = await getReviewedCandidate(id);
			if (!active || !latest || inFlight.current.has(id) || savingIdsRef.current.has(id)
				|| pendingAtRead !== pendingSaves.current.get(id)
				|| revision !== reviewRevision.current || generation !== readGeneration.current) return;
			reviewRevision.current++;
			drafts.current.delete(id);
			setRows((current) => current.some((row) => row.id === id)
				? current.map((row) => row.id === id ? latest : row)
				: [...current, latest]);
		})().catch(() => { if (active) setMessage(t("error")); });
		return () => { active = false; };
	});
	const refresh = useCallback(async (isActive: () => boolean = () => true) => {
		const generation = ++readGeneration.current;
		const isCurrent = () => isActive() && generation === readGeneration.current;
		const repository = await localRepository();
		while (isCurrent()) {
			const revision = reviewRevision.current;
			await Promise.allSettled([...pendingSaves.current.values()]);
			if (!isCurrent()) return;
			if (revision !== reviewRevision.current) continue;
			const [items, pending] = await Promise.all([listReviewedCandidates(), repository.pendingReviewedExpenseConfirmations()]);
			if (!isCurrent()) return;
			// Another row remains editable during confirmation. A read started before
			// that edit must not replace its newer optimistic or persisted value.
			if (revision !== reviewRevision.current) continue;
			setRows(items.map((row) => {
				const draft = drafts.current.get(row.id);
				if (row.status === "pending" && failedSaves.current.has(row.id) && draft) return draft;
				drafts.current.delete(row.id);
				failedSaves.current.delete(row.id);
				return row;
			}));
			setMigrationPending(!!repository.intakeReviewMigrationError);
			setExpenseIntents(pending);
			setExpenseRecoveryPending(pending.length > 0 || !!repository.intakeExpenseRecoveryError);
			return;
		}
	}, []);
	async function mutateReview<T>(action: () => Promise<T>): Promise<T> {
		reviewRevision.current++;
		try { return await action(); }
		finally { reviewRevision.current++; }
	}
	const flushEdits = async () => Promise.all([...pendingSaves.current.values()]);
	useEffect(() => {
		let active = true;
		void refresh(() => active).catch(() => { if (active) setMessage(t("error")); });
		return () => { active = false; };
	}, [t, refresh]);
	async function retryMigration() {
		if (migrationInFlight.current) return;
		migrationInFlight.current = true;
		setMigrationBusy(true);
		try {
			await mutateReview(async () => (await localRepository()).retryIntakeReviewMigration());
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
			await mutateReview(async () => (await localRepository()).retryReviewedExpenseConfirmations());
			await refresh();
			setMessage("");
		} catch { setExpenseRecoveryPending(true); }
		finally { expenseRecoveryInFlight.current = false; setExpenseRecoveryBusy(false); }
	}

	async function cancelExpense(id: string) {
		if (inFlight.current.has(id)) return;
		inFlight.current.add(id); setWorkingId(id); setMessage(""); setMessageId(id);
		try {
			const result = await mutateReview(async () => (await localRepository()).cancelReviewedExpenseConfirmation(id));
			await refresh();
			notify(t(result === "completed" ? "financeRecordSaved" : "reviewExpenseCancelled"));
		} catch { setMessage(t("error")); await refresh().catch(() => undefined); }
		finally { inFlight.current.delete(id); setWorkingId(""); }
	}

	function queueEdit(id: string, nextRow: ReviewedCandidate, action: () => Promise<boolean>) {
		reviewRevision.current++;
		failedSaves.current.delete(id);
		drafts.current.set(id, nextRow);
		setRowErrors(current => { const next = { ...current }; delete next[id]; return next; });
		setSavingIds((current) => new Set(current).add(id));
		setRows((current) => current.map((item) => item.id === id ? nextRow : item));
		if (messageId === id) setMessage("");
		const previous = pendingSaves.current.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(() => withReviewLock(id, async () => {
			if (await action()) return;
			const latest = await getReviewedCandidate(id);
			if (latest && pendingSaves.current.get(id) === next) {
				drafts.current.delete(id);
				setRows((current) => current.map((item) => item.id === id ? latest : item));
			}
		}));
		pendingSaves.current.set(id, next);
		void next.catch(() => {
			if (pendingSaves.current.get(id) !== next) return;
			failedSaves.current.add(id);
			setMessageId(id); setMessage(t("error"));
		}).finally(() => {
			reviewRevision.current++;
			if (pendingSaves.current.get(id) === next) setSavingIds((current) => { const updated = new Set(current); updated.delete(id); return updated; });
		});
	}

	function editableRow(id: string) {
		if (bulkInFlight.current || inFlight.current.has(id)) return;
		const row = drafts.current.get(id) ?? rows.find((item) => item.id === id);
		return row?.status === "pending" ? row : undefined;
	}

	function edit(id: string, field: "name" | "url" | "username" | "description" | "category" | "dueDate" | "cycle" | "currency" | "amount" | "interval" | "tags", value: string) {
		const row = editableRow(id);
		if (!row) return;
		const asset = { ...row.asset, [field]: field === "amount" ? parseMinorUnits(value, row.asset.currency) : field === "interval" ? Number(value) : field === "tags" ? value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) : value } as Asset;
		if (field === "currency") asset.amount = parseMinorUnits(inputFromMinorUnits(row.asset.amount, row.asset.currency), value as Asset["currency"]);
		if (field === "interval" && (!Number.isInteger(asset.interval) || asset.interval < 1 || asset.interval > 100)) return;
		if (!Number.isSafeInteger(asset.amount) || asset.amount < 0) { setMessageId(id); setMessage(t("financeInvalidAmount")); return; }
		if (field === "amount" && asset.kind === "item") asset.itemPurchasePriceKnown = true;
		const ai = row.ai ? { ...row.ai, missingFields: row.ai.missingFields.filter(item => item !== field) } : undefined;
		queueEdit(id, { ...row, asset, ...(ai ? { ai } : {}) }, () => editReviewedCandidate(id, asset, undefined, field));
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

	function decisionError(error: unknown) {
		if (error instanceof ReviewValidationError) return error.message;
		const code = error instanceof Error ? error.message : "";
		return t(
			code === "review-expense-target"
				? "financeTargetChanged"
				: code === "review-expense-invalid"
					? "financeInvalidRecord"
					: code === "review-expense-stale"
						? "reviewChanged"
						: code === "review-expense-pending"
							? "reviewExpensePending"
							: "error",
		);
	}

	async function performDecision(id: string, decision: "accepted" | "ignored") {
			const row = await getReviewedCandidate(id);
			if (row?.status !== "pending") return false;
		if (decision === "ignored") {
			await decideReviewedCandidate(id, "ignored");
			return true;
			}
			if (row.reviewMode === "expense") {
				const draft = row.expenseDraft;
				const amount = draft ? parseMinorUnits(draft.amount, draft.currency) : Number.NaN;
				if (!draft?.amount.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
				throw new ReviewValidationError(t("financeInvalidAmount")); }
				if (!historySchema.safeParse({ ...draft, id: `pdf-expense-${row.fileHash}`, action: "expense", amount, createdAt: new Date().toISOString(), deleted: false }).success) {
				throw new ReviewValidationError(t("financeInvalidRecord"));
			}
			await (await localRepository()).confirmReviewedExpense(row);
			return true;
			}
			if (row.source === "ai" && row.asset.kind === "subscription" && row.ai?.missingFields.some((field) =>
				["amount", "currency", "cycle"].includes(field),
			)
		) {
			throw new ReviewValidationError(
				t("aiMissingFields", {
					fields: row.ai.missingFields
						.filter((field) => ["amount", "currency", "cycle"].includes(field))
						.map((field) => t(field))
						.join(" · "),
				}),
			);
		}
		if (row.source === "pdf" && !row.kindSelected) {
			throw new ReviewValidationError(t("reviewSelectKind")); }
			if (amountDrafts[id] !== undefined && (!amountDrafts[id].trim() || !Number.isSafeInteger(parseMinorUnits(amountDrafts[id], row.asset.currency)))) {
			throw new ReviewValidationError(t("financeInvalidAmount")); }
			if (intervalDrafts[id] !== undefined && (!intervalDrafts[id].trim() || !Number.isInteger(Number(intervalDrafts[id])) || Number(intervalDrafts[id]) < 1 || Number(intervalDrafts[id]) > 100)) {
			throw new ReviewValidationError(t("reviewInvalidCandidate")); }
			const candidate = assetSchema.safeParse({ ...row.asset, name: row.asset.name.trim(), updatedAt: new Date().toISOString() });
			if (!candidate.success) {
			throw new ReviewValidationError(t("reviewInvalidCandidate")); }
			const repository = await localRepository();
			const alreadySaved = await repository.get<Asset>("asset", candidate.data.id);
			if (!alreadySaved) {
				const existing = (await allRecords()).filter((item) => item.type === "asset").map((item) => JSON.parse(item.payload) as Asset);
				if (duplicates(candidate.data, existing).length) {
				throw new ReviewValidationError(t("duplicate")); }
				try { await saveBatch([{ type: "asset", value: candidate.data }]); }
				catch (error) {
					if (!(error instanceof Error && error.message === "batch-existing") ||
						!(await repository.get<Asset>("asset", candidate.data.id))) throw error;
				}
			}
			await decideReviewedCandidate(id, "accepted");
		const receipt = await getReviewedCandidate(id);
		const saved = await repository.get<Asset>("asset", candidate.data.id);
		if (receipt?.status !== "accepted" || !saved || saved.deleted) throw new ReviewValidationError(t("reviewChanged"));
		return true;
	}

	async function completeLinks(items: ReviewedCandidate[]) {
		return ensureReviewedAccountLinks(items, {
			labels: {
				email: t("reviewEmailLink"),
				phone: t("reviewPhoneLink"),
				provider: t("reviewProviderLink"),
			},
		});
	}

	async function decide(id: string, decision: "accepted" | "ignored") {
		if (bulkInFlight.current || inFlight.current.has(id)) return;
		inFlight.current.add(id);
		setWorkingId(id);
		setMessage("");
		setMessageId(id);
		try {
			await flushEdits();
			await mutateReview(() => withReviewLock(id, () => performDecision(id, decision)));
			if (decision === "accepted") {
				const accepted = await getReviewedCandidate(id);
				if (accepted?.status === "accepted") {
					const key = `${accepted.source ?? "csv"}:${accepted.fileHash}`;
					try {
						const result = await completeLinks([accepted]);
						if (result.unresolved.length)
							setBatchMessages((current) => ({
								...current,
								[key]: t("reviewLinksResult", {
									count: result.createdRelations,
									pending: result.unresolved.length,
								}),
							}));
					} catch {
						setBatchMessages((current) => ({
							...current,
							[key]: t("reviewLinksRetryHint"),
						}));
					}
				}
			}
			setSelectedIds((current) => {
				const next = new Set(current);
				next.delete(id);
				return next;
			});
			await refresh();
		} catch (error) {
			setMessage(decisionError(error));
			setExpenseRecoveryPending(!!(await localRepository()).intakeExpenseRecoveryError);
			await refresh().catch(() => undefined);
		}
		finally { inFlight.current.delete(id); setWorkingId(""); }
	}

	function selectRows(ids: string[], selected: boolean) {
		setSelectedIds((current) => {
			const next = new Set(current);
			for (const id of ids) {
				if (selected) next.add(id);
				else next.delete(id);
			}
			return next;
		});
	}

	async function confirmSelected(key: string, items: ReviewedCandidate[]) {
		if (bulkInFlight.current || inFlight.current.size) return;
		const ids = items
			.filter((row) => row.status === "pending" && selectedIds.has(row.id))
			.map((row) => row.id);
		if (!ids.length) return;
		bulkInFlight.current = true;
		setBulkBusy(true);
		setMessage("");
		setMessageId("");
		let confirmed = 0;
		const failed: Record<string, string> = {};
		const completed: string[] = [];
		try {
			await flushEdits();
			for (const id of ids) {
				try {
					if (await mutateReview(() => withReviewLock(id, () => performDecision(id, "accepted"))))
						confirmed++;
					completed.push(id);
				} catch (error) {
					failed[id] = decisionError(error);
				}
			}
			setRowErrors((current) => {
				const next = { ...current, ...failed };
				for (const id of completed) delete next[id];
				return next;
			});
			setSelectedIds((current) => {
				const next = new Set(current);
				for (const id of completed) next.delete(id);
				return next;
			});
			const accepted = (await listReviewedCandidates()).filter(
				(row) => completed.includes(row.id) && row.status === "accepted",
			);
			let linksMessage = "";
			try {
				const result = await completeLinks(accepted);
				linksMessage = t("reviewLinksResult", {
					count: result.createdRelations,
					pending: result.unresolved.length,
				});
			} catch {
				linksMessage = t("reviewLinksRetryHint");
			}
			setBatchMessages((current) => ({
				...current,
				[key]: `${t("reviewBulkResult", { count: confirmed, failed: Object.keys(failed).length })} ${linksMessage}`,
			}));
			await refresh();
		} catch (error) {
			setBatchMessages((current) => ({
				...current,
				[key]: decisionError(error),
			}));
		} finally {
			bulkInFlight.current = false;
			setBulkBusy(false);
		}
	}

	async function repairLinks(key: string, items: ReviewedCandidate[]) {
		if (bulkInFlight.current || inFlight.current.size) return;
		bulkInFlight.current = true;
		setBulkBusy(true);
		try {
			const result = await completeLinks(
				items.filter(
					(row) => row.status === "accepted" && row.asset.kind === "account",
				),
			);
			setBatchMessages((current) => ({
				...current,
				[key]: t("reviewLinksResult", {
					count: result.createdRelations,
					pending: result.unresolved.length,
				}),
			}));
			await refresh();
		} catch {
			setBatchMessages((current) => ({
				...current,
				[key]: t("reviewLinksRetryHint"),
			}));
		} finally {
			bulkInFlight.current = false;
			setBulkBusy(false);
		}
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
			{batches.map((batch) => {
				const pendingIds = batch.items.filter(row => row.status === "pending").map(row => row.id);
				const selectedCount = pendingIds.filter(id => selectedIds.has(id)).length;
				const busy = bulkBusy || !!workingId;
				return <section className="intake-review-batch" key={batch.key} aria-label={batch.fileName}>
				<header className="intake-review-batch-header">
					<strong>{batch.fileName}</strong>
					<small>{t("reviewBatchCount", { count: batch.items.length, pending: batch.items.filter((row) => row.status === "pending").length })}</small>
					{batch.models.length > 0 && <small className="intake-review-batch-model">{batch.models.join(" / ")}</small>}
				</header>
				<div className="intake-review-batch-actions">
					{pendingIds.length > 0 && <><label className="intake-review-select"><input type="checkbox" checked={selectedCount === pendingIds.length} ref={node => { if (node) node.indeterminate = selectedCount > 0 && selectedCount < pendingIds.length; }} aria-checked={selectedCount > 0 && selectedCount < pendingIds.length ? "mixed" : selectedCount === pendingIds.length} disabled={busy} onChange={event => selectRows(pendingIds, event.target.checked)} />{t("reviewSelectAll")}</label><Button variant="primary" disabled={busy || !selectedCount} onClick={() => void confirmSelected(batch.key, batch.items)}>{t("reviewConfirmSelected", { count: selectedCount })}</Button></>}
					{batch.items.some(row => row.status === "accepted" && row.asset.kind === "account") && <Button disabled={busy} onClick={() => void repairLinks(batch.key, batch.items)}>{t("reviewCompleteLinks")}</Button>}
				</div>
				{batchMessages[batch.key] && <p className="intake-review-message" role="status">{batchMessages[batch.key]}</p>}
				{batch.sourceText && <details className="intake-review-original"><summary>{t("reviewPdfOriginal")}</summary><pre className="intake-pdf-text">{batch.sourceText}</pre></details>}
				<div className="intake-review-batch-rows">
			{batch.items.map((row) => {
				const intent = expenseIntents.find((entry) => entry.candidateId === row.id);
				const disabled = bulkBusy || workingId === row.id || !!intent;
				const currentAsset = row.status === "accepted" ? assetsById.get(row.asset.id) : undefined;
				const savedAsset = currentAsset && !currentAsset.deleted ? currentAsset : undefined;
				const savedLinks = savedAsset?.kind === "account" ? data.relations.filter(relation => !relation.deleted && relation.from === savedAsset.id).flatMap(relation => { const target = assetsById.get(relation.to); return target && !target.deleted ? [{ relation, target }] : []; }) : [];
				return <div className="intake-review-row" key={row.id} id={`intake-review-${row.id}`} tabIndex={-1}>
				<div className="intake-review-source">{row.status === "pending" && <label className="intake-review-select" title={t("reviewSelectRecord", { name: row.asset.name })}><input type="checkbox" aria-label={t("reviewSelectRecord", { name: row.asset.name })} checked={selectedIds.has(row.id)} disabled={disabled} onChange={event => selectRows([row.id], event.target.checked)} /></label>}<strong>{row.asset.name}</strong><small>{row.source === "pdf" ? t("reviewPdfDocument") : row.source === "ai" ? t("reviewRecordNumber", { number: row.rowNumber }) : t("reviewRowNumber", { number: row.rowNumber })}</small>
					<span className={`chip ${row.status === "pending" ? "warn" : ""}`}>{t(`reviewStatus${row.status[0].toUpperCase()}${row.status.slice(1)}`)}</span></div>
				{row.ai && <>
					<details className="intake-review-evidence"><summary><span>{t("aiSourceEvidence")}</span>{row.status === "pending" && previewAccountIdentity(row.asset, row).map(identity => <small className="intake-review-identity" key={`${identity.kind}:${identity.provider}:${identity.identifier}`}>{t(identity.unknownUsername ? "reviewIdentityUnknown" : "reviewIdentityPreview", { kind: t(identity.kind === "email" ? "email" : identity.kind === "phone" ? "phone" : "reviewLoginProvider"), value: identity.identifier || identity.provider })}</small>)}</summary><p>{row.ai.evidence}</p></details>
					{(row.ai.missingFields.length > 0 || row.ai.relatedName) && <div className="intake-review-warnings">
						{row.ai.missingFields.length > 0 && <p>{t("aiMissingFields", { fields: row.ai.missingFields.map(field => t(field)).join(" · ") })}</p>}
						{row.ai.relatedName && <p>{t("aiRelatedSuggestion", { name: row.ai.relatedName })}</p>}
					</div>}
				</>}
				{row.status === "accepted" && row.reviewMode === "expense" && row.expenseDraft && <div className="intake-expense-receipt">
					<strong>{row.expenseDraft.title}</strong>
					<span>{formatMinorUnits(parseMinorUnits(row.expenseDraft.amount, row.expenseDraft.currency), row.expenseDraft.currency, i18n.language)} · {date(row.expenseDraft.eventDate, i18n.language)}</span>
					<small>{assetsById.get(row.expenseDraft.assetId)?.name ?? t("financeMissingAsset")} · {row.expenseDraft.source}</small>
					<Link to="/finance">{t("reviewViewFinance")}</Link>
				</div>}
				{row.status !== "pending" && row.reviewMode !== "expense" && <div className="intake-expense-receipt">
					<strong>{row.asset.name}</strong>
					{(row.source !== "pdf" || row.kindSelected) && <span>{t("intakeRecordType")}: {t(row.asset.kind)}</span>}
					{row.asset.url && <small>{t("url")}: {row.asset.url}</small>}
					{row.source !== "pdf" && row.asset.description && <details><summary>{t("description")}</summary><p className="intake-pdf-text">{row.asset.description}</p></details>}
					{row.status === "accepted" && savedLinks.map(({ relation, target }) => <small key={relation.id}>{relation.label}: <Link to="/assets/$kind/$id" params={{ kind: target.kind, id: target.id }}>{target.name}</Link></small>)}
					{row.status === "accepted" && savedAsset?.kind === "account" && !savedLinks.length && previewAccountIdentity(savedAsset, row).length > 0 && <small>{t("reviewLinksPending")}</small>}
					{row.status === "accepted" && (savedAsset
						? <Link to="/assets/$kind/$id" params={{ kind: savedAsset.kind, id: savedAsset.id }}>{t("reviewViewAsset")}: {savedAsset.name}</Link>
						: <small>{t("taskRelatedMissing")}</small>)}
				</div>}
				{row.status === "pending" && <>
					<div className="intake-review-fields">
					<div className="field"><label htmlFor={`${row.id}-kind`}>{t("intakeRecordType")}</label><Select id={`${row.id}-kind`} value={row.reviewMode === "expense" ? "expense" : row.source === "pdf" && !row.kindSelected ? "" : row.asset.kind} disabled={disabled} onValueChange={(selectValue) => selectType(row.id, selectValue)}><SelectOption value="" disabled>{t("reviewSelectKind")}</SelectOption>{importKinds.map((kind) => <SelectOption value={kind} key={kind}>{t(kind)}</SelectOption>)}{row.source === "pdf" && <SelectOption value="expense">{t("reviewExpense")}</SelectOption>}</Select></div>
					{row.reviewMode === "expense" && row.expenseDraft ? <>
						<p className="muted intake-review-wide">{t("reviewExpenseHint")}</p>
						{!targets.length && <div className="notice intake-review-wide"><p>{t("financeNoTarget")}</p><div className="actions"><Button asChild><Link to="/assets/$kind" params={{ kind: "subscription" }}>{t("financeGoSubscriptions")}</Link></Button><Button asChild><Link to="/assets/$kind" params={{ kind: "account" }}>{t("financeGoAccounts")}</Link></Button></div></div>}
						<FinanceEntryFields draft={row.expenseDraft} targets={targets} disabled={disabled} idPrefix={row.id} onChange={(change) => editExpense(row.id, change)} />
					</> : <>
						<div className="field"><label htmlFor={`${row.id}-name`}>{t("name")}</label><input id={`${row.id}-name`} value={row.asset.name} disabled={disabled} onChange={(event) => edit(row.id, "name", event.target.value)} /></div>
						<div className="field intake-review-url"><label htmlFor={`${row.id}-url`}>{t("url")}</label><input id={`${row.id}-url`} value={row.asset.url} disabled={disabled} onChange={(event) => edit(row.id, "url", event.target.value)} /></div>
						{row.asset.kind === "account" && <div className="field intake-review-username"><label htmlFor={`${row.id}-username`}>{t("username")}</label><input id={`${row.id}-username`} value={row.asset.username} maxLength={300} autoComplete="off" disabled={disabled} onChange={(event) => edit(row.id, "username", event.target.value)} /></div>}
						<div className="field intake-review-wide"><label htmlFor={`${row.id}-description`}>{t("description")}</label><textarea rows={row.source === "pdf" ? 6 : 2} id={`${row.id}-description`} value={row.asset.description} disabled={disabled} onChange={(event) => edit(row.id, "description", event.target.value)} /></div>
						{row.source === "ai" && <div className="form-grid">
                            <label className="field" htmlFor={`${row.id}-tags`}><span>{t("tags")}</span><input id={`${row.id}-tags`} defaultValue={row.asset.tags.join(", ")} disabled={disabled} onBlur={event => edit(row.id, "tags", event.target.value)} /></label>
							<label className="field" htmlFor={`${row.id}-category`}><span>{t("category")}</span><input id={`${row.id}-category`} value={row.asset.category} disabled={disabled} onChange={event => edit(row.id, "category", event.target.value)} /></label>
							{(row.asset.kind === "subscription" || row.asset.kind === "item") && <><label className="field" htmlFor={`${row.id}-currency`}><span>{t("currency")}</span><Select id={`${row.id}-currency`} value={row.ai?.missingFields.includes("currency") ? "" : row.asset.currency} disabled={disabled} onValueChange={value => edit(row.id, "currency", value)}><SelectOption value="" disabled>{t("aiChooseField")}</SelectOption>{["CNY", "USD", "EUR", "GBP", "JPY"].map(value => <SelectOption key={value} value={value}>{value}</SelectOption>)}</Select></label><label className="field" htmlFor={`${row.id}-amount`}><span>{t("amount")}</span><input id={`${row.id}-amount`} inputMode="decimal" value={amountDrafts[row.id] ?? (row.ai?.missingFields.includes("amount") ? "" : inputFromMinorUnits(row.asset.amount, row.asset.currency))} disabled={disabled} onChange={event => { setAmountDrafts(current => ({ ...current, [row.id]: event.target.value })); if (event.target.value.trim()) edit(row.id, "amount", event.target.value); }} /></label></>}
							{row.asset.kind === "subscription" && <><label className="field" htmlFor={`${row.id}-dueDate`}><span>{t("dueDate")}</span><input id={`${row.id}-dueDate`} type="date" value={row.asset.dueDate} disabled={disabled} onChange={event => edit(row.id, "dueDate", event.target.value)} /></label><label className="field" htmlFor={`${row.id}-cycle`}><span>{t("cycle")}</span><Select id={`${row.id}-cycle`} value={row.ai?.missingFields.includes("cycle") ? "" : row.asset.cycle} disabled={disabled} onValueChange={value => edit(row.id, "cycle", value)}><SelectOption value="" disabled>{t("aiChooseField")}</SelectOption>{["month", "year", "week", "day"].map(value => <SelectOption key={value} value={value}>{t(value)}</SelectOption>)}</Select></label><label className="field" htmlFor={`${row.id}-interval`}><span>{t("interval")}</span><input id={`${row.id}-interval`} type="number" min={1} max={100} value={intervalDrafts[row.id] ?? String(row.asset.interval)} disabled={disabled} onChange={event => { setIntervalDrafts(current => ({ ...current, [row.id]: event.target.value })); edit(row.id, "interval", event.target.value); }} /></label></>}
						</div>}
					</>}
					</div>
					{(rowErrors[row.id] || (message && messageId === row.id)) && <p role="alert" className="field-error">{rowErrors[row.id] || message}</p>}
					{savingIds.has(row.id) && <small role="status">{t("reviewSaving")}</small>}
					{intent ? <div className="actions"><Button variant="primary" disabled={bulkBusy || workingId === row.id} onClick={() => void decide(row.id, "accepted")}>{t("reviewExpenseRetry")}</Button>{!intent.committed && <Button disabled={bulkBusy || workingId === row.id} onClick={() => void cancelExpense(row.id)}>{t("reviewExpenseCancel")}</Button>}</div> : <div className="actions"><Button variant="primary" disabled={bulkBusy || workingId === row.id || savingIds.has(row.id) || (row.reviewMode === "expense" ? !targets.length : row.source === "pdf" && !row.kindSelected)} onClick={() => void decide(row.id, "accepted")}>{t(row.reviewMode === "expense" ? "reviewConfirmExpense" : "reviewConfirm")}</Button><Button disabled={bulkBusy || workingId === row.id || savingIds.has(row.id)} onClick={() => void decide(row.id, "ignored")}>{t("reviewIgnore")}</Button></div>}
				</>}

			</div>;
			})}
				</div>
			</section>; })}
		</div>}
	</div>;
}
