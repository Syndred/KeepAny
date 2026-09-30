import { liveQuery } from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	abandonRestoreRecovery,
	getPendingRestoreRecoveries,
	localRepository,
	retryRestoreRecovery,
	type PendingRestoreRecovery,
} from "../../../../packages/local-db/src";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import "../restore-recovery.css";

function recoveryKey(recovery: PendingRestoreRecovery): string {
	return `${recovery.token.journalId}:${recovery.token.planHash}:${recovery.token.datasetProof}`;
}

function reasonCopyKey(recovery: PendingRestoreRecovery):
	"restoreRecoveryReasonSourceAmbiguous" | "restoreRecoveryReasonSourceBound" | "restoreRecoveryReasonInvalid" |
	"restoreRecoveryReasonRetryOnly" | "restoreRecoveryReasonAbandonOnly" | "restoreRecoveryReasonUnavailable" |
	"restoreRecoveryReasonUnknown" | "restoreRecoveryReason" {
	const reason = recovery.reason ?? "";
	if (reason === "sync-dataset-ambiguous") return "restoreRecoveryReasonSourceAmbiguous";
	if (reason === "sync-dataset-bound" || reason === "restore-source-identity" || reason === "source-conflict" || reason === "dataset-conflict") {
		return "restoreRecoveryReasonSourceBound";
	}
	if (reason === "restore-recovery-invalid" || reason === "archive-attachment-reference" || reason === "attachment-missing") {
		return "restoreRecoveryReasonInvalid";
	}
	if (recovery.canRetry && !recovery.canAbandon) return "restoreRecoveryReasonRetryOnly";
	if (!recovery.canRetry && recovery.canAbandon) return "restoreRecoveryReasonAbandonOnly";
	if (!recovery.canRetry && !recovery.canAbandon) return "restoreRecoveryReasonUnavailable";
	if (reason === "unknown" || reason === "restore-failed" || reason === "restore-recovery-pending") return "restoreRecoveryReasonUnknown";
	return "restoreRecoveryReason";
}

