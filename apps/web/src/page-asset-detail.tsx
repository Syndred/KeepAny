import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	Background,
	Controls,
	MarkerType,
	ReactFlow,
	type Edge,
	type Node,
} from "@xyflow/react";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	type Asset,
	type Submission,
	actualCharge,
	dueOnCycle,
	monthlyAmount,
} from "../../../packages/domain/src";
import {
	cleanupUnreferencedFile,
	fileUrl,
	putFile,
	save,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { TaskRow } from "./TaskRow";
import {
	AssetRow,
	Empty,
	PageTitle,
	date,
	liveAssets,
	money,
	niceCategory,
	useAppContext,
	validKind,
} from "./view-shared";
const AssetEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.AssetEditor })),
);
const TaskEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.TaskEditor })),
);
function ImageTile({ id }: { id: string }) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		let current = "";
		fileUrl(id).then((v) => {
			current = v;
			setUrl(v);
		});
		return () => {
			if (current) URL.revokeObjectURL(current);
		};
	}, [id]);
	return url ? <img src={url} alt="" className="asset-image" /> : null;
}

function SubmissionRow({ submission }: { submission: Submission }) {
	const { t, i18n } = useTranslation();
	const { notify } = useAppContext();
	const [status, setStatus] = useState<Submission["status"]>(submission.status);
	const [evidence, setEvidence] = useState(submission.evidence);
	const [submittedAt, setSubmittedAt] = useState(submission.submittedAt);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const changed =
		status !== submission.status ||
		evidence !== submission.evidence ||
		submittedAt !== submission.submittedAt;
	async function store() {
		if (status !== "planned" && !evidence.trim()) {
			setError(t("evidenceRequired"));
			return;
		}
		if (status === "indexed" && !/^https?:\/\/\S+$/i.test(evidence.trim())) {
			setError(t("invalid"));
			return;
		}
		if (status !== "planned" && !submittedAt) {
			setError(t("submittedDateRequired"));
			return;
		}
		setBusy(true);
		setError("");
		try {
			const verifiedAt = ["indexed", "rejected"].includes(status)
				? new Date().toISOString().slice(0, 10)
				: "";
			await save("submission", {
				...submission,
				status,
				evidence: evidence.trim(),
				submittedAt: status === "planned" ? "" : submittedAt,
				verifiedAt,
			});
			notify(t("saved"));
		} catch {
			setError(t("error"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<tr>
			<td>
				<a href={submission.url} target="_blank" rel="noopener noreferrer">
					{submission.name}
				</a>
			</td>
			<td>
				<select
					aria-label={`${submission.name} ${t("status")}`}
					value={status}
					onChange={(e) => setStatus(e.target.value as Submission["status"])}
				>
					{(
						[
							"planned",
							"submitted",
							"review",
							"indexed",
							"verify",
							"rejected",
						] as const
					).map((value) => (
						<option key={value} value={value}>
							{t(value)}
						</option>
					))}
				</select>
			</td>
			<td>
				<input
					type="date"
					aria-label={`${submission.name} ${t("submittedAt")}`}
					value={submittedAt}
					onChange={(e) => setSubmittedAt(e.target.value)}
				/>
			</td>
			<td>{date(submission.verifiedAt, i18n.language)}</td>
			<td>
				<input
					aria-label={`${submission.name} ${t("evidence")}`}
					value={evidence}
					onChange={(e) => setEvidence(e.target.value)}
				/>
				{error && (
					<small className="field-error" role="alert">
						{error}
					</small>
				)}
			</td>
			<td>
				<Button
					size="small"
					disabled={!changed || busy}
					onClick={() => void store()}
				>
					{t("save")}
				</Button>
			</td>
		</tr>
	);
}

export function AssetDetail() {
	const params = (useRouterState({ select: (s) => s.matches.at(-1)?.params }) ??
		{}) as { kind?: string; id?: string };
	const kind = validKind(params.kind ?? "project");
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const imageInput = useRef<HTMLInputElement>(null);
	const asset = data.assets.find(
		(a) => a.id === params.id && a.kind === kind && !a.deleted,
	);
	const [edit, setEdit] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const deleteInFlight = useRef(false);
	const [relationEdit, setRelationEdit] = useState(false);
	const [submissionEdit, setSubmissionEdit] = useState(false);
	const [taskEdit, setTaskEdit] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [pendingImage, setPendingImage] = useState<File | null>(null);
	const [pendingImageUrl, setPendingImageUrl] = useState("");
	const [pendingImageStatus, setPendingImageStatus] = useState<
		"loading" | "ready" | "error"
	>("loading");
	useEffect(() => {
		setPendingImageStatus("loading");
		if (!pendingImage) {
			setPendingImageUrl("");
			return;
		}
		const url = URL.createObjectURL(pendingImage);
		setPendingImageUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [pendingImage]);
	const [relationTarget, setRelationTarget] = useState("");
	const [relationLabel, setRelationLabel] = useState("");
	const [submissionName, setSubmissionName] = useState("");
	const [submissionUrl, setSubmissionUrl] = useState("");
	const [historyNote, setHistoryNote] = useState("");
	const relations = data.relations.filter(
		(r) => !r.deleted && (r.from === asset?.id || r.to === asset?.id),
	);
	const related = relations
		.map((r) =>
			data.assets.find(
				(a) => a.id === (r.from === asset?.id ? r.to : r.from) && !a.deleted,
			),
		)
		.filter((x): x is Asset => !!x);
	const ownTasks = data.tasks.filter(
		(x) => !x.deleted && x.assetId === asset?.id,
	);
	const submissions = data.submissions.filter(
		(x) => !x.deleted && x.assetId === asset?.id,
	);
	const histories = data.history
		.filter((x) => !x.deleted && x.assetId === asset?.id)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	if (!asset)
		return (
			<main className="page">
				<PageTitle title={t("noMatches")} />
				<Link to="/assets/$kind" params={{ kind }}>
					{t("back")}
				</Link>
			</main>
		);
	const dueCharge =
		asset.kind === "subscription" && asset.dueDate
			? actualCharge(asset, asset.dueDate)
			: null;
	const run = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
			notify(t("saved"));
		} catch {
			notify(t("error"));
		}
	};
	async function confirmDelete() {
		if (deleteInFlight.current) return;
		deleteInFlight.current = true;
		setDeleteBusy(true);
		try {
			await save("asset", {
				...asset,
				deleted: true,
				updatedAt: new Date().toISOString(),
			});
			setDeleteOpen(false);
			await navigate({ to: "/assets/$kind", params: { kind } });
			notify(t("saved"));
		} catch {
			notify(t("error"));
		} finally {
			deleteInFlight.current = false;
			setDeleteBusy(false);
		}
	}
	async function addRelation() {
		if (!asset) return;
		const target = data.assets.find((a) => a.id === relationTarget);
		if (!target || target.id === asset.id || !relationLabel.trim()) return;
		await save("relation", {
			id: crypto.randomUUID(),
			from: asset.id,
			to: target.id,
			label: relationLabel.trim(),
			createdAt: new Date().toISOString(),
			verifiedAt: "",
			deleted: false,
		});
		setRelationEdit(false);
		setRelationLabel("");
		setRelationTarget("");
	}
	async function addSubmission() {
		if (
			!asset ||
			!submissionName.trim() ||
			!/^https?:\/\//i.test(submissionUrl)
		)
			return;
		await save("submission", {
			id: crypto.randomUUID(),
			assetId: asset.id,
			name: submissionName.trim(),
			url: submissionUrl,
			status: "planned",
			submittedAt: "",
			verifiedAt: "",
			evidence: "",
			deleted: false,
		});
		setSubmissionEdit(false);
		setSubmissionName("");
		setSubmissionUrl("");
	}
	async function addImage(file: File) {
		if (!asset) return;
		setUploading(true);
		let fileId = "";
		try {
			fileId = await putFile(file);
			await save("asset", {
				...asset,
				attachments: [...asset.attachments, fileId],
				updatedAt: new Date().toISOString(),
			});
			setPendingImage(null);
			notify(t("saved"));
		} catch {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t("uploadError"));
		} finally {
			setUploading(false);
		}
	}
	async function recordAction(
		action: "loan" | "return" | "renew" | "maintenance",
	) {
		if (!asset) return;
		const now = new Date().toISOString();
		let update = { ...asset, updatedAt: now };
		let note = historyNote.trim();
		if (action === "renew" && asset.dueDate) {
			const anchor = asset.billingAnchor || asset.dueDate;
			const count = (asset.renewalCount || 0) + 1;
			const charge = actualCharge(asset, asset.dueDate);
			update = {
				...update,
				billingAnchor: anchor,
				renewalCount: count,
				dueDate: dueOnCycle(anchor, asset.cycle, asset.interval, count),
			};
			note =
				note ||
				`${charge === null ? "—" : money(charge, asset.currency, i18n.language)} · ${asset.dueDate}`;
		}
		if (action === "loan")
			update = {
				...update,
				status: "loaned" as const,
				borrower: historyNote.trim(),
			};
		if (action === "return")
			update = { ...update, status: "active" as const, borrower: "" };
		await save("asset", update);
		await save("history", {
			id: crypto.randomUUID(),
			assetId: asset.id,
			action,
			note,
			createdAt: now,
			deleted: false,
		});
		setHistoryNote("");
	}
	async function createImpact() {
		if (!asset) return;
		for (const linked of related) {
			const key = `impact:${asset.id}:${linked.id}`;
			if (data.tasks.some((x) => !x.deleted && !x.done && x.dedupeKey === key))
				continue;
			await save("task", {
				id: crypto.randomUUID(),
				name: `${t("checkConnection")}: ${linked.name}`,
				assetId: linked.id,
				dueDate: "",
				done: false,
				completedAt: "",
				createdAt: new Date().toISOString(),
				dedupeKey: key,
				deleted: false,
			});
		}
		notify(t("saved"));
	}
	return (
		<main className="page">
			<div className="page-header">
				<div>
					<Link className="back-link" to="/assets/$kind" params={{ kind }}>
						<ArrowLeft size={16} />
						{t("back")}
					</Link>
					<div className="eyebrow">
						{t(kind)} · {niceCategory(asset.category, t)}
					</div>
					<h1>{asset.name}</h1>
					<p className="subtitle">
						{asset.description || asset.url || t("local")}
					</p>
				</div>
				<div className="actions">
					<Button onClick={() => setEdit(true)}>{t("edit")}</Button>
					<Button
						variant="danger"
						disabled={deleteBusy}
						onClick={() => setDeleteOpen(true)}
					>
						{t("delete")}
					</Button>
				</div>
			</div>
			{deleteOpen && (
				<Dialog
					title={t("delete")}
					onClose={() => {
						if (!deleteInFlight.current) setDeleteOpen(false);
					}}
				>
					<p>{t("deleteConfirm")}</p>
					<div className="actions">
						<Button disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={deleteBusy}
							onClick={() => void confirmDelete()}
						>
							{t("delete")}
						</Button>
					</div>
				</Dialog>
			)}
			<div className="detail-grid">
				<section className="card">
					<div className="card-header">
						<h2>{t("profile")}</h2>
					</div>
					<dl className="facts">
						<div>
							<dt>{t("category")}</dt>
							<dd>{niceCategory(asset.category, t) || "—"}</dd>
						</div>
						{asset.url && (
							<div>
								<dt>{t("url")}</dt>
								<dd>
									<a href={asset.url} target="_blank" rel="noopener noreferrer">
										{asset.url}
									</a>
								</dd>
							</div>
						)}
						{asset.username && (
							<div>
								<dt>{t("username")}</dt>
								<dd>{asset.username}</dd>
							</div>
						)}
						{asset.contact && (
							<div>
								<dt>{t("contact")}</dt>
								<dd>{asset.contact}</dd>
							</div>
						)}
						{asset.kind === "subscription" && (
							<>
								<div>
									<dt>{t("amount")}</dt>
									<dd>{money(asset.amount, asset.currency, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("monthly")}</dt>
									<dd>
										{money(monthlyAmount(asset), asset.currency, i18n.language)}
									</dd>
								</div>
								<div>
									<dt>{t("cycle")}</dt>
									<dd>
										{asset.interval} {t(asset.cycle)}
									</dd>
								</div>
								<div>
									<dt>{t("dueDate")}</dt>
									<dd>{date(asset.dueDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("actualCharge")}</dt>
									<dd>
										{dueCharge === null
											? "—"
											: money(dueCharge, asset.currency, i18n.language)}
									</dd>
								</div>
								{asset.trialEndsAt && (
									<div>
										<dt>{t("trialEndsAt")}</dt>
										<dd>{date(asset.trialEndsAt, i18n.language)}</dd>
									</div>
								)}
								{asset.discountUntil && (
									<div>
										<dt>{t("discountUntil")}</dt>
										<dd>
											{date(asset.discountUntil, i18n.language)} ·{" "}
											{money(
												asset.discountAmount,
												asset.currency,
												i18n.language,
											)}
										</dd>
									</div>
								)}
							</>
						)}
						{asset.kind === "item" && (
							<>
								<div>
									<dt>{t("purchaseDate")}</dt>
									<dd>{date(asset.purchaseDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("warrantyDate")}</dt>
									<dd>{date(asset.warrantyDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("location")}</dt>
									<dd>{asset.location || "—"}</dd>
								</div>
							</>
						)}
						{asset.status && (
							<div>
								<dt>{t("status")}</dt>
								<dd>
									<span className="chip">{t(asset.status)}</span>
								</dd>
							</div>
						)}
					</dl>
					{asset.tags.length > 0 && (
						<div className="chips">
							{asset.tags.map((tag) => (
								<span className="chip" key={tag}>
									{tag}
								</span>
							))}
						</div>
					)}
					{asset.longDescription && (
						<details className="more">
							<summary>{t("more")}</summary>
							<p>{asset.longDescription}</p>
						</details>
					)}
					{asset.notes && <p className="note">{asset.notes}</p>}
				</section>
				<section className="card">
					<div className="card-header">
						<h2>{t("attachments")}</h2>
						<Button
							size="small"
							disabled={uploading || asset.attachments.length >= 20}
							onClick={() => imageInput.current?.click()}
						>
							{uploading ? t("loading") : t("addPhoto")}
						</Button>
						<input
							ref={imageInput}
							type="file"
							accept="image/jpeg,image/png,image/webp,image/gif"
							hidden
							tabIndex={-1}
							aria-label={t("addPhoto")}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) {
									if (
										![
											"image/jpeg",
											"image/png",
											"image/webp",
											"image/gif",
										].includes(file.type) ||
										file.size === 0 ||
										file.size > 20 * 1024 * 1024
									)
										notify(t("uploadError"));
									else {
										setPendingImageUrl("");
										setPendingImageStatus("loading");
										setPendingImage(file);
									}
								}
								e.target.value = "";
							}}
						/>
					</div>
					{asset.attachments.length ? (
						<div className="image-grid">
							{asset.attachments.map((id) => (
								<div key={id} className="image-item">
									<ImageTile id={id} />
									<Button
										variant="danger"
										size="small"
										onClick={() =>
											run(async () => {
												await save("asset", {
													...asset,
													attachments: asset.attachments.filter(
														(x) => x !== id,
													),
													updatedAt: new Date().toISOString(),
												});
												await cleanupUnreferencedFile(id).catch(() => false);
											})
										}
									>
										{t("removeImage")}
									</Button>
								</div>
							))}
						</div>
					) : (
						<Empty hint={false} />
					)}
				</section>
			</div>
			<div className="detail-grid">
				<section className="card">
					<div className="card-header">
						<h2>{t("relations")}</h2>
						<Button
							variant="ghost"
							size="small"
							onClick={() => setRelationEdit(true)}
						>
							<Plus size={14} />
							{t("addRelation")}
						</Button>
					</div>
					{relations.length ? (
						<>
							<div className="graph">
								<ReactFlow
									fitView
									nodes={
										[
											{
												id: asset.id,
												position: { x: 180, y: 100 },
												data: { label: asset.name },
												type: "default",
											},
											...related.map((a, i) => ({
												id: a.id,
												position: {
													x: 20 + (i % 3) * 180,
													y: 240 + Math.floor(i / 3) * 110,
												},
												data: { label: a.name },
												type: "default",
											})),
										] as Node[]
									}
									edges={relations.map(
										(r) =>
											({
												id: r.id,
												source: r.from,
												target: r.to,
												label: r.label,
												markerEnd: { type: MarkerType.ArrowClosed },
											}) as Edge,
									)}
									onNodeClick={(_, node) => {
										const target = data.assets.find((a) => a.id === node.id);
										if (target)
											void navigate({
												to: "/assets/$kind/$id",
												params: { kind: target.kind, id: target.id },
											});
									}}
									nodesDraggable={false}
									nodesConnectable={false}
								>
									<Background />
									<Controls showInteractive={false} />
								</ReactFlow>
							</div>
							<div className="list">
								{related.map((a) => (
									<AssetRow key={a.id} asset={a} />
								))}
							</div>
						</>
					) : (
						<Empty hint={false} />
					)}
				</section>
				<section className="card">
					<div className="card-header">
						<h2>{t("tasks")}</h2>
						<Button
							variant="ghost"
							size="small"
							onClick={() => setTaskEdit(true)}
						>
							<Plus size={14} />
							{t("add")}
						</Button>
					</div>
					{ownTasks.length ? (
						<div className="list">
							{ownTasks.map((task) => (
								<TaskRow key={task.id} task={task} />
							))}
						</div>
					) : (
						<Empty hint={false} />
					)}
					{asset.kind === "account" && related.length > 0 && (
						<div className="notice">
							<strong>{t("impact")}</strong>
							<p>{t("impactHint")}</p>
							<Button size="small" onClick={() => void createImpact()}>
								{t("makeChecklist")}
							</Button>
						</div>
					)}
				</section>
			</div>
			{asset.kind === "project" && (
				<section className="card">
					<div className="card-header">
						<h2>{t("backlinks")}</h2>
						<Button
							variant="ghost"
							size="small"
							onClick={() => setSubmissionEdit(true)}
						>
							<Plus size={14} />
							{t("addSubmission")}
						</Button>
					</div>
					{submissions.length ? (
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>{t("name")}</th>
										<th>{t("status")}</th>
										<th>{t("submittedAt")}</th>
										<th>{t("verifiedAt")}</th>
										<th>{t("evidence")}</th>
										<th>{t("operation")}</th>
									</tr>
								</thead>
								<tbody>
									{submissions.map((s) => (
										<SubmissionRow key={s.id} submission={s} />
									))}
								</tbody>
							</table>
						</div>
					) : (
						<Empty hint={false} />
					)}
				</section>
			)}
			{(asset.kind === "item" || asset.kind === "subscription") && (
				<section className="card">
					<div className="card-header">
						<h2>{t("history")}</h2>
					</div>
					<div className="toolbar">
						{asset.kind === "subscription" ? (
							<Button
								disabled={asset.status !== "active" || !asset.dueDate}
								onClick={() => void run(() => recordAction("renew"))}
							>
								{t("renew")}
							</Button>
						) : (
							<>
								<Button
									onClick={() =>
										void run(() =>
											recordAction(
												asset.status === "loaned" ? "return" : "loan",
											),
										)
									}
								>
									{t(asset.status === "loaned" ? "return" : "loan")}
								</Button>
								<Button
									onClick={() => void run(() => recordAction("maintenance"))}
								>
									{t("maintenance")}
								</Button>
							</>
						)}
						<input
							value={historyNote}
							onChange={(e) => setHistoryNote(e.target.value)}
							placeholder={asset.kind === "item" ? t("borrower") : t("notes")}
							aria-label={t("notes")}
						/>
					</div>
					{histories.length ? (
						<div className="list">
							{histories.map((h) => (
								<div className="list-row" key={h.id}>
									<Check size={17} />
									<div>
										<strong>{t(h.action)}</strong>
										<small>
											{new Intl.DateTimeFormat(i18n.language, {
												dateStyle: "medium",
											}).format(new Date(h.createdAt))}
											{h.note && ` · ${h.note}`}
										</small>
									</div>
								</div>
							))}
						</div>
					) : (
						<Empty hint={false} />
					)}
				</section>
			)}
			{edit && (
				<Suspense
					fallback={
						<div className="toast" role="status">
							{t("loading")}
						</div>
					}
				>
					<AssetEditor
						kind={kind}
						asset={asset}
						categories={data.categories}
						onClose={() => setEdit(false)}
					/>
				</Suspense>
			)}
			{taskEdit && (
				<Suspense
					fallback={
						<div className="toast" role="status">
							{t("loading")}
						</div>
					}
				>
					<TaskEditor assetId={asset.id} onClose={() => setTaskEdit(false)} />
				</Suspense>
			)}
			{relationEdit && (
				<Dialog title={t("addRelation")} onClose={() => setRelationEdit(false)}>
					<div className="form-grid">
						<div className="field">
							<label htmlFor="relation-target">{t("target")}</label>
							<select
								id="relation-target"
								value={relationTarget}
								onChange={(e) => setRelationTarget(e.target.value)}
							>
								<option value="">{t("selectAsset")}</option>
								{liveAssets(data)
									.filter((a) => a.id !== asset.id)
									.map((a) => (
										<option key={a.id} value={a.id}>
											{a.name}
										</option>
									))}
							</select>
						</div>
						<div className="field">
							<label htmlFor="relation-label">{t("relationLabel")}</label>
							<input
								id="relation-label"
								value={relationLabel}
								onChange={(e) => setRelationLabel(e.target.value)}
							/>
						</div>
					</div>
					<div className="actions">
						<Button
							variant="primary"
							disabled={!relationTarget || !relationLabel.trim()}
							onClick={() => void run(addRelation)}
						>
							{t("save")}
						</Button>
					</div>
				</Dialog>
			)}
			{submissionEdit && (
				<Dialog
					title={t("addSubmission")}
					onClose={() => setSubmissionEdit(false)}
				>
					<div className="form-grid">
						<div className="field">
							<label htmlFor="submission-name">{t("name")}</label>
							<input
								id="submission-name"
								value={submissionName}
								onChange={(e) => setSubmissionName(e.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="submission-url">{t("url")}</label>
							<input
								id="submission-url"
								type="url"
								value={submissionUrl}
								onChange={(e) => setSubmissionUrl(e.target.value)}
							/>
						</div>
					</div>
					<div className="actions">
						<Button
							variant="primary"
							disabled={
								!submissionName.trim() || !/^https?:\/\//i.test(submissionUrl)
							}
							onClick={() => void run(addSubmission)}
						>
							{t("save")}
						</Button>
					</div>
				</Dialog>
			)}
			{pendingImage && (
				<Dialog title={t("preview")} onClose={() => setPendingImage(null)}>
					{pendingImageUrl && (
						<img
							className="image-preview"
							src={pendingImageUrl}
							alt={pendingImage.name}
							onLoad={() => setPendingImageStatus("ready")}
							onError={() => setPendingImageStatus("error")}
						/>
					)}
					<p>{pendingImage.name}</p>
					{pendingImageStatus === "error" && (
						<p role="alert">{t("uploadError")}</p>
					)}
					<div className="actions">
						<Button onClick={() => setPendingImage(null)}>{t("cancel")}</Button>
						<Button
							variant="primary"
							disabled={uploading || pendingImageStatus !== "ready"}
							onClick={() => void addImage(pendingImage)}
						>
							{uploading ? t("loading") : t("confirm")}
						</Button>
					</div>
				</Dialog>
			)}
		</main>
	);
}
