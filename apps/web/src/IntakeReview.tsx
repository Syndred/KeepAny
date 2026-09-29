import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, duplicates, type Asset } from "../../../packages/domain/src";
import { allRecords, localRepository, saveBatch } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import {
	decideReviewedCandidate, editReviewedCandidate, getReviewedCandidate,
	listReviewedCandidates, type ReviewedCandidate,
} from "./intake-review-store";
import "./intake-review.css";

const importKinds = ["project", "account", "subscription", "item"] as const;

function withReviewLock<T>(id: string, action: () => Promise<T>): Promise<T> {
	return navigator.locks
		? navigator.locks.request(`keepany-intake-review:${id}`, action)
		: action();
}

export function IntakeReview() {
	const { t } = useTranslation();
	const [rows, setRows] = useState<ReviewedCandidate[]>([]);
	const [message, setMessage] = useState("");
	const [workingId, setWorkingId] = useState("");
	const inFlight = useRef(new Set<string>());
	const drafts = useRef(new Map<string, Asset>());
	const pendingSaves = useRef(new Map<string, Promise<void>>());
	const refresh = async () => setRows(await listReviewedCandidates());
	const flushEdits = async () => Promise.all([...pendingSaves.current.values()]);
	useEffect(() => {
		let active = true;
		void listReviewedCandidates().then((items) => { if (active) setRows(items); });
		return () => { active = false; };
	}, []);

	function edit(id: string, field: "name" | "kind" | "url" | "description", value: string) {
		if (inFlight.current.has(id)) return;
		const row = rows.find((item) => item.id === id);
		if (row?.status !== "pending") return;
		const kindSelected = field === "kind" ? true : row.kindSelected;
		const asset = { ...(drafts.current.get(id) ?? row.asset), [field]: value };
		drafts.current.set(id, asset);
		setRows((current) => current.map((item) => item.id === id ? { ...item, asset, kindSelected } : item));
		const previous = pendingSaves.current.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(() => withReviewLock(id, async () => {
			if (await editReviewedCandidate(id, asset, kindSelected)) return;
			const latest = await getReviewedCandidate(id);
			if (latest) {
				drafts.current.delete(id);
				setRows((current) => current.map((item) => item.id === id ? latest : item));
			}
		}));
		pendingSaves.current.set(id, next);
		void next.catch(() => setMessage(t("error")));
	}

	async function decide(id: string, decision: "accepted" | "ignored") {
		if (inFlight.current.has(id)) return;
		inFlight.current.add(id);
		setWorkingId(id);
		setMessage("");
		const commit = async () => {
			const row = await getReviewedCandidate(id);
			if (row?.status !== "pending") { await refresh(); return; }
			if (decision === "ignored") {
				await decideReviewedCandidate(id, "ignored");
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
		} catch { setMessage(t("error")); }
		finally { inFlight.current.delete(id); setWorkingId(""); }
	}

	return <div className="intake-review">
		<p>{t("reviewIntro")}</p>
		<p className="muted">{t("reviewPdfHint")}</p>
		{message && <p role="status" className="intake-review-message">{message}</p>}
		{rows.length > 0 && <div className="intake-review-list">
			<h3>{t("reviewCandidates")}</h3>
			{rows.map((row) => <div className="intake-review-row" key={row.id}>
				<div className="intake-review-source"><strong>{row.fileName}</strong><small>{row.source === "pdf" ? t("reviewPdfDocument") : t("reviewRowNumber", { number: row.rowNumber })}</small>
					<span className={`chip ${row.status === "pending" ? "warn" : ""}`}>{t(`reviewStatus${row.status[0].toUpperCase()}${row.status.slice(1)}`)}</span></div>
				{row.sourceText && <details><summary>{t("reviewPdfOriginal")}</summary><pre className="intake-pdf-text">{row.sourceText}</pre></details>}
				{row.status === "pending" && <>
					<div className="field"><label htmlFor={`${row.id}-name`}>{t("name")}</label><input id={`${row.id}-name`} value={row.asset.name} disabled={workingId === row.id} onChange={(event) => edit(row.id, "name", event.target.value)} /></div>
					<div className="field"><label htmlFor={`${row.id}-kind`}>{t("intakeRecordType")}</label><select id={`${row.id}-kind`} value={row.source === "pdf" && !row.kindSelected ? "" : row.asset.kind} disabled={workingId === row.id} onChange={(event) => edit(row.id, "kind", event.target.value)}><option value="" disabled>{t("reviewSelectKind")}</option>{importKinds.map((kind) => <option value={kind} key={kind}>{t(kind)}</option>)}</select></div>
					<div className="field"><label htmlFor={`${row.id}-url`}>{t("url")}</label><input id={`${row.id}-url`} value={row.asset.url} disabled={workingId === row.id} onChange={(event) => edit(row.id, "url", event.target.value)} /></div>
					<div className="field"><label htmlFor={`${row.id}-description`}>{t("description")}</label><textarea rows={row.source === "pdf" ? 6 : 2} id={`${row.id}-description`} value={row.asset.description} disabled={workingId === row.id} onChange={(event) => edit(row.id, "description", event.target.value)} /></div>
					<div className="actions"><Button variant="primary" disabled={workingId === row.id || (row.source === "pdf" && !row.kindSelected)} onClick={() => void decide(row.id, "accepted")}>{t("reviewConfirm")}</Button><Button disabled={workingId === row.id} onClick={() => void decide(row.id, "ignored")}>{t("reviewIgnore")}</Button></div>
				</>}
			</div>)}
		</div>}
	</div>;
}