export function RestoreRecoveryPanel() {
	const { t } = useTranslation();
	const [recoveries, setRecoveries] = useState<PendingRestoreRecovery[]>([]);
	const [readError, setReadError] = useState(false);
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [actionError, setActionError] = useState(false);
	const [confirmRecovery, setConfirmRecovery] = useState<PendingRestoreRecovery | null>(null);
	const actionInFlight = useRef(false);
	const mountedRef = useRef(true);
	const readGeneration = useRef(0);

	const refresh = useCallback(async () => {
		const generation = ++readGeneration.current;
		try {
			const next = await getPendingRestoreRecoveries();
			if (!mountedRef.current || generation !== readGeneration.current) return;
			setRecoveries(next);
			setReadError(false);
		} catch {
			if (mountedRef.current && generation === readGeneration.current) setReadError(true);
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			readGeneration.current++;
		};
	}, []);

	useEffect(() => {
		let active = true;
		let stopJournal: (() => void) | undefined;
		let stopRecords: (() => void) | undefined;
		void localRepository().then((repository) => {
			if (!active) return;
			const journalSubscription = liveQuery(() => getPendingRestoreRecoveries()).subscribe({
				next: () => { if (active) void refresh(); },
				error: () => { if (active) setReadError(true); },
			});
			const recordsSubscription = repository.db.records.find().$.subscribe({
				next: () => { if (active) void refresh(); },
				error: () => { if (active) setReadError(true); },
			});
			stopJournal = () => journalSubscription.unsubscribe();
			stopRecords = () => recordsSubscription.unsubscribe();
		}).catch(() => { if (active) setReadError(true); });
		return () => {
			active = false;
			stopJournal?.();
			stopRecords?.();
		};
	}, [refresh]);

	async function continueRecovery(recovery: PendingRestoreRecovery) {
		if (actionInFlight.current || busyKey || !recovery.canRetry) return;
		const key = recoveryKey(recovery);
		actionInFlight.current = true;
		setBusyKey(key);
		setActionError(false);
		try {
			await retryRestoreRecovery(recovery.token);
			await refresh();
		} catch {
			setActionError(true);
			await refresh();
		} finally {
			actionInFlight.current = false;
			setBusyKey(null);
		}
	}

	async function abandonRecovery() {
		if (!confirmRecovery || actionInFlight.current || busyKey || !confirmRecovery.canAbandon) return;
		const recovery = confirmRecovery;
		const key = recoveryKey(recovery);
		actionInFlight.current = true;
		setBusyKey(key);
		setActionError(false);
		try {
			await abandonRestoreRecovery(recovery.token);
			setConfirmRecovery(null);
			await refresh();
		} catch {
			setActionError(true);
			await refresh();
		} finally {
			actionInFlight.current = false;
			setBusyKey(null);
		}
	}

	if (readError) {
		return <section className="card restore-recovery-panel" aria-labelledby="restore-recovery-title">
			<h2 id="restore-recovery-title">{t("restoreRecoveryTitle")}</h2>
			<p role="alert">{t("restoreRecoveryReadError")}</p>
			<div className="actions restore-recovery-actions"><Button onClick={() => void refresh()} disabled={busyKey !== null}>{t("refresh")}</Button></div>
		</section>;
	}
	if (!recoveries.length) return null;

	return <>
		<section className="card restore-recovery-panel" aria-labelledby="restore-recovery-title">
			<div className="restore-recovery-heading">
				<div>
					<h2 id="restore-recovery-title">{t("restoreRecoveryTitle")}</h2>
					<p>{t("restoreRecoveryHint")}</p>
				</div>
				<span className="chip warn">{t("restoreRecoveryPendingShort")}</span>
			</div>
			{actionError && <p className="field-error" role="alert">{t("restoreRecoveryActionError")}</p>}
			{recoveries.map((recovery) => {
				const key = recoveryKey(recovery);
				const busy = busyKey === key;
				return <article className="restore-recovery-case" key={key}>
					<p className="restore-recovery-case-title">{t("restoreRecoveryCase")}</p>
					<dl className="restore-recovery-counts">
						<div><dt>{t("restoreRecoveryRows")}</dt><dd>{recovery.rowCount}</dd></div>
						<div><dt>{t("restoreRecoveryCandidates")}</dt><dd>{recovery.candidateCount}</dd></div>
						<div><dt>{t("restoreRecoveryEqual")}</dt><dd>{recovery.presentEqual}</dd></div>
						<div><dt>{t("restoreRecoveryMissing")}</dt><dd>{recovery.missing}</dd></div>
						<div><dt>{t("restoreRecoveryDifferent")}</dt><dd>{recovery.different}</dd></div>
					</dl>
					<p className="restore-recovery-reason">{t(reasonCopyKey(recovery))}</p>
					{(recovery.canRetry || recovery.canAbandon) && <div className="actions restore-recovery-actions">
						{recovery.canRetry && <Button
							variant="primary"
							disabled={busyKey !== null}
							onClick={() => void continueRecovery(recovery)}
						>
							{t("restoreRecoveryContinue")}
						</Button>}
						{recovery.canAbandon && <Button
							variant="danger"
							disabled={busyKey !== null}
							onClick={() => { setActionError(false); setConfirmRecovery(recovery); }}
						>
							{t("restoreRecoveryKeepCurrent")}
						</Button>}
						{busy && <span role="status">{t("restoreRecoveryWorking")}</span>}
					</div>}
				</article>;
			})}
		</section>
		{confirmRecovery && <Dialog
			title={t("restoreRecoveryAbandonTitle")}
			onClose={() => { if (!busyKey) setConfirmRecovery(null); }}
		>
			<p>{t("restoreRecoveryAbandonHint")}</p>
			{actionError && <p className="field-error" role="alert">{t("restoreRecoveryActionError")}</p>}
			<div className="actions restore-recovery-actions">
				<Button onClick={() => setConfirmRecovery(null)} disabled={!!busyKey}>{t("cancel")}</Button>
				<Button variant="danger" onClick={() => void abandonRecovery()} disabled={!!busyKey}>{t("restoreRecoveryAbandonConfirm")}</Button>
			</div>
		</Dialog>}
	</>;
}
