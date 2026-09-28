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
	type Relation,
	actualCharge,
	dueOnCycle,
	monthlyAmount,
} from "../../../packages/domain/src";
import { buildImpactTasks, upgradeLegacyImpactTasks } from "../../../packages/domain/src/impact";
import {
	cleanupUnreferencedFile,
	deleteEntity,
	fileUrl,
	localRepository,
	putFile,
	recordRenewal,
	save,
	saveBatch,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { TaskRow } from "./TaskRow";
import { ImpactTaskRow } from "./ImpactTaskRow";
import {
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
function graphLabel(value: string) {
	const chars = Array.from(value);
	return chars.length > 18 ? `${chars.slice(0, 18).join("")}…` : value;
}
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
	const [relationToDelete, setRelationToDelete] = useState<Relation | null>(
		null,
	);
	const [relationBusy, setRelationBusy] = useState(false);
	const relationInFlight = useRef(false);
	const [relationError, setRelationError] = useState("");
	const [relationFilter, setRelationFilter] = useState("");
	const centerId = asset?.id;
	useEffect(() => {
		if (centerId) setRelationFilter("");
	}, [centerId]);
	const [submissionEdit, setSubmissionEdit] = useState(false);
	const [taskEdit, setTaskEdit] = useState(false);
	const [impactFilter, setImpactFilter] = useState<"all" | "pending" | "done">("all");
	const [impactBusy, setImpactBusy] = useState(false);
	const impactInFlight = useRef(false);
	const generatedImpactKeys = useRef(new Set<string>());
	useEffect(() => {
		for (const task of data.tasks) {
			if (!task.deleted) generatedImpactKeys.current.delete(task.dedupeKey);
		}
	}, [data.tasks]);
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
	const [relationSource, setRelationSource] = useState("");
	const [relationVerifiedAt, setRelationVerifiedAt] = useState("");
	const [submissionName, setSubmissionName] = useState("");
	const [submissionUrl, setSubmissionUrl] = useState("");
	const [historyNote, setHistoryNote] = useState("");
	const [renewalAmount, setRenewalAmount] = useState("");
	const [renewalAmountError, setRenewalAmountError] = useState("");
	const [renewalBusy, setRenewalBusy] = useState(false);
	const [renewalRecoveryPending, setRenewalRecoveryPending] = useState(false);
	const renewalInFlight = useRef(false);
	useEffect(() => {
		if (kind !== "subscription") return;
		let active = true;
		void localRepository().then(repository => {
			if (active) setRenewalRecoveryPending(!!repository.renewalRecoveryError);
		}).catch(() => {
			if (active) setRenewalRecoveryPending(true);
		});
		return () => { active = false; };
	}, [kind]);
	const liveById = new Map(liveAssets(data).map((item) => [item.id, item]));
	const relations = data.relations.filter(
		(r) =>
			!r.deleted &&
			(r.from === asset?.id || r.to === asset?.id) &&
			liveById.has(r.from) &&
			liveById.has(r.to),
	);
	const normalizedFilter =
		relations.length >= 5 ? relationFilter.trim().toLocaleLowerCase() : "";
	const visibleRelations = normalizedFilter
		? relations.filter((relation) => {
				const neighbor = liveById.get(
					relation.from === asset?.id ? relation.to : relation.from,
				);
				return [neighbor?.name, relation.label, relation.source].some((value) =>
					value?.toLocaleLowerCase().includes(normalizedFilter),
				);
			})
		: relations;
	const visibleRelated = Array.from(
		new Map(
			visibleRelations.map((r) => {
				const neighbor = liveById.get(r.from === asset?.id ? r.to : r.from);
				return [neighbor?.id, neighbor] as const;
			}),
		).values(),
	).filter((item): item is Asset => !!item);
	const graphEdges = Array.from(
		visibleRelations
			.reduce((groups, relation) => {
				const pair = JSON.stringify([relation.from, relation.to]);
				const group = groups.get(pair) ?? [];
				group.push(relation);
				groups.set(pair, group);
				return groups;
			}, new Map<string, Relation[]>())
			.values(),
	).map(
		(group) =>
			({
				id: group[0].id,
				source: group[0].from,
				target: group[0].to,
				label:
					group.length > 2
						? `${graphLabel(group[0].label)} · +${group.length - 1}`
						: group.map((relation) => graphLabel(relation.label)).join(" · "),
				markerEnd: { type: MarkerType.ArrowClosed },
			}) as Edge,
	);
	const ownTasks = data.tasks.filter(
		(x) => !x.deleted && x.assetId === asset?.id && !x.impactSnapshot,
	);
	const impactTasks = data.tasks
		.filter((task) =>
			!task.deleted && task.impactSnapshot?.accountId === asset?.id,
		)
		.sort((a, b) => a.done === b.done ? a.createdAt.localeCompare(b.createdAt) : Number(a.done) - Number(b.done));
	const impactCounts = {
		all: impactTasks.length,
		pending: impactTasks.filter((task) => !task.done).length,
		done: impactTasks.filter((task) => task.done).length,
	};
	const visibleImpactTasks = impactTasks.filter((task) =>
		impactFilter === "all" || (impactFilter === "done" ? task.done : !task.done),
	);
	const impactToGenerate = asset?.kind === "account"
		? buildImpactTasks(asset, data.relations, [...liveById.values()], data.tasks, new Date().toISOString(), (linked) => `${t("checkConnection")}: ${linked.name}`)
			.filter((task) => !generatedImpactKeys.current.has(task.dedupeKey))
		: [];
	const impactToUpgrade = asset?.kind === "account"
		? upgradeLegacyImpactTasks(asset, data.relations, [...liveById.values()], data.tasks, new Date().toISOString())
			.filter((task) => !generatedImpactKeys.current.has(task.dedupeKey))
		: [];
	const impactPendingCount = impactToGenerate.length + impactToUpgrade.length;
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
		if (!asset || relationInFlight.current) return;
		const target = data.assets.find((a) => a.id === relationTarget);
		if (
			!target ||
			target.deleted ||
			target.id === asset.id ||
			!relationLabel.trim()
		)
			return;
		if (
			relations.some(
				(r) =>
					r.from === asset.id &&
					r.to === target.id &&
					r.label.toLocaleLowerCase() ===
						relationLabel.trim().toLocaleLowerCase(),
			)
		) {
			setRelationError(t("relationDuplicate"));
			return;
		}
		relationInFlight.current = true;
		setRelationBusy(true);
		setRelationError("");
		try {
			await save("relation", {
				id: crypto.randomUUID(),
				from: asset.id,
				to: target.id,
				label: relationLabel.trim(),
				...(relationSource.trim() ? { source: relationSource.trim() } : {}),
				createdAt: new Date().toISOString(),
				verifiedAt: relationVerifiedAt,
				deleted: false,
			});
			setRelationEdit(false);
			setRelationLabel("");
			setRelationTarget("");
			setRelationSource("");
			setRelationVerifiedAt("");
			notify(t("saved"));
		} catch {
			setRelationError(t("error"));
		} finally {
			relationInFlight.current = false;
			setRelationBusy(false);
		}
	}
	async function confirmRelationDelete() {
		if (!relationToDelete || relationInFlight.current) return;
		relationInFlight.current = true;
		setRelationBusy(true);
		try {
			await deleteEntity("relation", relationToDelete.id);
			setRelationToDelete(null);
			notify(t("saved"));
		} catch {
			notify(t("error"));
		} finally {
			relationInFlight.current = false;
			setRelationBusy(false);
		}
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
		const note = historyNote.trim();
		if (action === "renew" && asset.dueDate) {
			const anchor = asset.billingAnchor || asset.dueDate;
			const count = (asset.renewalCount || 0) + 1;
			const charge = actualCharge(asset, asset.dueDate);
			if (charge === null) throw Error("renewal-inactive");
			const entered = renewalAmount.trim();
			const valid = asset.currency === "JPY" ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/;
			if (entered && !valid.test(entered)) throw Error("renewal-amount-invalid");
			const factor = asset.currency === "JPY" ? 1 : 100;
			const recordedAmount = entered ? Math.round(Number(entered) * factor) : charge;
			if (!Number.isSafeInteger(recordedAmount) || recordedAmount < 0) throw Error("renewal-amount-invalid");
			const historyId = crypto.randomUUID();
			update = {
				...update,
				billingAnchor: anchor,
				renewalCount: count,
				lastRenewalId: historyId,
				dueDate: dueOnCycle(anchor, asset.cycle, asset.interval, count),
			};
			await recordRenewal(asset, update, {
				id: historyId,
				assetId: asset.id,
				action: "renew",
				billDate: asset.dueDate,
				amount: recordedAmount,
				currency: asset.currency,
				note,
				createdAt: now,
				deleted: false,
			});
			setHistoryNote("");
			setRenewalAmount("");
			return;
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
	async function recordRenewalAction() {
		if (renewalInFlight.current) return;
		renewalInFlight.current = true;
		setRenewalBusy(true);
		try {
			setRenewalAmountError("");
			await recordAction("renew");
			setRenewalRecoveryPending(false);
			notify(t("saved"));
		} catch (error) {
			if (error instanceof Error && error.message === "renewal-amount-invalid") {
				setRenewalAmountError(t("invalid"));
			} else if (error instanceof Error && error.message === "renewal-stale") {
				notify(t("renewalStale"));
			} else if (error instanceof Error && error.message === "renewal-recovery-pending") {
				setRenewalRecoveryPending(true);
				notify(t("renewalRecoveryPending"));
			} else {
				notify(t("error"));
			}
		} finally {
			renewalInFlight.current = false;
			setRenewalBusy(false);
		}
	}
	async function createImpact() {
		if (!asset || impactInFlight.current || impactPendingCount === 0) return;
		impactInFlight.current = true;
		setImpactBusy(true);
		try {
			for (const task of impactToUpgrade) {
				await save("task", task);
				generatedImpactKeys.current.add(task.dedupeKey);
			}
			if (impactToGenerate.length) {
				await saveBatch(impactToGenerate.map((value) => ({ type: "task" as const, value })));
				for (const task of impactToGenerate) generatedImpactKeys.current.add(task.dedupeKey);
			}
			notify(t("saved"));
		} catch {
			notify(t("error"));
		} finally {
			impactInFlight.current = false;
			setImpactBusy(false);
		}
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
							onClick={() => {
								setRelationError("");
								setRelationEdit(true);
							}}
						>
							<Plus size={14} />
							{t("addRelation")}
						</Button>
					</div>
					{relations.length ? (
						<>
							{relations.length >= 5 && (
								<div className="field relation-filter">
									<label htmlFor="relation-filter">
										{t("filterRelations")}
									</label>
									<input
										id="relation-filter"
										type="search"
										value={relationFilter}
										onChange={(event) => setRelationFilter(event.target.value)}
									/>
								</div>
							)}
							<section className="graph" aria-label={t("relations")}>
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
											...visibleRelated.map((a, i) => ({
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
									edges={graphEdges}
									onNodeClick={(_, node) => {
										const target = liveById.get(node.id);
										if (target && target.id !== asset.id)
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
							</section>
							{visibleRelations.length ? (
								<div className="list relation-list">
									{visibleRelations.map((relation) => {
										const neighbor = liveById.get(
											relation.from === asset.id ? relation.to : relation.from,
										);
										if (!neighbor) return null;
										return (
											<div className="list-row relation-row" key={relation.id}>
												<div className="relation-info">
													<Link
														to="/assets/$kind/$id"
														params={{ kind: neighbor.kind, id: neighbor.id }}
													>
														<strong>{neighbor.name}</strong>
													</Link>
													<small>
														{liveById.get(relation.from)?.name} →{" "}
														{liveById.get(relation.to)?.name} · {relation.label}
													</small>
													{(relation.source || relation.verifiedAt) && (
														<small>
															{relation.source &&
																`${t("relationSource")}: ${relation.source}`}
															{relation.source && relation.verifiedAt && " · "}
															{relation.verifiedAt &&
																`${t("verifiedAt")}: ${date(relation.verifiedAt, i18n.language)}`}
														</small>
													)}
												</div>
												<Button
													variant="ghost"
													size="small"
													aria-label={`${t("deleteRelation")} · ${relation.label} · ${neighbor.name}`}
													onClick={() => setRelationToDelete(relation)}
												>
													{t("remove")}
												</Button>
											</div>
										);
									})}
								</div>
							) : (
								<Empty hint={false} />
							)}
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
				</section>
			</div>
			{asset.kind === "account" && (
				<section className="card impact-checklist">
					<div className="card-header">
						<div>
							<h2>{t("impact")}</h2>
							<p>{t("impactHint")}</p>
						</div>
						<Button
							size="small"
							disabled={impactBusy || impactPendingCount === 0}
							onClick={() => void createImpact()}
						>
							{t("makeChecklist")} · {impactPendingCount}
						</Button>
					</div>
					<p className="subtitle">{t("impactSnapshotHint")}</p>
					{impactPendingCount > 0 && (
						<p className="notice" role="status">
							{t("impactNewRelations", { count: impactPendingCount })}
						</p>
					)}
					<fieldset className="tabs task-filters" aria-label={t("taskFilter")}>
						{(["all", "pending", "done"] as const).map((value) => (
							<button
								type="button"
								key={value}
								aria-pressed={impactFilter === value}
								onClick={() => setImpactFilter(value)}
							>
								{t(value)} · {impactCounts[value]}
							</button>
						))}
					</fieldset>
					{visibleImpactTasks.length ? (
						<div className="list">
							{visibleImpactTasks.map((task) => (
								<ImpactTaskRow task={task} showTaskLink key={task.id} />
							))}
						</div>
					) : <Empty hint={false} />}
				</section>
			)}
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
					{asset.kind === "subscription" && renewalRecoveryPending && <p className="notice" role="alert">{t("renewalRecoveryPending")}</p>}
					<div className="toolbar">
						{asset.kind === "subscription" ? (
							<Button
									disabled={asset.status !== "active" || !asset.dueDate || renewalBusy}
									onClick={() => void recordRenewalAction()}
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
						{asset.kind === "subscription" && (
							<label className="renewal-amount-field">
								<span>{t("recordedAmount")} ({asset.currency})</span>
								<input
									type="number"
									min="0"
									step={asset.currency === "JPY" ? "1" : "0.01"}
									value={renewalAmount}
									onChange={(event) => { setRenewalAmount(event.target.value); setRenewalAmountError(""); }}
									aria-invalid={!!renewalAmountError}
									placeholder={dueCharge === null ? "" : String(dueCharge / (asset.currency === "JPY" ? 1 : 100))}
								/>
								{renewalAmountError && <small role="alert">{renewalAmountError}</small>}
							</label>
						)}
					</div>
					{asset.kind === "subscription" && <p className="subtitle">{t("renewalLocalHint")}</p>}
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
											{h.action === "renew" && h.billDate && h.amount !== undefined && h.currency
												? ` · ${date(h.billDate, i18n.language)} · ${t("recordedAmount")}: ${money(h.amount, h.currency, i18n.language)}`
												: ""}
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
				<Dialog
					title={t("addRelation")}
					onClose={() => {
						if (!relationInFlight.current) setRelationEdit(false);
					}}
				>
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
						<div className="field">
							<label htmlFor="relation-source">{t("relationSource")}</label>
							<input
								id="relation-source"
								value={relationSource}
								onChange={(e) => setRelationSource(e.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="relation-verified">{t("verifiedAt")}</label>
							<input
								id="relation-verified"
								type="date"
								value={relationVerifiedAt}
								onChange={(e) => setRelationVerifiedAt(e.target.value)}
							/>
						</div>
					</div>
					{relationError && (
						<p className="field-error" role="alert">
							{relationError}
						</p>
					)}
					<div className="actions">
						<Button
							variant="primary"
							disabled={
								!relationTarget || !relationLabel.trim() || relationBusy
							}
							onClick={() => void addRelation()}
						>
							{t("save")}
						</Button>
					</div>
				</Dialog>
			)}
			{relationToDelete && (
				<Dialog
					title={t("deleteRelation")}
					onClose={() => {
						if (!relationInFlight.current) setRelationToDelete(null);
					}}
				>
					<p>{t("deleteRelationConfirm", { label: relationToDelete.label })}</p>
					<div className="actions">
						<Button
							disabled={relationBusy}
							onClick={() => setRelationToDelete(null)}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={relationBusy}
							onClick={() => void confirmRelationDelete()}
						>
							{t("deleteRelation")}
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
