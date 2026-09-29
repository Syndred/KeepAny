import Papa from "papaparse";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, duplicates, newAsset, type Asset, type AssetKind } from "../../../packages/domain/src";
import { allRecords, localRepository, saveBatch } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import {
	decideReviewedCandidate, editReviewedCandidate, getReviewedCandidate,
	listReviewedCandidates, stageReviewedCandidates, type ReviewedCandidate,
} from "./intake-review-store";
import "./intake-review.css";

const importKinds = ["project", "account", "subscription", "item"] as const;
const maxCsvBytes = 2 * 1024 * 1024;
const maxRows = 200;

async function fingerprint(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function IntakeReview() {
	const { t } = useTranslation();
	const [rows, setRows] = useState<ReviewedCandidate[]>([]);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [workingId, setWorkingId] = useState("");
	const generation = useRef(0);
	const inFlight = useRef(new Set<string>());
	const drafts = useRef(new Map<string, Asset>());
	const pendingSaves = useRef(new Map<string, Promise<void>>());
	const refresh = async () => setRows(await listReviewedCandidates());
	const flushEdits = async () => Promise.all([...pendingSaves.current.values()]);
	useEffect(() => {
		let active = true;
		void listReviewedCandidates().then((items) => { if (active) setRows(items); });
		return () => { active = false; generation.current++; };
	}, []);

	async function chooseFile(file: File | undefined) {
		const current = ++generation.current;
		setMessage("");
		if (!file) return;
		if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
			setMessage(t("reviewPdfUnavailable"));
			return;
		}
		if (!file.name.toLowerCase().endsWith(".csv") || file.size > maxCsvBytes) {
			setMessage(t("reviewCsvLimit"));
			return;
		}
		setBusy(true);
		try {
			const bytes = await file.arrayBuffer();
			const hash = await fingerprint(bytes);
			const parsed = Papa.parse<Record<string, string>>(new TextDecoder().decode(bytes), { header: true, skipEmptyLines: true });
			if (parsed.errors.length || parsed.data.length > maxRows || !parsed.data.length) throw Error("csv");
			const importedAt = new Date().toISOString();
			const staged: ReviewedCandidate[] = [];
			for (const [index, source] of parsed.data.entries()) {
				const kind = source.kind?.trim() as AssetKind;
				if (!importKinds.includes(kind as typeof importKinds[number]) || !source.name?.trim()) continue;
				const asset = assetSchema.safeParse({
					...newAsset(kind), id: `csv-${hash.slice(0, 48)}-${index + 2}`,
					name: source.name.trim(), url: source.url?.trim() ?? "",
					category: source.category?.trim() ?? "", description: source.description?.trim() ?? "",
					createdAt: importedAt, updatedAt: importedAt,
				});
				if (asset.success) staged.push({
					id: `csv-${hash}-${index + 2}`, fileHash: hash, fileName: file.name,
					rowNumber: index + 2, asset: asset.data, status: "pending",
				});
			}
			if (!staged.length) throw Error("csv");
			await stageReviewedCandidates(staged);
			if (current !== generation.current) return;
			await flushEdits();
			await refresh();
			setMessage(t("reviewCsvStaged", { count: staged.length }));
		} catch {
			if (current === generation.current) setMessage(t("reviewCsvInvalid"));
		} finally {
			if (current === generation.current) setBusy(false);
		}
	}

	function edit(id: string, field: "name" | "kind" | "url" | "description", value: string) {
		if (inFlight.current.has(id)) return;
		const row = rows.find((item) => item.id === id);
		if (row?.status !== "pending") return;
		const asset = { ...(drafts.current.get(id) ?? row.asset), [field]: value };
		drafts.current.set(id, asset);
		setRows((current) => current.map((item) => item.id === id ? { ...item, asset } : item));
		const previous = pendingSaves.current.get(id) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(() => editReviewedCandidate(id, asset));
		pendingSaves.current.set(id, next);
		void next.catch(() => setMessage(t("error")));
	}

	async function decide(id: string, decision: "accepted" | "ignored") {
		if (inFlight.current.has(id)) return;
		inFlight.current.add(id);
		setWorkingId(id);
		setMessage("");
		const commit = async () => {
			await flushEdits();
			const row = await getReviewedCandidate(id);
			if (row?.status !== "pending") { await refresh(); return; }
			if (decision === "ignored") {
				await decideReviewedCandidate(id, "ignored");
				await refresh();
				return;
			}
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
			if (navigator.locks) await navigator.locks.request(`keepany-intake-review:${id}`, commit);
			else await commit();
		} catch { setMessage(t("error")); }
		finally { inFlight.current.delete(id); setWorkingId(""); }
	}

	return <div className="intake-review">
		<p>{t("reviewIntro")}</p>
		<div className="field"><label htmlFor="intake-review-file">{t("reviewFile")}</label>
			<input id="intake-review-file" type="file" accept=".csv,text/csv,.pdf,application/pdf" disabled={busy}
				onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
		</div>
		<p className="muted">{t("reviewPdfHint")}</p>
		{message && <p role="status" className="intake-review-message">{message}</p>}
		{rows.length > 0 && <div className="intake-review-list">
			<h3>{t("reviewCandidates")}</h3>
			{rows.map((row) => <div className="intake-review-row" key={row.id}>
				<div className="intake-review-source"><strong>{row.fileName}</strong><small>{t("reviewRowNumber", { number: row.rowNumber })}</small>
					<span className={`chip ${row.status === "pending" ? "warn" : ""}`}>{t(`reviewStatus${row.status[0].toUpperCase()}${row.status.slice(1)}`)}</span></div>
				{row.status === "pending" && <>
					<div className="field"><label htmlFor={`${row.id}-name`}>{t("name")}</label><input id={`${row.id}-name`} value={row.asset.name} disabled={workingId === row.id} onChange={(event) => edit(row.id, "name", event.target.value)} /></div>
					<div className="field"><label htmlFor={`${row.id}-kind`}>{t("intakeRecordType")}</label><select id={`${row.id}-kind`} value={row.asset.kind} disabled={workingId === row.id} onChange={(event) => edit(row.id, "kind", event.target.value)}>{importKinds.map((kind) => <option value={kind} key={kind}>{t(kind)}</option>)}</select></div>
					<div className="field"><label htmlFor={`${row.id}-url`}>{t("url")}</label><input id={`${row.id}-url`} value={row.asset.url} disabled={workingId === row.id} onChange={(event) => edit(row.id, "url", event.target.value)} /></div>
					<div className="field"><label htmlFor={`${row.id}-description`}>{t("description")}</label><input id={`${row.id}-description`} value={row.asset.description} disabled={workingId === row.id} onChange={(event) => edit(row.id, "description", event.target.value)} /></div>
					<div className="actions"><Button variant="primary" disabled={workingId === row.id} onClick={() => void decide(row.id, "accepted")}>{t("reviewConfirm")}</Button><Button disabled={workingId === row.id} onClick={() => void decide(row.id, "ignored")}>{t("reviewIgnore")}</Button></div>
				</>}
			</div>)}
		</div>}
	</div>;
}
