import { assetNotes } from "./asset-notes";
import { relationTargetLabels } from "./relation-target-labels";
import { accountFamilyGraph, consumeGraphReturn, graphReturnTarget, graphViewState, recoverableGraphRelations, rememberGraphVisit } from "./account-family-graph";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowDownRight, ArrowLeft, Check, ExternalLink, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	type Asset,
	assetSchema,
	type ProjectDomain,
	type ProjectMedia,
	type ItemMedia,
	type Submission,
	type Relation,
	actualCharge,
	effectiveFinanceEntry,
	historyAssetIds,
	dueOnCycle,
	inputFromMinorUnits,
	itemLifecycleStatuses,
	monthlyMinorUnits,
	parseMinorUnits,
	projectDomainSchema,
	relationSchema,
	submissionSchema,
} from "../../../packages/domain/src";
import { buildImpactTasks, upgradeLegacyImpactTasks } from "../../../packages/domain/src/impact";
import {
	cleanupUnreferencedFile,
	deleteAssetIfCurrent,
	fileUrl,
	localRepository,
	putFile,
	recordItemAction as commitItemAction,
	recordRenewal,
	save,
	saveAssetIfCurrent,
	saveSubmissionIfCurrent,
	deleteSubmissionIfCurrent,
	restoreSubmissionIfCurrent,
	saveBatch,
	setItemArchived,
} from "../../../packages/local-db/src";
import { TextLink } from "./components/ui/text-link";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import "./asset-restoration.css";
import "./relation-direction.css";
import "./account-detail.css";
import "./backlink-ledger.css";
import "./workspaces.css";
import { readWorkspaceReturn } from "./workspace-return";
import { ProjectPreview } from "./page-asset-list";
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
import { Select, SelectOption } from "./components/ui/select";
const AssetEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.AssetEditor })),
);
const TaskEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.TaskEditor })),
);
const AccountFamilyGraphView = lazy(() => import("./account-family-graph-view").then((module) => ({ default: module.AccountFamilyGraphView })));
const PasswordVaultPanel = lazy(() => import("./components/PasswordVaultPanel").then((module) => ({ default: module.PasswordVaultPanel })));
function validCalendarDay(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T12:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function localCalendarDay(now: Date) {
	return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function ImageTile({ id }: { id: string }) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		let active = true;
		let current = "";
		setUrl("");
		void fileUrl(id).then((v) => {
			current = v;
			if (active) setUrl(v);
			else if (v) URL.revokeObjectURL(v);
		}).catch(() => { if (active) setUrl(""); });
		return () => {
			active = false;
			if (current) URL.revokeObjectURL(current);
		};
	}, [id]);
	return url ? <img src={url} alt="" className="asset-image" /> : null;
}

const submissionStatuses = ["planned", "submitted", "review", "indexed", "verify", "rejected"] as const;
type ProjectImageRole = "logoId" | "homeScreenshotId" | "productScreenshotIds" | "promoCoverId" | "other";
const emptyProjectMedia: ProjectMedia = { logoId: "", homeScreenshotId: "", productScreenshotIds: [], promoCoverId: "" };
type ItemImageRole = "coverId" | "detailIds" | "receiptIds" | "other";
const emptyItemMedia: ItemMedia = { coverId: "", detailIds: [], receiptIds: [] };
const itemLocationSeparator = " \u2063› ";
function itemLocationParts(location: string): [string, string, string] {
	if (!location.includes(itemLocationSeparator)) return [location, "", ""];
	const parts = location.split(itemLocationSeparator);
	return parts.length === 3 ? [parts[0], parts[1], parts[2]] : [location, "", ""];
}

function SubmissionRow({ submission }: { submission: Submission }) {
	const { t, i18n } = useTranslation();
	const { notify } = useAppContext();
	const [editing, setEditing] = useState(false);
	const [editBase, setEditBase] = useState(submission);
	const [conflict, setConflict] = useState(false);
	const [name, setName] = useState(submission.name);
	const [url, setUrl] = useState(submission.url);
	const [status, setStatus] = useState<Submission["status"]>(submission.status);
	const [evidence, setEvidence] = useState(submission.evidence);
	const [submittedAt, setSubmittedAt] = useState(submission.submittedAt);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [deleteBase, setDeleteBase] = useState<Submission | null>(null);
	const [deleteError, setDeleteError] = useState("");
	const [deleteStale, setDeleteStale] = useState(false);
	useEffect(() => {
		if (editing) return;
		setName(submission.name);
		setUrl(submission.url);
		setStatus(submission.status);
		setEvidence(submission.evidence);
		setSubmittedAt(submission.submittedAt);
	}, [editing, submission.name, submission.url, submission.status, submission.evidence, submission.submittedAt]);
	const changed =
		name !== editBase.name ||
		url !== editBase.url ||
		status !== editBase.status ||
		evidence !== editBase.evidence ||
		submittedAt !== editBase.submittedAt;
	function cancel() {
		if (inFlight.current) return;
		setName(submission.name);
		setUrl(submission.url);
		setStatus(submission.status);
		setEvidence(submission.evidence);
		setSubmittedAt(submission.submittedAt);
		setError("");
		setConflict(false);
		setEditing(false);
	}
	async function store() {
		if (inFlight.current) return;
		if (!name.trim() || name.trim().length > 200 || !submissionSchema.shape.url.safeParse(url.trim()).success) {
			setError(t("invalid"));
			return;
		}
		if (status !== "planned" && !evidence.trim()) {
			setError(t("evidenceRequired"));
			return;
		}
		if (status === "indexed" && !submissionSchema.shape.url.safeParse(evidence.trim()).success) {
			setError(t("invalid"));
			return;
		}
		if (status !== "planned" && (!submittedAt || !validCalendarDay(submittedAt))) {
			setError(t("submittedDateRequired"));
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			const verifiedAt = ["indexed", "rejected"].includes(status)
				? status !== editBase.status || evidence.trim() !== editBase.evidence
					? localCalendarDay(new Date())
					: editBase.verifiedAt
				: "";
			await saveSubmissionIfCurrent(editBase, {
				...editBase,
				name: name.trim(),
				url: url.trim(),
				status,
				evidence: evidence.trim(),
				submittedAt: status === "planned" ? "" : submittedAt,
				verifiedAt,
			});
			setEditing(false);
			notify(t("saved"));
		} catch (cause) {
			if (cause instanceof Error && cause.message === "submission-stale") setConflict(true);
			else setError(t("error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<tr className={editing ? "backlink-row-editing" : undefined}>
			<td>
				{editing ? <><strong className="backlink-edit-name">{submission.name}</strong><input className="field" disabled={busy} aria-label={`${submission.name} ${t("name")}`} value={name} onChange={(event) => { setName(event.target.value); setError(""); }} /><input className="field" disabled={busy} type="url" aria-label={`${submission.name} ${t("url")}`} value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} /></> : <TextLink href={submission.url} target="_blank" rel="noopener noreferrer">
					<span>{submission.name}</span>
				</TextLink>}
				{submission.externalLink && <small>{t("extImportedSource")} · {submission.externalLink.profileId}</small>}
				{conflict && <small className="field-error" role="alert">{t("assetStale")}</small>}
			</td>
			<td>
				{editing ? <Select
					className="field" disabled={busy}
					aria-label={`${submission.name} ${t("status")}`}
					value={status}
					onValueChange={(selectValue) => { setStatus(selectValue as Submission["status"]); setError(""); }}
				>
					{submissionStatuses.map((value) => (
						<SelectOption key={value} value={value}>
							{t(value)}
						</SelectOption>
					))}
				</Select> : <span className={`backlink-status backlink-status-${submission.status}`}>{t(submission.status)}</span>}
			</td>
			<td>
				{editing ? <input
					className="field" disabled={busy}
					type="date"
					aria-label={`${submission.name} ${t("submittedAt")}`}
					value={submittedAt}
					onChange={(e) => { setSubmittedAt(e.target.value); setError(""); }}
				/> : date(submission.submittedAt, i18n.language)}
			</td>
			<td>{date(submission.verifiedAt, i18n.language)}</td>
			<td>
				{editing ? <input
					className="field" disabled={busy}
					aria-label={`${submission.name} ${t("evidence")}`}
					value={evidence}
					onChange={(e) => { setEvidence(e.target.value); setError(""); }}
				/> : submission.evidence ? submissionSchema.shape.url.safeParse(submission.evidence).success ? <TextLink href={submission.evidence} target="_blank" rel="noopener noreferrer"><span>{submission.evidence}</span></TextLink> : <span>{submission.evidence}</span> : "—"}
				{error && (
					<small className="field-error" role="alert">
						{error}
					</small>
				)}
			</td>
			<td>
				<div className="backlink-row-actions">
				{editing ? <><Button
					size="small"
					disabled={!changed || busy || conflict}
					onClick={() => void store()}
				>
					{t("save")}
				</Button><Button size="small" disabled={busy} onClick={cancel}>{t("cancel")}</Button></> : <Button size="small" onClick={() => {
					setEditBase(submission);
					setName(submission.name);
					setUrl(submission.url);
					setStatus(submission.status);
					setEvidence(submission.evidence);
					setSubmittedAt(submission.submittedAt);
					setError("");
					setConflict(false);
					setEditing(true);
				}}>{t(submission.status === "verify" ? "backlinkCheck" : submission.status === "planned" ? "edit" : "backlinkUpdate")}</Button>}
				{!editing && <Button size="small" disabled={busy} onClick={() => { setDeleteBase(submission); setDeleteError(""); setDeleteStale(false); }}>{t("backlinkDeleteAction")}</Button>}
				</div>
				{deleteBase && <Dialog title={t("backlinkDelete")} closeDisabled={busy} onClose={() => { if (!inFlight.current) setDeleteBase(null); }}>
					<p>{t("backlinkDeleteConfirm", { name: deleteBase.name })}</p>
					{deleteError && <p className="field-error" role="alert">{deleteError}</p>}
					<div className="actions"><Button disabled={busy} onClick={() => setDeleteBase(null)}>{t("cancel")}</Button><Button variant="danger" disabled={busy || deleteStale} onClick={async () => {
						if (inFlight.current) return;
						inFlight.current = true; setBusy(true);
						try { await deleteSubmissionIfCurrent(deleteBase); setDeleteBase(null); notify(t("saved")); }
						catch (cause) { const stale = cause instanceof Error && cause.message === "submission-stale"; setDeleteStale(stale); setDeleteError(t(stale ? "assetStale" : "error")); }
						finally { inFlight.current = false; setBusy(false); }
					}}>{t("backlinkDeleteAction")}</Button></div>
				</Dialog>}
			</td>
		</tr>
	);
}

function DeletedSubmission({ submission }: { submission: Submission }) {
	const { t, i18n } = useTranslation(), { notify } = useAppContext();
	const [busy, setBusy] = useState(false), [error, setError] = useState("");
	const inFlight = useRef(false);
	return <div className="list-row" data-deleted-submission-id={submission.id}>
		<div><strong>{submission.name}</strong><small>{t(submission.status)}{submission.externalLink?.profileId ? ` · ${submission.externalLink.profileId}` : ""}</small><small>{t("submittedAt")}: {date(submission.submittedAt, i18n.language)} · {t("verifiedAt")}: {date(submission.verifiedAt, i18n.language)}</small>{submission.evidence && <small>{submission.evidence}</small>}{error && <p className="field-error" role="alert">{error}</p>}</div>
		<Button disabled={busy} aria-label={`${t("restore")} · ${submission.name}`} onClick={async () => {
			if (inFlight.current) return;
			inFlight.current = true; setBusy(true); setError("");
			try { await restoreSubmissionIfCurrent(submission); notify(t("saved")); }
			catch (cause) { setError(t(cause instanceof Error && cause.message === "submission-stale" ? "backlinkRestoreChanged" : "error")); }
			finally { inFlight.current = false; setBusy(false); }
		}}>{t("restore")}</Button>
	</div>;
}

export function AssetDetail() {
	const params = (useRouterState({ select: (s) => s.matches.at(-1)?.params }) ??
		{}) as { kind?: string; id?: string };
	const kind = validKind(params.kind ?? "project");
	const detailHash = useRouterState({ select: (state) => state.location.hash });
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const imageInput = useRef<HTMLInputElement>(null);
	const asset = data.assets.find(
		(a) => a.id === params.id && a.kind === kind && !a.deleted,
	);
	const [edit, setEdit] = useState(false);
	const [passwordsFor, setPasswordsFor] = useState<string | null>(null);
	const passwordsOpen = !!asset && passwordsFor === asset.id;
	useEffect(() => {
		if (!asset?.id || asset.kind !== "project" || !detailHash.startsWith("project-domain")) return;
		const frame = requestAnimationFrame(() => document.getElementById(detailHash)?.scrollIntoView({ block: "start" }));
		return () => cancelAnimationFrame(frame);
	}, [asset?.id, asset?.kind, detailHash]);
	const [deleteBase, setDeleteBase] = useState<Asset | null>(null);
	const [deleteError, setDeleteError] = useState("");
	const [deleteBusy, setDeleteBusy] = useState(false);
	const deleteInFlight = useRef(false);
	const deleteScope = useRef({ id: params.id, kind, active: true });
	useEffect(() => {
		const scope = { id: params.id, kind, active: true };
		deleteScope.current = scope;
		setDeleteBase(null);
		setDeleteError("");
		return () => { scope.active = false; };
	}, [params.id, kind]);
	const [reactivateProjectBase, setReactivateProjectBase] = useState<Asset | null>(null);
	const [reactivateProjectBusy, setReactivateProjectBusy] = useState(false);
	const [reactivateProjectError, setReactivateProjectError] = useState("");
	const [reactivateProjectStale, setReactivateProjectStale] = useState(false);
	const reactivateProjectInFlight = useRef(false);
	const [relationEdit, setRelationEdit] = useState(false);
	const [relationEditBase, setRelationEditBase] = useState<Relation | null>(null);
	const [relationStale, setRelationStale] = useState(false);
	const [relationToDelete, setRelationToDelete] = useState<Relation | null>(
		null,
	);
	const [relationDeleteError, setRelationDeleteError] = useState("");
	const [relationBusy, setRelationBusy] = useState(false);
	const relationInFlight = useRef(false);
	const [relationError, setRelationError] = useState("");
	const [relationFilter, setRelationFilter] = useState("");
	const [relationDetailsOpen, setRelationDetailsOpen] = useState(false);
	const [graphScope, setGraphScope] = useState<"direct" | "family">("direct");
	const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState<string | null>(null);
	const [relationRestoreError, setRelationRestoreError] = useState("");
	const centerId = asset?.id;
	const graphReturn = centerId ? graphReturnTarget(centerId) : undefined;
	const relationReturnId = sessionStorage.getItem("keepany-relation-return-id");
	const relationReturnKind = sessionStorage.getItem("keepany-relation-return-kind");
	const returnKind = relationReturnId === asset?.id && relationReturnKind && validKind(relationReturnKind) === relationReturnKind ? relationReturnKind : kind;
	const catalogReturn = returnKind === kind && asset ? readWorkspaceReturn(asset.id) : null;
	function visitRelation(target: Asset) {
		if (!asset || target.id === asset.id) return;
		rememberGraphVisit(asset, target);
		if (relationReturnId !== asset.id || !relationReturnKind) sessionStorage.setItem("keepany-relation-return-kind", kind);
		sessionStorage.setItem("keepany-relation-return-id", target.id);
		void navigate({ to: "/assets/$kind/$id", params: { kind: target.kind, id: target.id }, hash: "account-relations" });
	}
	useEffect(() => {
		if (centerId) {
			const state = graphViewState(centerId);
			setRelationFilter(state.filter); setRelationDetailsOpen(state.detailsOpen); setSelectedGraphEdgeId(state.selected); setGraphScope(state.scope);
			setRelationEdit(false); setRelationEditBase(null); setRelationToDelete(null); setRelationRestoreError("");
		}
	}, [centerId]);
	function changeGraphScope(scope: "direct" | "family") {
		setSelectedGraphEdgeId(null);
		setGraphScope(scope);
		if (centerId) { graphViewState(centerId).scope = scope; graphViewState(centerId).selected = null; }
	}
	function selectGraphEdge(id: string | null) { setSelectedGraphEdgeId(id); if (centerId) graphViewState(centerId).selected = id; }
	function openRelationEditor(relation?: Relation) {
		setRelationEditBase(relation ?? null); setRelationStale(false); setRelationError("");
		setRelationLabel(relation?.label ?? ""); setRelationSource(relation?.source ?? "");
		setRelationLabelTouched(false);
		setRelationVerifiedAt(relation?.verifiedAt ? validCalendarDay(relation.verifiedAt.slice(0, 10)) ? relation.verifiedAt.slice(0, 10) : relation.verifiedAt : "");
		setRelationTarget(relation ? relation.from === centerId ? relation.to : relation.from : "");
		setRelationDirection(relation && relation.from !== centerId ? "incoming" : "outgoing");
		setRelationEdit(true);
	}
	const [submissionEdit, setSubmissionEdit] = useState(false);
	const [backlinkFilter, setBacklinkFilter] = useState<"all" | Submission["status"]>("all");
	const [backlinksOpen, setBacklinksOpen] = useState(false);
	const [materialsOpen, setMaterialsOpen] = useState(false);
	const [domainEditing, setDomainEditing] = useState<string | null>(null);
	const [domainDraft, setDomainDraft] = useState<ProjectDomain | null>(null);
	const [domainBase, setDomainBase] = useState<Asset | null>(null);
	const [domainDeleteConfirm, setDomainDeleteConfirm] = useState(false);
	const [domainFee, setDomainFee] = useState("");
	const [domainError, setDomainError] = useState("");
	const [domainBusy, setDomainBusy] = useState(false);
	const domainInFlight = useRef(false);
	const [submissionNameError, setSubmissionNameError] = useState("");
	const [submissionUrlError, setSubmissionUrlError] = useState("");
	const [submissionSaveError, setSubmissionSaveError] = useState("");
	const [submissionBusy, setSubmissionBusy] = useState(false);
	const submissionInFlight = useRef(false);
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
	const imageInFlight = useRef(false);
	const [pendingImage, setPendingImage] = useState<File | null>(null);
	const [replaceImageId, setReplaceImageId] = useState("");
	const [projectImageRole, setProjectImageRole] = useState<ProjectImageRole>("other");
	const [itemImageRole, setItemImageRole] = useState<ItemImageRole>("other");
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
	const [relationDirection, setRelationDirection] = useState<"outgoing" | "incoming">("outgoing");
	const [relationLabel, setRelationLabel] = useState("");
	const [relationLabelTouched, setRelationLabelTouched] = useState(false);
	const [relationSource, setRelationSource] = useState("");
	const [relationVerifiedAt, setRelationVerifiedAt] = useState("");
	const [submissionName, setSubmissionName] = useState("");
	const [submissionUrl, setSubmissionUrl] = useState("");
	const [submissionStatus, setSubmissionStatus] = useState<Submission["status"]>("planned");
	const [submissionDate, setSubmissionDate] = useState("");
	const [submissionEvidence, setSubmissionEvidence] = useState("");
	const [historyNote, setHistoryNote] = useState("");
	const [itemBorrower, setItemBorrower] = useState("");
	const [itemExpectedReturnDate, setItemExpectedReturnDate] = useState("");
	const [itemLoanNote, setItemLoanNote] = useState("");
	const [itemReturnBase, setItemReturnBase] = useState<Asset | null>(null);
	const [locationOpen, setLocationOpen] = useState(false);
	const [locationArea, setLocationArea] = useState("");
	const [locationContainer, setLocationContainer] = useState("");
	const [locationSpot, setLocationSpot] = useState("");
	const [locationError, setLocationError] = useState("");
	const [locationBusy, setLocationBusy] = useState(false);
	const locationInFlight = useRef(false);
	const [itemMaintenanceNote, setItemMaintenanceNote] = useState("");
	const [itemEventDate, setItemEventDate] = useState(() => localCalendarDay(new Date()));
	const itemDateManuallySet = useRef(false);
	const [itemReminderDate, setItemReminderDate] = useState("");
	const [itemError, setItemError] = useState("");
	const [itemStatusOpen, setItemStatusOpen] = useState(false);
	const [itemStatusDraft, setItemStatusDraft] = useState<NonNullable<Asset["itemLifecycleStatus"]>>("inUse");
	const [itemStatusDateDraft, setItemStatusDateDraft] = useState(() => localCalendarDay(new Date()));
	const [itemStatusNote, setItemStatusNote] = useState("");
	const [itemStatusError, setItemStatusError] = useState("");
	const [itemRecoveryPending, setItemRecoveryPending] = useState(false);
	const [itemBusy, setItemBusy] = useState(false);
	const itemInFlight = useRef(false);
	const [renewalAmount, setRenewalAmount] = useState("");
	const [renewalAmountError, setRenewalAmountError] = useState("");
	const [renewalBusy, setRenewalBusy] = useState(false);
	const [renewalRecoveryPending, setRenewalRecoveryPending] = useState(false);
	const renewalInFlight = useRef(false);
	useEffect(() => {
		if (!params.id) return;
		setItemReturnBase(null);
		itemDateManuallySet.current = false;
		setItemEventDate(localCalendarDay(new Date()));
	}, [params.id]);
	useEffect(() => {
		let timer = 0;
		function refreshAutomaticDate() {
			if (!itemDateManuallySet.current) setItemEventDate(localCalendarDay(new Date()));
		}
		function scheduleMidnight() {
			const now = new Date();
			const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
			timer = window.setTimeout(() => {
				refreshAutomaticDate();
				scheduleMidnight();
			}, Math.max(1, next - now.getTime() + 50));
		}
		scheduleMidnight();
		window.addEventListener("focus", refreshAutomaticDate);
		document.addEventListener("visibilitychange", refreshAutomaticDate);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("focus", refreshAutomaticDate);
			document.removeEventListener("visibilitychange", refreshAutomaticDate);
		};
	}, []);
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
	useEffect(() => {
		if (kind !== "item") return;
		let active = true;
		void localRepository().then(repository => {
			if (active) setItemRecoveryPending(!!repository.renewalRecoveryError);
		}).catch(() => {
			if (active) setItemRecoveryPending(true);
		});
		return () => { active = false; };
	}, [kind]);
	const liveById = useMemo(() => new Map(data.assets.filter((entry) => !entry.deleted).map((item) => [item.id, item])), [data.assets]);
	const relations = useMemo(() => data.relations.filter(
		(r) =>
			!r.deleted &&
			(r.from === asset?.id || r.to === asset?.id) &&
			liveById.has(r.from) &&
			liveById.has(r.to),
	), [data.relations, asset?.id, liveById]);
	const normalizedFilter = relationFilter.trim().toLocaleLowerCase();
	const family = useMemo(() => centerId ? accountFamilyGraph(centerId, liveById, data.relations) : null, [centerId, liveById, data.relations]);
	const scopedRelations = graphScope === "family" ? family?.relations ?? relations : relations;
	const visibleRelations = normalizedFilter
		? scopedRelations.filter((relation) => {
				const from = liveById.get(relation.from), to = liveById.get(relation.to);
				return [from?.name, from?.username, to?.name, to?.username, relation.label, relation.source].some((value) =>
					value?.toLocaleLowerCase().includes(normalizedFilter),
				);
			})
		: scopedRelations;
	const visibleRelated = Array.from(
		new Map(
			visibleRelations.map((r) => {
				const neighbor = liveById.get(r.from === asset?.id ? r.to : r.from);
				return [neighbor?.id, neighbor] as const;
			}),
		).values(),
	).filter((item): item is Asset => !!item);
	const displayedFamily = useMemo(() => family && centerId ? graphScope === "family" ? family : accountFamilyGraph(centerId, liveById, relations) : null, [family, centerId, graphScope, liveById, relations]);
	const graphRelated = displayedFamily?.neighbors ?? visibleRelated;
	const directCount = new Set(relations.map((relation) => relation.from === asset?.id ? relation.to : relation.from)).size;
	const graphMatches = new Set<string>();
	if (normalizedFilter) {
		for (const entry of [asset, ...graphRelated])
			if (entry && [entry.name, entry.username].some((value) => value.toLocaleLowerCase().includes(normalizedFilter))) graphMatches.add(entry.id);
		for (const relation of visibleRelations) {
			if ([relation.label, relation.source].some((value) => value?.toLocaleLowerCase().includes(normalizedFilter))) {
				graphMatches.add(relation.from); graphMatches.add(relation.to);
			}
		}
	}
	const recoverableIds = useMemo(() => new Set(centerId ? recoverableGraphRelations(centerId, data.assets, data.relations).map(relation => relation.id) : []), [centerId, data.assets, data.relations]);
	const deletedRelations = data.relations.filter(relation => relation.deleted && !relation.purged
		&& (graphViewState(centerId ?? "").removed?.includes(relation.id) || relation.from === centerId || relation.to === centerId || recoverableIds.has(relation.id)));
	const ownTasks = data.tasks.filter(
		(x) => !x.deleted && x.assetId === asset?.id && !x.impactSnapshot,
	);
	const maintenanceTask = ownTasks.filter((task) => task.maintenancePlan)
		.sort((a, b) => Number(!!b.maintenancePlan?.active) - Number(!!a.maintenancePlan?.active) || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))[0];
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
	const deletedSubmissions = data.submissions.filter(x => x.deleted && !x.purged && x.assetId === asset?.id);
	const relatedAssets = Array.from(new Map(relations.map((relation) => {
		const linked = liveById.get(relation.from === asset?.id ? relation.to : relation.from);
		return [linked?.id, linked] as const;
	})).values()).filter((linked): linked is Asset => !!linked);
	const relatedAccounts = relatedAssets.filter((linked) => linked.kind === "account");
	const accountVerifiedAt = relations.map((relation) => relation.verifiedAt).filter(Boolean).sort().at(-1) ?? "";
	const relatedSubscriptions = relatedAssets.filter((linked) => linked.kind === "subscription" && linked.status === "active");
	const pendingBacklinks = submissions.filter((entry) => entry.status === "verify");
	const histories = data.history
		.filter((x) => !x.deleted && x.assetId === asset?.id)
		.map(entry => entry.action === "renew" ? entry : effectiveFinanceEntry(entry))
		.filter(entry => !entry.deleted)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const assetBills = data.history
		.filter(entry => historyAssetIds(entry).includes(asset?.id ?? ""))
		.map(effectiveFinanceEntry)
		.filter(entry => !entry.deleted && ["expense", "topup", "refund", "balance", "renew"].includes(entry.action))
		.sort((a, b) => (b.eventDate || b.billDate || b.createdAt).localeCompare(a.eventDate || a.billDate || a.createdAt));
	if (!asset)
		return (
			<main className="page">
				<PageTitle title={t("noMatches")} />
				<TextLink asChild><Link to="/assets/$kind" params={{ kind }}>
					{t("back")}
				</Link></TextLink>
			</main>
		);
	const dueCharge =
		asset.kind === "subscription" && asset.dueDate
			? actualCharge(asset, asset.dueDate)
			: null;
	const projectDomains = asset.kind === "project" ? (asset.projectDomains ?? []) : [];
	const projectMedia = asset.projectMedia ?? emptyProjectMedia;
	const itemMedia = asset.itemMedia ?? emptyItemMedia;
	const assignedProjectImages = new Set([
		projectMedia.logoId, projectMedia.homeScreenshotId, projectMedia.promoCoverId,
		...projectMedia.productScreenshotIds,
	].filter(Boolean));
	const assignedItemImages = new Set([itemMedia.coverId, ...itemMedia.detailIds, ...itemMedia.receiptIds].filter(Boolean));
	const visibleAttachmentIds = asset.kind === "project"
		? asset.attachments.filter((id) => !assignedProjectImages.has(id))
		: asset.kind === "item" ? asset.attachments.filter((id) => !assignedItemImages.has(id)) : asset.attachments;
	const monthlyByCurrency = new Map<string, bigint>();
	for (const linked of relatedSubscriptions) monthlyByCurrency.set(linked.currency, (monthlyByCurrency.get(linked.currency) ?? 0n) + monthlyMinorUnits(linked));
	const annualByCurrency = new Map<string, bigint>();
	for (const [currency, value] of monthlyByCurrency) annualByCurrency.set(currency, value * 12n);
	for (const domain of projectDomains) if (domain.annualAmount !== null) annualByCurrency.set(domain.currency, (annualByCurrency.get(domain.currency) ?? 0n) + BigInt(domain.annualAmount));
	const formatTotals = (totals: Map<string, bigint>) => totals.size ? Array.from(totals, ([currency, amount]) => money(amount, currency, i18n.language)).join(" + ") : "—";
	const today = localCalendarDay(new Date());
	const nextRenewal = [...projectDomains.map((domain) => domain.expiryDate), ...relatedSubscriptions.map((linked) => linked.dueDate)].filter((value) => value && value >= today).sort()[0] ?? "";
	const incompleteCost = projectDomains.some((domain) => domain.annualAmount === null);
	function scrollToFold(id: string, open: (value: boolean) => void) {
		open(true);
		requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
	}
	function openDomain(domain?: ProjectDomain) {
		if (asset?.kind !== "project") return;
		const next = domain ?? { id: crypto.randomUUID(), name: "", registrar: "", accountId: "", expiryDate: "", annualAmount: null, currency: "CNY", autoRenew: "unknown" } as ProjectDomain;
		setDomainBase(asset);
		setDomainDeleteConfirm(false);
		setDomainDraft(next);
		setDomainFee(next.annualAmount === null ? "" : inputFromMinorUnits(next.annualAmount, next.currency));
		setDomainEditing(domain?.id ?? "new");
		setDomainError("");
	}
	async function storeDomains(next: ProjectDomain[]) {
		if (domainBase?.kind !== "project") throw Error("asset-stale");
		await saveAssetIfCurrent(domainBase, { ...domainBase, projectDomains: next, updatedAt: new Date().toISOString() });
	}
	async function saveDomain() {
		if (!domainDraft || !domainEditing || !domainBase || domainInFlight.current || domainDeleteConfirm) return;
		const baseDomains = domainBase.projectDomains ?? [];
		let fee: number | null;
		try { fee = domainFee.trim() === "" ? null : parseMinorUnits(domainFee, domainDraft.currency); }
		catch { setDomainError(t("invalid")); return; }
		const parsed = projectDomainSchema.safeParse({ ...domainDraft, name: domainDraft.name.trim().toLowerCase(), annualAmount: fee });
		if (!parsed.success || (parsed.success && parsed.data.expiryDate && !validCalendarDay(parsed.data.expiryDate))) {
			setDomainError(t(!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "name") ? "projectDomainNameInvalid" : "invalid"));
			return;
		}
		if (baseDomains.some((domain) => domain.id !== domainEditing && domain.name.toLowerCase() === parsed.data.name.toLowerCase())) {
			setDomainError(t("duplicate"));
			return;
		}
		domainInFlight.current = true;
		setDomainBusy(true);
		setDomainError("");
		try {
			await storeDomains(domainEditing === "new" ? [...baseDomains, parsed.data] : baseDomains.map((entry) => entry.id === domainEditing ? parsed.data : entry));
			setDomainEditing(null);
			notify(t("saved"));
		} catch (error) {
			setDomainError(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally { domainInFlight.current = false; setDomainBusy(false); }
	}
	async function removeDomain() {
		if (!domainEditing || domainEditing === "new" || !domainBase || !domainDeleteConfirm || domainInFlight.current) return;
		domainInFlight.current = true;
		setDomainBusy(true);
		setDomainError("");
		try {
			await storeDomains((domainBase.projectDomains ?? []).filter((entry) => entry.id !== domainEditing));
			setDomainEditing(null);
			setDomainDeleteConfirm(false);
			notify(t("saved"));
		} catch (error) {
			setDomainError(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally { domainInFlight.current = false; setDomainBusy(false); }
	}
	async function confirmProjectReactivation() {
		const expected = reactivateProjectBase;
		if (expected?.kind !== "project" || expected.status !== "archived" || expected.deleted || reactivateProjectStale || reactivateProjectInFlight.current) return;
		reactivateProjectInFlight.current = true;
		setReactivateProjectBusy(true);
		setReactivateProjectError("");
		try {
			await saveAssetIfCurrent(expected, { ...expected, status: "active", updatedAt: new Date().toISOString() });
			setReactivateProjectBase(null);
			notify(t("saved"));
		} catch (cause) {
			const stale = cause instanceof Error && cause.message === "asset-stale";
			setReactivateProjectStale(stale);
			setReactivateProjectError(t(stale ? "assetStale" : "error"));
		} finally { reactivateProjectInFlight.current = false; setReactivateProjectBusy(false); }
	}
	async function confirmDelete() {
		if (!deleteBase || deleteBase.id !== params.id || deleteBase.kind !== kind || deleteInFlight.current) return;
		const expected = deleteBase;
		const scope = deleteScope.current;
		if (!scope.active || scope.id !== expected.id || scope.kind !== expected.kind) return;
		deleteInFlight.current = true;
		setDeleteBusy(true);
		setDeleteError("");
		try {
			await deleteAssetIfCurrent(expected);
			if (!scope.active || scope !== deleteScope.current) return;
			setDeleteBase(null);
			await navigate({ to: "/assets/$kind", params: { kind } });
			notify(t("saved"));
		} catch (error) {
			if (!scope.active || scope !== deleteScope.current) return;
			const reason = error instanceof Error ? error.message : "";
			setDeleteError(t(["asset-stale", "attachment-missing"].includes(reason) ? "assetDeleteStale" : "error"));
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
		) { setRelationError(t("graphRelationUnavailable")); return; }
		if (relationVerifiedAt && relationVerifiedAt !== relationEditBase?.verifiedAt && !validCalendarDay(relationVerifiedAt)) { setRelationError(t("graphInvalidDate")); return; }
		const from = relationEditBase?.from ?? (relationDirection === "incoming" ? target.id : asset.id);
		const to = relationEditBase?.to ?? (relationDirection === "incoming" ? asset.id : target.id);
		if (
			data.relations.some(
				(r) =>
					!r.deleted && r.id !== relationEditBase?.id && r.from === from &&
					r.to === to &&
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
			const next = relationSchema.parse({
				...(relationEditBase ?? {}),
				id: relationEditBase?.id ?? crypto.randomUUID(),
				from,
				to,
				label: relationLabel.trim(),
				source: relationSource.trim(),
				createdAt: relationEditBase?.createdAt ?? new Date().toISOString(),
				verifiedAt: relationEditBase && relationVerifiedAt === relationEditBase.verifiedAt.slice(0, 10) ? relationEditBase.verifiedAt : relationVerifiedAt,
				deleted: false,
			});
			if (relationEditBase) await (await localRepository()).saveRelationIfCurrent(relationEditBase, next);
			else await save("relation", next);
			setRelationEdit(false);
			setRelationEditBase(null);
			setRelationLabel("");
			setRelationLabelTouched(false);
			setRelationTarget("");
			setRelationSource("");
			setRelationVerifiedAt("");
			notify(t("saved"));
		} catch (error) {
			// Shared record CAS currently reports asset-stale for relation payload conflicts.
			const stale = !!relationEditBase && error instanceof Error && ["relation-stale", "asset-stale"].includes(error.message);
			setRelationStale(stale); setRelationError(t(stale ? "graphRelationStale" : error instanceof Error && error.message === "relation-endpoint" ? "graphRelationUnavailable" : "error"));
		} finally {
			relationInFlight.current = false;
			setRelationBusy(false);
		}
	}
	async function reviewLatestRelation() {
		if (!relationEditBase || relationInFlight.current) return;
		relationInFlight.current = true; setRelationBusy(true);
		try {
			const latest = await (await localRepository()).get<Relation>("relation", relationEditBase.id);
			if (!latest || latest.deleted) { setRelationError(t("graphRelationUnavailable")); return; }
			setRelationEditBase(latest); setRelationStale(false); setRelationError(t("graphRelationRebased"));
		} catch { setRelationError(t("error")); }
		finally { relationInFlight.current = false; setRelationBusy(false); }
	}
	async function confirmRelationDelete() {
		if (!relationToDelete || relationInFlight.current) return;
		relationInFlight.current = true;
		setRelationBusy(true);
		setRelationDeleteError("");
		try {
			const repository = await localRepository();
			await repository.saveRelationIfCurrent(relationToDelete, { ...relationToDelete, deleted: true });
			if (centerId) { const state = graphViewState(centerId); state.removed = [...new Set([...(state.removed ?? []), relationToDelete.id])]; }
			setRelationToDelete(null);
			selectGraphEdge(null);
			notify(t("relationDisconnected"));
		} catch {
			setRelationDeleteError(t("relationDisconnectError"));
		} finally {
			relationInFlight.current = false;
			setRelationBusy(false);
		}
	}
	async function restoreGraphRelation(relation: Relation) {
		if (relationInFlight.current) return;
		relationInFlight.current = true; setRelationBusy(true); setRelationRestoreError("");
		try {
			await (await localRepository()).restoreRelationIfCurrent(relation);
			notify(t("graphRelationRestored"));
		} catch { setRelationRestoreError(t("graphRestoreError")); }
		finally { relationInFlight.current = false; setRelationBusy(false); }
	}
	async function addSubmission() {
		if (!asset || submissionInFlight.current) return;
		const name = submissionName.trim();
		const url = submissionUrl.trim();
		const nameError = !name
			? t("required")
			: name.length > 200
				? t("submissionNameTooLong")
				: "";
		const urlError = !url
			? t("required")
			: submissionSchema.shape.url.safeParse(url).success
				? ""
				: t("submissionInvalidUrl");
		setSubmissionNameError(nameError);
		setSubmissionUrlError(urlError);
		const statusError = submissionStatus !== "planned" && !submissionEvidence.trim()
			? t("evidenceRequired")
			: submissionStatus === "indexed" && !submissionSchema.shape.url.safeParse(submissionEvidence.trim()).success
				? t("backlinkReceiptHint")
				: submissionStatus !== "planned" && (!submissionDate || !validCalendarDay(submissionDate))
					? t("submittedDateRequired")
					: "";
		setSubmissionSaveError(statusError);
		if (nameError || urlError || statusError) return;
		submissionInFlight.current = true;
		setSubmissionBusy(true);
		try {
			await save("submission", {
				id: crypto.randomUUID(),
				assetId: asset.id,
				name,
				url,
				status: submissionStatus,
				submittedAt: submissionStatus === "planned" ? "" : submissionDate,
				verifiedAt: submissionStatus === "indexed" || submissionStatus === "rejected" ? localCalendarDay(new Date()) : "",
				evidence: submissionEvidence.trim(),
				deleted: false,
			});
			setSubmissionEdit(false);
			setBacklinksOpen(true);
			setBacklinkFilter("all");
			setSubmissionName("");
			setSubmissionUrl("");
			setSubmissionStatus("planned");
			setSubmissionDate("");
			setSubmissionEvidence("");
			notify(t("saved"));
		} catch {
			setSubmissionSaveError(t("error"));
		} finally {
			submissionInFlight.current = false;
			setSubmissionBusy(false);
		}
	}
	function closeSubmission() {
		if (submissionInFlight.current) return;
		setSubmissionEdit(false);
		setSubmissionName("");
		setSubmissionUrl("");
		setSubmissionStatus("planned");
		setSubmissionDate("");
		setSubmissionEvidence("");
		setSubmissionNameError("");
		setSubmissionUrlError("");
		setSubmissionSaveError("");
	}
	function chooseImage(role: ProjectImageRole | ItemImageRole, replaceId = "") {
		if (asset?.kind === "item") setItemImageRole(role as ItemImageRole);
		else setProjectImageRole(role as ProjectImageRole);
		setReplaceImageId(replaceId);
		imageInput.current?.click();
	}
	async function addImage(file: File) {
		if (!asset || imageInFlight.current) return;
		imageInFlight.current = true;
		setUploading(true);
		let fileId = "";
		try {
			fileId = await putFile(file);
			const media: ProjectMedia = { ...emptyProjectMedia, ...asset.projectMedia,
				productScreenshotIds: [...(asset.projectMedia?.productScreenshotIds ?? [])] };
			const itemImages: ItemMedia = { ...emptyItemMedia, ...asset.itemMedia,
				detailIds: [...(asset.itemMedia?.detailIds ?? [])], receiptIds: [...(asset.itemMedia?.receiptIds ?? [])] };
			if (asset.kind === "project") {
				if (projectImageRole === "productScreenshotIds") {
					media.productScreenshotIds = replaceImageId
						? media.productScreenshotIds.map((id) => id === replaceImageId ? fileId : id)
						: [...media.productScreenshotIds, fileId];
				} else if (projectImageRole !== "other") media[projectImageRole] = fileId;
			}
			if (asset.kind === "item") {
				if (itemImageRole === "detailIds" || itemImageRole === "receiptIds") {
					itemImages[itemImageRole] = replaceImageId
						? itemImages[itemImageRole].map((id) => id === replaceImageId ? fileId : id)
						: [...itemImages[itemImageRole], fileId];
				} else if (itemImageRole === "coverId") itemImages.coverId = fileId;
			}
			const updatedAttachments = replaceImageId
				? asset.attachments.map((id) => id === replaceImageId ? fileId : id)
				: [...asset.attachments, fileId];
			await saveAssetIfCurrent(asset, {
				...asset,
				attachments: (asset.kind === "project" && projectImageRole === "homeScreenshotId") || (asset.kind === "item" && itemImageRole === "coverId")
					? [fileId, ...updatedAttachments.filter((id) => id !== fileId)] : updatedAttachments,
				projectMedia: media,
				itemMedia: itemImages,
				updatedAt: new Date().toISOString(),
			});
			if (replaceImageId) await cleanupUnreferencedFile(replaceImageId).catch(() => false);
			setPendingImage(null);
			setReplaceImageId("");
			setProjectImageRole("other");
			setItemImageRole("other");
			notify(t("saved"));
		} catch (error) {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "uploadError"));
		} finally {
			setUploading(false);
			imageInFlight.current = false;
		}
	}
	async function removeImage(id: string) {
		if (!asset || imageInFlight.current) return;
		imageInFlight.current = true;
		setUploading(true);
		try {
			const media: ProjectMedia = { ...emptyProjectMedia, ...asset.projectMedia,
				productScreenshotIds: (asset.projectMedia?.productScreenshotIds ?? []).filter((value) => value !== id) };
			const itemImages: ItemMedia = { ...emptyItemMedia, ...asset.itemMedia,
				detailIds: (asset.itemMedia?.detailIds ?? []).filter((value) => value !== id),
				receiptIds: (asset.itemMedia?.receiptIds ?? []).filter((value) => value !== id) };
			if (itemImages.coverId === id) itemImages.coverId = "";
			if (media.logoId === id) media.logoId = "";
			if (media.homeScreenshotId === id) media.homeScreenshotId = "";
			if (media.promoCoverId === id) media.promoCoverId = "";
			await saveAssetIfCurrent(asset, {
				...asset,
				attachments: asset.attachments.filter((attachmentId) => attachmentId !== id),
				projectMedia: media,
				itemMedia: itemImages,
				updatedAt: new Date().toISOString(),
			});
			await cleanupUnreferencedFile(id).catch(() => false);
			notify(t("saved"));
		} catch (error) {
			notify(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally {
			setUploading(false);
			imageInFlight.current = false;
		}
	}
	async function recordAction(
		action: "renew",
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
			const recordedAmount = entered ? parseMinorUnits(entered, asset.currency) : charge;
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
	}
	async function recordItem(action: "loan" | "return" | "maintenance", expectedReturn?: Asset) {
		if (!asset || itemInFlight.current) return;
		if (action === "return" && (!expectedReturn || expectedReturn.id !== asset.id)) return;
		itemInFlight.current = true;
		setItemBusy(true);
		setItemError("");
		try {
			const current = assetSchema.parse(expectedReturn ?? asset);
			const borrower = action === "return" ? current.borrower : itemBorrower.trim();
			const note = action === "maintenance" ? itemMaintenanceNote.trim() : itemLoanNote.trim();
			if (action === "loan" && !borrower) throw Error("item-borrower-required");
			if (action === "maintenance" && !note) throw Error("item-note-required");
			const now = new Date();
			const eventDate = action === "maintenance" && itemDateManuallySet.current
				? itemEventDate
				: localCalendarDay(now);
			if (action === "maintenance" && !itemDateManuallySet.current) setItemEventDate(eventDate);
			if (!validCalendarDay(eventDate)) throw Error("item-date-invalid");
			if (action === "loan" && itemExpectedReturnDate && (!validCalendarDay(itemExpectedReturnDate) || itemExpectedReturnDate < eventDate)) throw Error("item-date-invalid");
			if (action === "maintenance" && itemReminderDate && !validCalendarDay(itemReminderDate)) throw Error("item-date-invalid");
			const historyId = crypto.randomUUID();
			const timestamp = now.toISOString();
			const next = {
				...current,
				status: action === "loan" ? "loaned" as const : action === "return" ? "active" as const : current.status,
				borrower: action === "loan" ? borrower : action === "return" ? "" : current.borrower,
				itemExpectedReturnDate: action === "loan" ? itemExpectedReturnDate : action === "return" ? "" : current.itemExpectedReturnDate,
				lastItemEventId: historyId,
				updatedAt: timestamp,
			};
			await commitItemAction(current, next, {
				id: historyId,
				assetId: current.id,
				action,
				borrower: action === "maintenance" ? undefined : borrower,
				expectedReturnDate: action === "loan" && itemExpectedReturnDate ? itemExpectedReturnDate : undefined,
				eventDate,
				note,
				createdAt: timestamp,
				deleted: false,
			});
			setItemRecoveryPending(false);
			if (action === "return") setItemReturnBase(null);
			setItemBorrower("");
			setItemExpectedReturnDate("");
			if (action === "maintenance") setItemMaintenanceNote("");
			else setItemLoanNote("");
			if (action === "maintenance" && itemReminderDate) {
				try {
					await save("task", {
						id: crypto.randomUUID(),
						assetId: asset.id,
						name: t("maintenanceReminderTask", { name: asset.name }),
						dueDate: itemReminderDate,
						done: false,
						completedAt: "",
						createdAt: timestamp,
						dedupeKey: `item:${asset.id}:maintenance:${itemReminderDate}`,
						deleted: false,
					});
					setItemReminderDate("");
				} catch (error) {
					if (error instanceof Error && error.message === "task-duplicate") {
						setItemReminderDate("");
					} else {
						setItemError(t("maintenanceSavedReminderFailed"));
						return;
					}
				}
			}
			notify(t("saved"));
		} catch (error) {
			const reason = error instanceof Error ? error.message : "";
			if (reason === "renewal-recovery-pending") {
				setItemRecoveryPending(true);
				setItemError("");
			} else setItemError(t(
				reason === "item-borrower-required" ? "borrowerRequired" :
				reason === "item-note-required" ? "maintenanceNoteRequired" :
				reason === "item-date-invalid" ? "invalid" :
				reason === "item-stale" ? "itemStale" :
				reason === "item-recovery-pending" ? "itemRecoveryPending" : "error",
			));
		} finally {
			itemInFlight.current = false;
			setItemBusy(false);
		}
	}
	function openLocation() {
		if (asset?.kind !== "item") return;
		const [area, container, spot] = itemLocationParts(asset.location ?? "");
		setLocationArea(area);
		setLocationContainer(container);
		setLocationSpot(spot);
		setLocationError("");
		setLocationOpen(true);
	}
	async function saveLocation() {
		if (asset?.kind !== "item" || locationInFlight.current) return;
		const parts = [locationArea.trim(), locationContainer.trim(), locationSpot.trim()];
		const value = parts.filter(Boolean).join(itemLocationSeparator);
		if (parts.some((part) => part.includes("\u2063")) || (!parts[0] && (parts[1] || parts[2])) || (parts[2] && !parts[1]) || value.length > 300) {
			setLocationError(t("invalid"));
			return;
		}
		locationInFlight.current = true;
		setLocationBusy(true);
		setLocationError("");
		try {
			const current = assetSchema.parse(asset);
			await saveAssetIfCurrent(current, { ...current, location: value, updatedAt: new Date().toISOString() });
			setLocationOpen(false);
			notify(t("saved"));
		} catch (error) {
			setLocationError(t(error instanceof Error && error.message === "asset-stale" ? "itemStale" : "error"));
		} finally {
			locationInFlight.current = false;
			setLocationBusy(false);
		}
	}
	function openItemStatus() {
		if (!asset) return;
		setItemStatusDraft(asset.itemLifecycleStatus ?? "inUse");
		setItemStatusDateDraft(localCalendarDay(new Date()));
		setItemStatusNote("");
		setItemStatusError("");
		setItemStatusOpen(true);
	}
	async function recordItemStatus() {
		if (asset?.kind !== "item" || itemInFlight.current) return;
		if (!validCalendarDay(itemStatusDateDraft)) {
			setItemStatusError(t("itemStatusInvalid"));
			return;
		}
		if (asset.status === "loaned" && ["resold", "retired"].includes(itemStatusDraft)) {
			setItemStatusError(t("itemStatusLoanedGuard"));
			return;
		}
		itemInFlight.current = true;
		setItemBusy(true);
		setItemStatusError("");
		try {
			// Legacy rows predate itemLifecycleStatus. Normalize before building the
			// history pair so an unrecorded previous state is stored as null.
			const current = assetSchema.parse(asset);
			const timestamp = new Date().toISOString();
			const historyId = crypto.randomUUID();
			await commitItemAction(current, {
				...current,
				itemLifecycleStatus: itemStatusDraft,
				itemStatusDate: itemStatusDateDraft,
				lastItemEventId: historyId,
				updatedAt: timestamp,
			}, {
				id: historyId,
				assetId: current.id,
				action: "itemStatus",
				itemStatusBefore: current.itemLifecycleStatus,
				itemStatusAfter: itemStatusDraft,
				eventDate: itemStatusDateDraft,
				note: itemStatusNote.trim(),
				createdAt: timestamp,
				deleted: false,
			});
			setItemRecoveryPending(false);
			setItemStatusOpen(false);
			notify(t("saved"));
		} catch (error) {
			const reason = error instanceof Error ? error.message : "";
			if (reason === "renewal-recovery-pending") {
				setItemRecoveryPending(true);
				setItemStatusError(t("itemRecoveryPending"));
			} else setItemStatusError(t(reason === "item-stale" ? "itemStale" : reason === "item-invalid" ? "itemStatusInvalid" : "error"));
		} finally {
			itemInFlight.current = false;
			setItemBusy(false);
		}
	}
	async function changeItemArchive() {
		if (!asset || itemInFlight.current || !["active", "archived"].includes(asset.status)) return;
		itemInFlight.current = true;
		setItemBusy(true);
		setItemError("");
		try {
			await setItemArchived(asset.id, asset.status as "active" | "archived");
			setItemRecoveryPending(false);
			notify(t("saved"));
		} catch (error) {
			const reason = error instanceof Error ? error.message : "";
			if (reason === "renewal-recovery-pending") {
				setItemRecoveryPending(true);
				setItemError("");
			} else setItemError(t(reason === "item-stale" ? "itemStale" : "error"));
		} finally {
			itemInFlight.current = false;
			setItemBusy(false);
		}
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
	function projectMediaCard(role: "logoId" | "homeScreenshotId" | "promoCoverId", label: string) {
		const id = projectMedia[role];
		const attachmentCount = asset?.attachments.length ?? 20;
		return <section className="project-media-card" data-project-media-role={role} aria-label={label} key={role}>
			<h3>{label}</h3>
			{id ? <ImageTile id={id} /> : <p className="asset-quiet-empty">{t("none")}</p>}
			<div className="project-media-actions">
				<Button size="small" disabled={uploading || (!id && attachmentCount >= 20)} onClick={() => chooseImage(role, id)}>{t(id ? "replaceImage" : "addPhoto")}</Button>
				{id && <Button size="small" variant="danger" disabled={uploading} onClick={() => void removeImage(id)}>{t("removeImage")}</Button>}
			</div>
		</section>;
	}
	const projectMediaSection = asset.kind === "project" && <section className="project-media-section" aria-label={t("projectMaterialsImage")}>
		<h2>{t("projectMaterialsImage")}</h2>
		<div className="project-media-grid">
			{projectMediaCard("logoId", t("projectLogo"))}
			{projectMediaCard("homeScreenshotId", t("projectHomeScreenshot"))}
			{projectMediaCard("promoCoverId", t("projectPromoCover"))}
			<section className="project-media-card" data-project-media-role="productScreenshotIds" aria-label={t("projectProductScreenshots")}>
				<h3>{t("projectProductScreenshots")}</h3>
				<p className="project-media-hint">{t("projectProductScreenshotsLimit")}</p>
				{projectMedia.productScreenshotIds.length ? <div className="project-screenshot-grid">{projectMedia.productScreenshotIds.map((id) => <div className="project-screenshot" key={id}>
					<ImageTile id={id} />
					<div className="project-media-actions"><Button size="small" disabled={uploading} onClick={() => chooseImage("productScreenshotIds", id)}>{t("replaceImage")}</Button><Button size="small" variant="danger" disabled={uploading} onClick={() => void removeImage(id)}>{t("removeImage")}</Button></div>
				</div>)}</div> : <p className="asset-quiet-empty">{t("none")}</p>}
				<Button size="small" disabled={uploading || asset.attachments.length >= 20 || projectMedia.productScreenshotIds.length >= 4} onClick={() => chooseImage("productScreenshotIds")}>{t("addPhoto")}</Button>
			</section>
		</div>
	</section>;
	const attachmentSection = (
				<section className="card asset-attachments-card">
					<div className="card-header">
						<h2>{t(asset.kind === "project" ? "projectOtherImages" : asset.kind === "item" ? "itemOtherImages" : "attachments")}</h2>
						<Button
							size="small"
							disabled={uploading || asset.attachments.length >= 20}
							onClick={() => chooseImage("other")}
						>
							{uploading ? t("loading") : t("addPhoto")}
						</Button>
						<input
							ref={imageInput}
							type="file"
							accept={asset.kind === "project" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,image/gif"}
							hidden
							tabIndex={-1}
							aria-label={t("addPhoto")}
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) {
									if (
										!(asset.kind === "project" ? ["image/jpeg", "image/png", "image/webp"] : ["image/jpeg", "image/png", "image/webp", "image/gif"]).includes(file.type) ||
										file.size === 0 ||
										file.size > (asset.kind === "project" ? 5 : 20) * 1024 * 1024 ||
										file.name.length > 255
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
					{visibleAttachmentIds.length ? (
						<div className="image-grid">
							{visibleAttachmentIds.map((id) => (
								<div key={id} className="image-item">
									<ImageTile id={id} />
									<Button size="small" disabled={uploading} onClick={() => {
										chooseImage("other", id);
									}}>{t("replaceImage")}</Button>
									<Button
										variant="danger"
										size="small"
										disabled={uploading}
										onClick={() => void removeImage(id)}
									>
										{t("removeImage")}
									</Button>
								</div>
							))}
						</div>
					) : (
						asset.kind === "project" ? <p className="asset-quiet-empty">{t("none")}</p> : <Empty hint={false} />
					)}
				</section>
	);
	const relationSearch = <div className="field relation-filter">
		<label className={kind === "account" ? "account-relation-search-label" : undefined} htmlFor="relation-filter">
			{t(kind === "account" ? "accountGraphSearchLabel" : "filterRelations")}
		</label>
		<input
			id="relation-filter"
			type="search"
			placeholder={kind === "account" ? t("accountGraphSearch") : undefined}
			value={relationFilter}
			onChange={(event) => { const value = event.target.value; setRelationFilter(value); if (centerId) graphViewState(centerId).filter = value; if (value.trim()) { setRelationDetailsOpen(true); if (centerId) graphViewState(centerId).detailsOpen = true; } }}
		/>
		{kind === "account" && normalizedFilter && <small role="status">{t("accountGraphSearchMatches", { count: graphMatches.size })}</small>}
	</div>;
	const relationList = visibleRelations.length ? (
		<div className="list relation-list">
			{visibleRelations.map((relation) => {
				const neighbor = liveById.get(
					relation.from === asset.id ? relation.to : relation.from,
				);
				const indirectTarget = relation.from !== asset.id && relation.to !== asset.id ? liveById.get(relation.to) : undefined;
				if (!neighbor) return null;
				return (
					<div className="list-row relation-row" key={relation.id}>
						<div className="relation-info">
							{kind === "account" ? <>
								<span className="relation-endpoints">{(["from", "to"] as const).map((side) => {
									const id = relation[side];
									const endpoint = liveById.get(id);
									if (!endpoint) return null;
									return <span key={side}>{side === "to" && <span> → </span>}{id === asset.id ? <strong>{endpoint.name}</strong> : <TextLink asChild><Link to="/assets/$kind/$id" params={{ kind: endpoint.kind, id: endpoint.id }} onClick={(event) => { event.preventDefault(); visitRelation(endpoint); }}><strong>{endpoint.name}</strong></Link></TextLink>}</span>;
								})}</span>
								<small className="relation-purpose">{relation.label}</small>
							</> : <>
							<TextLink asChild><Link
								to="/assets/$kind/$id"
										params={{ kind: neighbor.kind, id: neighbor.id }}
										onClick={(event) => { event.preventDefault(); visitRelation(neighbor); }}
							>
								<strong>{neighbor.name}</strong>
							</Link></TextLink>
							{indirectTarget && <><span aria-hidden="true"> → </span><TextLink asChild><Link to="/assets/$kind/$id" params={{ kind: indirectTarget.kind, id: indirectTarget.id }} onClick={(event) => { event.preventDefault(); visitRelation(indirectTarget); }}><strong>{indirectTarget.name}</strong></Link></TextLink></>}
							<small>
								{liveById.get(relation.from)?.name} →{" "}
								{liveById.get(relation.to)?.name} · {relation.label}
							</small>
							</>}
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
						<div className="actions graph-relation-actions">
						<Button size="small" aria-label={`${t("editRelation")} · ${relation.label} · ${neighbor.name}`} onClick={() => openRelationEditor(relation)}>{t("edit")}</Button>
						<Button
							variant="ghost"
							size="small"
							aria-label={`${t("deleteRelation")} · ${relation.label} · ${neighbor.name}`}
							onClick={() => {
								setRelationDeleteError("");
								setRelationToDelete(relation);
							}}
						>
							{t("remove")}
						</Button>
						</div>
					</div>
				);
			})}
		</div>
	) : (
		asset.kind === "project" ? <p className="asset-quiet-empty">{t("noMatches")}</p> : <Empty hint={false} />
	);
	return (
		<main className={`page asset-detail asset-detail-${kind}${relations.length ? " has-relations" : ""}`}>
			{kind === "project" && <div className="asset-project-action-bar">
				<Button onClick={() => setEdit(true)}>{t("edit")}</Button>
				{asset.status === "archived" && <Button disabled={reactivateProjectBusy} onClick={() => { setReactivateProjectBase(structuredClone(asset)); setReactivateProjectError(""); setReactivateProjectStale(false); }}>{t("reactivateProject")}</Button>}
				<Button variant="primary" onClick={() => setSubmissionEdit(true)}><Plus size={14} />{t("addSubmission")}</Button>
				<Button asChild><Link to="/assets/project/$id/workflow/$flow" params={{ id: asset.id, flow: "brand" }}>{t("workflowBrandEntry")}</Link></Button>
				<Button asChild><Link to="/assets/project/$id/workflow/$flow" params={{ id: asset.id, flow: "close" }}>{t("workflowCloseEntry")}</Link></Button>
				<Button variant="danger" disabled={deleteBusy} onClick={() => { setDeleteError(""); setDeleteBase(structuredClone(asset)); }}>{t("delete")}</Button>
			</div>}
			<div className="page-header">
				<div>
					{kind !== "project" && kind !== "account" && <TextLink asChild><Link className="back-link" to={catalogReturn?.view === "all" ? "/assets" : "/assets/$kind"} params={catalogReturn?.view === "all" ? {} : { kind: catalogReturn?.view === "domains" ? "domains" : returnKind }} onClick={() => { sessionStorage.removeItem("keepany-relation-return-id"); sessionStorage.removeItem("keepany-relation-return-kind"); }}>
						<ArrowLeft size={16} />
						{t("back")}
					</Link></TextLink>}
					<div className="eyebrow">
						{t(kind)} · {niceCategory(asset.category || (kind === "account" ? "other" : ""), t)}
					</div>
					{kind === "project" && projectMedia.logoId ? <div className="asset-project-hero-brand"><div className="asset-project-hero-logo"><ImageTile id={projectMedia.logoId} /></div><h1>{asset.name}</h1></div> : <h1>{asset.name}</h1>}
					{kind !== "account" && <p className="subtitle">
						{asset.description || asset.url || t("local")}
					</p>}
					{kind === "project" && <div className="asset-project-hero-meta"><span>{niceCategory(asset.category, t)}</span>{asset.status && <span>{t(asset.status)}</span>}{asset.url && <a href={asset.url} target="_blank" rel="noopener noreferrer">{asset.url}<ExternalLink size={13} /></a>}</div>}
					{kind === "project" && <div className="asset-project-hero-actions">
						<Button onClick={() => scrollToFold("asset-project-materials", setMaterialsOpen)}>{t("projectViewMaterials")}<ArrowDownRight size={15} /></Button>
						<Button onClick={() => scrollToFold("asset-backlinks", setBacklinksOpen)}>{t("projectViewBacklinks")}<ArrowDownRight size={15} /></Button>
					</div>}
				</div>
				{kind === "project" && <div className="asset-project-hero-visual" role="img" aria-label={t("preview")}>{projectMedia.homeScreenshotId ? <ImageTile id={projectMedia.homeScreenshotId} /> : <ProjectPreview asset={{ ...asset, attachments: [] }} />}</div>}
				{kind !== "project" && <div className="actions">
					{kind === "subscription" && <Button asChild><Link to="/finance">{t("financeViewLedger")}</Link></Button>}
					<Button onClick={() => setEdit(true)}>{t("edit")}</Button>
					<Button
						variant="danger"
						disabled={deleteBusy}
						onClick={() => { setDeleteError(""); setDeleteBase(structuredClone(asset)); }}
					>
						{t("delete")}
					</Button>
				</div>}
			</div>
			{kind === "project" && <div className="asset-project-stats">
				<div><small>{t("projectRecords")}</small><strong>{submissions.length}</strong></div>
				<div><small>{t("projectIndexed")}</small><strong>{submissions.filter((entry) => entry.status === "indexed").length}</strong></div>
				<div><small>{t("projectNeedsReview")}</small><strong>{submissions.filter((entry) => entry.status === "verify").length}</strong></div>
			</div>}
			{reactivateProjectBase && <Dialog title={t("reactivateProject")} closeDisabled={reactivateProjectBusy} onClose={() => { if (!reactivateProjectInFlight.current) setReactivateProjectBase(null); }}>
				<p>{t("reactivateProjectConfirm")}</p>
				{reactivateProjectError && <p className="field-error" role="alert">{reactivateProjectError}</p>}
				<div className="actions"><Button disabled={reactivateProjectBusy} onClick={() => setReactivateProjectBase(null)}>{t("cancel")}</Button><Button variant="primary" disabled={reactivateProjectBusy || reactivateProjectStale} onClick={() => void confirmProjectReactivation()}>{t("reactivateProject")}</Button></div>
			</Dialog>}
			{deleteBase && deleteBase.id === asset.id && (
				<Dialog
					className={kind === "account" ? "account-detail-dialog" : undefined}
					title={t("delete")}
					closeDisabled={deleteBusy}
					onClose={() => {
						if (!deleteInFlight.current) setDeleteBase(null);
					}}
				>
					<p>{t(kind === "account" ? "accountTrashConfirm" : "deleteConfirm")}</p>
					{deleteError && <p className="field-error" role="alert">{deleteError}</p>}
					<div className="actions">
						<Button disabled={deleteBusy} onClick={() => setDeleteBase(null)}>
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
			<div className={`detail-grid asset-detail-primary${asset.kind === "account" ? " account-empty-primary" : ""}`}>
				{asset.kind === "item" && <section className="card asset-item-photo-main" aria-label={t("itemCoverPhoto")}>
					<div className="asset-item-photo-stage">{itemMedia.coverId ? <ImageTile id={itemMedia.coverId} /> : <p>{t("itemStatusUnrecorded")}</p>}
						<span className="chip">{asset.status === "loaned" ? t("loaned") : asset.itemLifecycleStatus ? t(`itemStatus_${asset.itemLifecycleStatus}`) : t("itemStatusUnrecorded")}</span>
					</div>
					<div className="asset-item-photo-actions"><Button size="small" disabled={uploading || (!itemMedia.coverId && asset.attachments.length >= 20)} onClick={() => chooseImage("coverId", itemMedia.coverId)}>{t(itemMedia.coverId ? "replaceImage" : "addPhoto")}</Button>
						<Button size="small" disabled={uploading || asset.attachments.length >= 20} onClick={() => chooseImage("detailIds")}>{t("itemDetailPhotos")}</Button>
					</div>
				</section>}
				{asset.kind === "project" && <section className="card asset-profile-card asset-project-profile-card">
					<div className="card-header"><h2>{t("profile")}</h2></div>
					<dl className="asset-project-facts">
						<div><dt>{t("projectOfficialUrl")}</dt><dd>{asset.url ? <TextLink href={asset.url} target="_blank" rel="noopener noreferrer"><span>{asset.url}</span><ExternalLink aria-hidden="true" /></TextLink> : "—"}</dd></div>
						<div><dt>{t("projectType")}</dt><dd>{niceCategory(asset.category, t) || "—"}</dd></div>
						<div><dt>{t("projectLaunchMonth")}</dt><dd>{asset.projectLaunchMonth ? new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${asset.projectLaunchMonth}-01T12:00:00Z`)) : "—"}</dd></div>
						<div><dt>{t("projectAccount")}</dt><dd>{relatedAccounts.length ? relatedAccounts.map((linked, index) => <span key={linked.id}>{index > 0 && " · "}<TextLink asChild><Link to="/assets/$kind/$id" params={{ kind: linked.kind, id: linked.id }} onClick={(event) => { event.preventDefault(); visitRelation(linked); }}>{linked.name}</Link></TextLink></span>) : "—"}</dd></div>
					</dl>
					<div className="asset-project-related">
						<div className="card-header"><h3>{t("related")}</h3><Button asChild size="small"><Link to="/finance">{t("financeViewLedger")}<ArrowDownRight size={15} aria-hidden="true" /></Link></Button></div>
						{relatedAssets.length ? <div className="asset-project-related-list">{relatedAssets.map((linked) => <Link key={linked.id} className="asset-project-related-card" to="/assets/$kind/$id" params={{ kind: linked.kind, id: linked.id }} onClick={(event) => { event.preventDefault(); visitRelation(linked); }}><span className="asset-project-related-icon" aria-hidden="true">{linked.name.charAt(0).toUpperCase()}</span><span><strong>{linked.name}</strong><small>{t(linked.kind)}{linked.kind === "subscription" ? ` · ${money(linked.amount, linked.currency, i18n.language)}` : linked.username ? ` · ${linked.username}` : ""}</small></span><ArrowDownRight size={15} aria-hidden="true" /></Link>)}</div> : <p className="asset-quiet-empty">{t("none")}</p>}
					</div>
				</section>}
				{asset.kind === "project" && <section className="card asset-project-reminders" id="project-reminders">
					<div className="card-header"><h2>{t("projectLinkReminders")}</h2></div>
					{pendingBacklinks.length ? <button type="button" className="asset-project-reminder-row" onClick={() => scrollToFold("asset-backlinks", setBacklinksOpen)}><span className="asset-project-reminder-symbol" aria-hidden="true">!</span><span><strong>{t("projectVerifyCount", { count: pendingBacklinks.length })}</strong><small>{t("projectViewBacklinks")}</small></span><ArrowDownRight size={16} /></button> : <p className="asset-quiet-empty">{t("projectNoLinkReminders")}</p>}
					<div className="asset-project-reminder-row asset-project-reminder-static"><span className="asset-project-reminder-symbol" aria-hidden="true">↗</span><span><strong>{t("projectNextInspection")}</strong><small>{asset.projectInspectionDate ? date(asset.projectInspectionDate, i18n.language) : t("projectNoInspection")}</small></span></div>
				</section>}
				{asset.kind !== "project" && asset.kind !== "account" && <section className="card asset-profile-card">
					<div className="card-header">
						<div><h2>{t(asset.kind === "item" ? "itemStateTitle" : "profile")}</h2>{asset.kind === "item" && <small>{t("itemStateSubtitle")}</small>}</div>
						{asset.kind === "item" && <Button size="small" disabled={itemBusy} onClick={openItemStatus}>{t("itemStatusChange")}</Button>}
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
									<TextLink href={asset.url} target="_blank" rel="noopener noreferrer">
										<span>{asset.url}</span>
									</TextLink>
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
										{money(monthlyMinorUnits(asset), asset.currency, i18n.language)}
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
									<dt>{t("itemPurchasePrice")}</dt>
									<dd>{asset.itemPurchasePriceKnown ? money(asset.amount, asset.currency, i18n.language) : t("itemStatusUnrecorded")}</dd>
								</div>
								<div>
									<dt>{t("purchaseDate")}</dt>
									<dd>{asset.purchaseDate ? date(asset.purchaseDate, i18n.language) : t("itemStatusUnrecorded")}</dd>
								</div>
								<div>
									<dt>{t("itemStartDate")}</dt>
									<dd>{asset.itemStartDate ? date(asset.itemStartDate, i18n.language) : t("itemStatusUnrecorded")}</dd>
								</div>
								<div>
									<dt>{t("itemLifecycleStatus")}</dt>
									<dd><span className="chip">{asset.itemLifecycleStatus ? t(`itemStatus_${asset.itemLifecycleStatus}`) : t("itemStatusUnrecorded")}</span></dd>
								</div>
								<div>
									<dt>{t("itemStatusDate")}</dt>
									<dd>{asset.itemStatusDate ? date(asset.itemStatusDate, i18n.language) : t("itemStatusUnrecorded")}</dd>
								</div>
								<div>
									<dt>{t("itemWarrantyStatus")}</dt>
									<dd>{asset.itemWarrantyStatus ? t(`itemWarranty_${asset.itemWarrantyStatus}`) : t("itemStatusUnrecorded")}</dd>
								</div>
								<div>
									<dt>{t("warrantyDate")}</dt>
									<dd>{date(asset.warrantyDate, i18n.language)}</dd>
								</div>
								<div>
									<dt>{t("location")}</dt>
									<dd>{asset.location ? asset.location.replaceAll("\u2063", "") : "—"}</dd><Button size="small" onClick={openLocation}>{t("itemEditLocation")}</Button>
								</div>
								{asset.status === "loaned" && asset.borrower && (
									<div>
										<dt>{t("borrower")}</dt>
										<dd>{asset.borrower}</dd>
									</div>
								)}
								{asset.status === "loaned" && <div><dt>{t("itemExpectedReturnDate")}</dt><dd>{asset.itemExpectedReturnDate ? date(asset.itemExpectedReturnDate, i18n.language) : t("itemStatusUnrecorded")}</dd></div>}
							</>
						)}
						{asset.status && (asset.kind !== "item" || asset.status !== "active" || !asset.itemLifecycleStatus || asset.itemLifecycleStatus === "inUse") && (
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
					{assetNotes(asset) && <p className="note asset-supplemental-notes">{assetNotes(asset)}</p>}
				</section>}
				{asset.kind === "item" && <section className="card asset-item-evidence" aria-label={t("itemPhotosAndEvidence")}>
					<div className="card-header"><h2>{t("itemPhotosAndEvidence")}</h2></div>
					<p className="asset-item-evidence-hint">{t("itemEvidenceHint")}</p>
					<div className="asset-item-evidence-groups">
						{(["coverId", "detailIds", "receiptIds"] as const).map((role) => {
							const ids = role === "coverId" ? (itemMedia.coverId ? [itemMedia.coverId] : []) : itemMedia[role];
							const label = t(role === "coverId" ? "itemCoverPhoto" : role === "detailIds" ? "itemDetailPhotos" : "itemReceiptImages");
							return <section className="asset-item-evidence-group" data-item-media-role={role} aria-label={label} key={role}>
								<div className="asset-item-evidence-head"><h3>{label}</h3><Button size="small" disabled={uploading || (asset.attachments.length >= 20 && !(role === "coverId" && itemMedia.coverId))} onClick={() => chooseImage(role, role === "coverId" ? itemMedia.coverId : "")}>{t(role === "coverId" && itemMedia.coverId ? "replaceImage" : "addPhoto")}</Button></div>
								{ids.length ? <div className="asset-item-evidence-grid">{ids.map((id) => <div className="asset-item-evidence-image" key={id}>
									<ImageTile id={id} />
									<div className="project-media-actions"><Button size="small" disabled={uploading} onClick={() => chooseImage(role, id)}>{t("replaceImage")}</Button><Button size="small" variant="danger" disabled={uploading} onClick={() => void removeImage(id)}>{t("removeImage")}</Button></div>
								</div>)}</div> : <p className="asset-quiet-empty">{t("none")}</p>}
							</section>;
						})}
					</div>
				</section>}
				{asset.kind !== "project" && asset.kind !== "account" && attachmentSection}
			</div>
			{asset.kind === "project" && <section className="card asset-project-costs" id="project-domains">
				<div className="card-header"><h2>{t("projectDomainCosts")}</h2><Button size="small" onClick={() => openDomain()}><Plus size={14} />{t("projectAddDomain")}</Button></div>
				<div className="asset-project-cost-grid">
					<div><small>{t("projectMonthlyCost")}</small><strong>{formatTotals(monthlyByCurrency)}</strong><small>{relatedSubscriptions.length} {t("projectLinkedSubscriptions")}</small></div>
					<div><small>{t("projectAnnualEstimate")}</small><strong>{formatTotals(annualByCurrency)}</strong>{incompleteCost && <small>{t("projectCostPartial")}</small>}</div>
					<div><small>{t("projectNextRenewal")}</small><strong>{nextRenewal ? date(nextRenewal, i18n.language) : "—"}</strong><small>{projectDomains.length} {t("projectDomain")}</small></div>
				</div>
				{projectDomains.length ? <div className="asset-project-domain-list">{projectDomains.map((domain) => <div className="asset-project-domain-row" key={domain.id} id={`project-domain-${domain.id}`}><div><strong>{domain.name}</strong><small>{[domain.registrar, domain.accountId ? liveById.get(domain.accountId)?.name : "", domain.annualAmount === null ? "" : `${money(domain.annualAmount, domain.currency, i18n.language)} / ${t("year")}`].filter(Boolean).join(" · ") || "—"}</small><span>{t("projectExpiry")}: {date(domain.expiryDate, i18n.language)} · {t("projectAutoRenew")}: {t(domain.autoRenew === "on" ? "projectAutoRenewOn" : domain.autoRenew === "off" ? "projectAutoRenewOff" : "projectAutoRenewUnknown")}</span></div><Button size="small" onClick={() => openDomain(domain)}>{t("edit")}</Button></div>)}</div> : <p className="asset-quiet-empty">{t("projectNoDomains")}</p>}
				<details className="asset-project-linked-subscriptions"><summary>{t("projectLinkedSubscriptions")} · {relatedSubscriptions.length}</summary>{relatedSubscriptions.length ? relatedSubscriptions.map((linked) => <Link key={linked.id} to="/assets/$kind/$id" params={{ kind: linked.kind, id: linked.id }} onClick={(event) => { event.preventDefault(); visitRelation(linked); }}><strong>{linked.name}</strong><span>{money(linked.amount, linked.currency, i18n.language)} / {t(linked.cycle)} · {date(linked.dueDate, i18n.language)}</span></Link>) : <p className="asset-quiet-empty">{t("none")}</p>}</details>
			</section>}
			{asset.kind === "project" && domainEditing && domainDraft && <Dialog title={domainDeleteConfirm ? t("projectDomainDelete") : domainEditing === "new" ? t("projectAddDomain") : t("projectEditDomain")} closeDisabled={domainBusy} onClose={() => { if (!domainInFlight.current) { if (domainDeleteConfirm) setDomainDeleteConfirm(false); else setDomainEditing(null); } }}>
				{domainDeleteConfirm ? <>
					<p>{t("projectDomainDeleteConfirm", { name: domainBase?.projectDomains?.find(entry => entry.id === domainEditing)?.name ?? domainDraft.name })}</p>
					{domainError && <p role="alert" className="field-error">{domainError}</p>}
					<div className="actions"><Button type="button" disabled={domainBusy} onClick={() => setDomainDeleteConfirm(false)}>{t("cancel")}</Button><Button type="button" variant="danger" disabled={domainBusy} onClick={() => void removeDomain()}>{t("confirm")}</Button></div>
				</> :
				<form className="asset-project-domain-form" onSubmit={(event) => { event.preventDefault(); void saveDomain(); }}>
					<label className="field">{t("projectDomain")}<input disabled={domainBusy} required value={domainDraft.name} onChange={(event) => setDomainDraft({ ...domainDraft, name: event.target.value })} placeholder="example.com" /></label>
					<label className="field">{t("projectRegistrar")}<input disabled={domainBusy} value={domainDraft.registrar} onChange={(event) => setDomainDraft({ ...domainDraft, registrar: event.target.value })} /></label>
					<label htmlFor="project-domain-account" className="field">{t("projectDomainAccount")}<Select id="project-domain-account" disabled={domainBusy} value={domainDraft.accountId} onValueChange={(selectValue) => setDomainDraft({ ...domainDraft, accountId: selectValue })}><SelectOption value="">—</SelectOption>{liveAssets(data).filter((entry) => entry.kind === "account").map((entry) => <SelectOption value={entry.id} key={entry.id}>{entry.name}</SelectOption>)}</Select></label>
					<label className="field">{t("projectExpiry")}<input disabled={domainBusy} type="date" value={domainDraft.expiryDate} onChange={(event) => setDomainDraft({ ...domainDraft, expiryDate: event.target.value })} /></label>
					<label className="field">{t("projectAnnualFee")}<span className="asset-project-fee-row"><input disabled={domainBusy} inputMode="decimal" value={domainFee} onChange={(event) => setDomainFee(event.target.value)} /><Select disabled={domainBusy} aria-label={t("currency")} value={domainDraft.currency} onValueChange={(selectValue) => { const currency = selectValue as ProjectDomain["currency"]; setDomainDraft({ ...domainDraft, currency }); setDomainFee(""); }}><SelectOption>CNY</SelectOption><SelectOption>USD</SelectOption><SelectOption>EUR</SelectOption><SelectOption>GBP</SelectOption><SelectOption>JPY</SelectOption></Select></span></label>
					<label htmlFor="project-domain-auto-renew" className="field">{t("projectAutoRenew")}<Select id="project-domain-auto-renew" disabled={domainBusy} value={domainDraft.autoRenew} onValueChange={(selectValue) => setDomainDraft({ ...domainDraft, autoRenew: selectValue as ProjectDomain["autoRenew"] })}><SelectOption value="unknown">{t("projectAutoRenewUnknown")}</SelectOption><SelectOption value="on">{t("projectAutoRenewOn")}</SelectOption><SelectOption value="off">{t("projectAutoRenewOff")}</SelectOption></Select></label>
					{domainError && <p role="alert" className="field-error">{domainError}</p>}
					<div className="actions"><Button type="submit" variant="primary" disabled={domainBusy}>{t("save")}</Button>{domainEditing !== "new" && <Button type="button" variant="danger" disabled={domainBusy} onClick={() => { setDomainError(""); setDomainDeleteConfirm(true); }}>{t("projectDomainDelete")}</Button>}<Button type="button" disabled={domainBusy} onClick={() => setDomainEditing(null)}>{t("cancel")}</Button></div>
				</form>}
			</Dialog>}
			<div className="detail-grid asset-detail-secondary">
				<section id="account-relations" className="card asset-relations-card">
					<div className="card-header">
						<div>
							<h2>{t("relations")}</h2>
							{relations.length > 0 && <p>{kind === "account" ? t("accountGraphCounts", { direct: directCount, indirect: Math.max(0, (family?.neighbors.length ?? 0) - directCount) }) : t("relationGraphLegend")}</p>}
						</div>
						<Button
							variant="ghost"
							size="small"
							onClick={() => openRelationEditor()}
						>
							<Plus size={14} />
							{t("addRelation")}
						</Button>
					</div>
					{relations.length || kind === "account" || kind === "project" ? (
						<>
							{<div className="account-graph-toolbar">
								<div className="actions">
									<Button size="small" variant={graphScope === "direct" ? "primary" : "default"} aria-pressed={graphScope === "direct"} onClick={() => changeGraphScope("direct")}>{t("accountGraphDirect")}</Button>
									<Button size="small" variant={graphScope === "family" ? "primary" : "default"} aria-pressed={graphScope === "family"} onClick={() => changeGraphScope("family")}>{t("accountGraphFamily")}</Button>
								</div>
								{relationSearch}
								<details className="account-graph-guide"><summary>{t("accountGraphHelp")}</summary><p><span>{t("accountGraphDirection")}</span><span>{t("relationGraphLegend")}</span></p></details>
							</div>}
							<Suspense fallback={<p role="status">{t("loading")}</p>}><AccountFamilyGraphView root={asset} assets={[asset, ...graphRelated]} relations={displayedFamily?.relations ?? relations} matches={graphMatches} selectedEdgeId={selectedGraphEdgeId} onSelectEdge={selectGraphEdge} onVisit={visitRelation} onEditRelation={openRelationEditor} returnLabel={graphReturn ? t("graphBackTo", { name: liveById.get(graphReturn.id)?.name ?? t("back") }) : undefined} onReturn={graphReturn && liveById.has(graphReturn.id) ? () => { const target = consumeGraphReturn(asset.id); if (target) void navigate({ to: "/assets/$kind/$id", params: { kind: target.kind, id: target.id }, hash: "account-relations" }); } : undefined} onDeleteRelation={(relation) => { setRelationDeleteError(""); setRelationToDelete(relation); }} /></Suspense>
							{visibleRelations.length > 0 && <details className="account-relation-details" open={relationDetailsOpen} onToggle={(event) => { const value = event.currentTarget.open; setRelationDetailsOpen(value); if (centerId) graphViewState(centerId).detailsOpen = value; }}>
								<summary>{t("accountGraphDetails", { count: visibleRelations.length })}</summary>
								{relationList}
							</details>}

						</>
					) : (
						asset.kind === "project" ? <p className="asset-quiet-empty">{t("none")}</p> : <Empty hint={false} />
					)}
					{deletedRelations.length > 0 && <details className="graph-deleted-relations"><summary>{t("graphDeletedConnections", { count: deletedRelations.length })}</summary><div className="list relation-list">{deletedRelations.map(relation => <div className="list-row relation-row" key={relation.id} data-deleted-relation-id={relation.id}><div className="relation-info"><strong>{data.assets.find(asset => asset.id === relation.from)?.name || t("graphEndpointUnavailable")} → {data.assets.find(asset => asset.id === relation.to)?.name || t("graphEndpointUnavailable")}</strong><small>{relation.label}</small><small>{relation.source || t("graphNotRecorded")} · {date(relation.verifiedAt, i18n.language)}</small></div><Button size="small" disabled={relationBusy || !liveById.has(relation.from) || !liveById.has(relation.to)} aria-label={`${t("restore")} · ${relation.label}`} onClick={() => void restoreGraphRelation(relation)}>{t("restore")}</Button></div>)}</div>{relationRestoreError && <p className="field-error" role="alert">{relationRestoreError}</p>}<TextLink asChild><Link to="/trash">{t("trash")}</Link></TextLink></details>}

				</section>
				<section className="card asset-tasks-card">
					<div className="card-header">
						<h2>{t("tasks")}</h2>
						<div className="actions">
						{asset.kind === "item" && <Button asChild size="small"><Link to="/tasks" hash={maintenanceTask ? `task-${maintenanceTask.id}` : undefined}>{t("itemOpenMaintenancePlan")}</Link></Button>}
						<Button
							variant="ghost"
							size="small"
							onClick={() => setTaskEdit(true)}
						>
							<Plus size={14} />
							{t("add")}
						</Button>
						</div>
					</div>
					{ownTasks.length ? (
						<div className="list">
							{ownTasks.map((task) => (
								<TaskRow key={task.id} task={task} hideRelated={kind === "account"} />
							))}
						</div>
					) : (
						asset.kind === "project" ? <p className="asset-quiet-empty">{t("none")}</p> : <Empty hint={false} />
					)}
				</section>
			</div>
			{asset.kind === "account" && <div className="account-facts-grid">
				<section className="card account-facts-card"><div className="account-facts-heading"><h2>{t("accountBasicInfo")}</h2></div><dl>
					<div><dt>{t("accountProvider")}</dt><dd>{asset.accountProvider || t("accountNotRecorded")}</dd></div>
					{asset.username.trim() !== asset.name.trim() && <div><dt>{t("username")}</dt><dd>{asset.username || t("accountNotRecorded")}</dd></div>}
					<div><dt>{t("status")}</dt><dd>{t(asset.status)}</dd></div>
					<div><dt>{t("accountPurpose")}</dt><dd>{asset.description || t("accountNotRecorded")}</dd></div>
					{asset.url && <div><dt>{t("url")}</dt><dd><TextLink href={asset.url} target="_blank" rel="noopener noreferrer"><span>{asset.url}</span></TextLink></dd></div>}
					{asset.contact && <div><dt>{t("contact")}</dt><dd>{asset.contact}</dd></div>}
				</dl>
				{asset.tags.length > 0 && <div className="chips">{asset.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>}
				{assetNotes(asset) && <p className="note asset-supplemental-notes">{assetNotes(asset)}</p>}
				</section>

				<section className="card account-facts-card account-security-card"><h2>{t("accountRecordsSecurity")}</h2><dl>
					<div><dt>{t("accountProfileVerifiedAt")}</dt><dd>{asset.accountProfileVerifiedAt ? date(asset.accountProfileVerifiedAt, i18n.language) : t("accountNotRecorded")}</dd></div>
					<div><dt>{t("accountRelationVerifiedAt")}</dt><dd>{accountVerifiedAt ? date(accountVerifiedAt, i18n.language) : t("accountNotRecorded")}</dd></div>
				</dl><div className="workspace-password-actions"><Button aria-expanded={passwordsOpen} onClick={() => setPasswordsFor((current) => current === asset.id ? null : asset.id)}>{t(passwordsOpen ? "workspaceHidePasswords" : "workspaceShowPasswords")}</Button><Button asChild><Link to="/assets/$kind" params={{ kind: "vault" }} hash={`asset-${asset.id}`}>{t("accountOpenPasswords")}<ArrowDownRight size={16} /></Link></Button></div></section>
			</div>}
			{asset.kind === "account" && passwordsOpen && <section className="card account-passwords-section"><Suspense fallback={<div className="notice" role="status">{t("pwVaultLoading")}</div>}><PasswordVaultPanel assets={data.assets} notify={notify} focusAssetId={asset.id} embedded /></Suspense></section>}
			{asset.kind === "account" && attachmentSection}
			{asset.kind === "account" && (
				<section className="card impact-checklist">
					<div className="card-header">
						<div>
							<h2>{t("impact")}</h2>
							<p>{t("accountImpactGuide")}</p>
						</div>
						<Button
							size="small"
							disabled={impactBusy || impactPendingCount === 0}
							onClick={() => void createImpact()}
						>
							{t("makeChecklist")} · {impactPendingCount}
						</Button>
					</div>
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
				<details className="card asset-backlinks-card" id="asset-backlinks" open={backlinksOpen} onToggle={(event) => setBacklinksOpen(event.currentTarget.open)}>
					<summary>{t("backlinks")}</summary>
					<fieldset className="backlink-filters" aria-label={t("backlinkFilter")}>
						{(["all", ...submissionStatuses] as const).map((value) => <button type="button" key={value} aria-pressed={backlinkFilter === value} onClick={() => setBacklinkFilter(value)}>{t(value)}</button>)}
					</fieldset>
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
									{submissions.filter((entry) => backlinkFilter === "all" || entry.status === backlinkFilter).map((s) => (
										<SubmissionRow key={s.id} submission={s} />
									))}
								</tbody>
							</table>
							{submissions.filter((entry) => backlinkFilter === "all" || entry.status === backlinkFilter).length === 0 && <p className="asset-quiet-empty backlink-filter-empty">{t("none")}</p>}
						</div>
					) : (
						<p className="asset-quiet-empty">{t("none")}</p>
					)}
					{deletedSubmissions.length > 0 && <details className="backlink-deleted-records"><summary>{t("deletedBacklinksTitle")}</summary><p>{t("deletedBacklinksHint")}</p>{deletedSubmissions.map(submission => <DeletedSubmission key={submission.id} submission={submission} />)}</details>}
				</details>
			)}
			{asset.kind === "project" && <details className="card asset-project-materials" id="asset-project-materials" open={materialsOpen} onToggle={(event) => setMaterialsOpen(event.currentTarget.open)}>
				<summary>{t("projectProfileMaterials")}</summary>
				<div className="asset-project-materials-body">
					<div className="card-header"><h2>{t("projectViewMaterials")}</h2><Button size="small" onClick={() => setEdit(true)}>{t("edit")}</Button></div>
					<div className="asset-project-copy"><strong>{t("projectProductTitle")}</strong><p>{asset.projectTitle || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectPromoUrl")}</strong><p>{asset.projectPromoUrl && /^https?:\/\//i.test(asset.projectPromoUrl) ? <TextLink href={asset.projectPromoUrl} target="_blank" rel="noopener noreferrer"><span>{asset.projectPromoUrl}</span></TextLink> : asset.projectPromoUrl || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("tags")}</strong><p>{asset.tags.join(", ") || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectMaterialsShort")}</strong><p>{asset.description || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectMediumDescription")}</strong><p>{asset.projectMediumDescription || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectMaterialsLong")}</strong><p>{asset.longDescription || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectFeatures")}</strong><p>{asset.projectFeatures || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectPricing")}</strong><p>{asset.projectPricing || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectPricingType")}</strong><p>{asset.projectPricingType || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectBusinessEmail")}</strong><p>{asset.projectEmail || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectAdditionalNotes")}</strong><p>{asset.notes || "—"}</p></div>
					{projectMediaSection}
					{attachmentSection}
				</div>
			</details>}
			{assetBills.length > 0 && <section className="card asset-finance-card">
				<div className="card-header"><h2>{t("workspaceLedger")}</h2><TextLink asChild><Link to="/finance">{t("financeTitle")}</Link></TextLink></div>
				<div className="list">{assetBills.map(entry => <div className="list-row" key={entry.id} data-bill-id={entry.id}>
					<div><strong>{entry.title || (entry.action === "renew" ? t("financeRenewalRecorded") : t(`financeAction${entry.action[0].toUpperCase()}${entry.action.slice(1)}`))}</strong>
						<small>{date(entry.eventDate || entry.billDate || entry.createdAt.slice(0, 10), i18n.language)}{entry.source ? ` · ${entry.source}` : ""}{entry.note ? ` · ${entry.note}` : ""}</small>
						<small>{historyAssetIds(entry).map(id => data.assets.find(value => value.id === id)?.name ?? t("financeMissingAsset")).join(" · ")}</small>
					</div>{entry.amount !== undefined && entry.currency && <b>{money(entry.amount, entry.currency, i18n.language)}</b>}
				</div>)}</div>
			</section>}
			{(asset.kind === "item" || asset.kind === "subscription") && (
				<section className="card">
					<div className="card-header">
						<div><h2>{t("history")}</h2>{asset.kind === "item" && <small>{t("itemTimeline")}</small>}</div>
					</div>
			{asset.kind === "subscription" && renewalRecoveryPending && <p className="notice" role="alert">{t("renewalRecoveryPending")}</p>}
			{asset.kind === "item" && itemRecoveryPending && <p className="notice" role="alert">{t("itemRecoveryPending")}</p>}
					{asset.kind === "item" && itemError && <p className="notice" role="alert">{itemError}</p>}
					{asset.kind === "subscription" ? (
						<div className="toolbar">
							<Button
								disabled={asset.status !== "active" || !asset.dueDate || renewalBusy}
								onClick={() => void recordRenewalAction()}
							>
								{t("renew")}
							</Button>
							<input
								value={historyNote}
								onChange={(e) => setHistoryNote(e.target.value)}
								placeholder={t("notes")}
								aria-label={t("notes")}
							/>
							<label className="renewal-amount-field">
								<span>{t("recordedAmount")} ({asset.currency})</span>
								<input
									type="number"
									min="0"
									step={asset.currency === "JPY" ? "1" : "0.01"}
									value={renewalAmount}
									onChange={(event) => { setRenewalAmount(event.target.value); setRenewalAmountError(""); }}
									aria-invalid={!!renewalAmountError}
									placeholder={dueCharge === null ? "" : inputFromMinorUnits(dueCharge, asset.currency)}
								/>
								{renewalAmountError && <small role="alert">{renewalAmountError}</small>}
							</label>
						</div>
					) : (
						<>
							<div className="toolbar">
								{asset.status === "active" && (
									<><label className="field">
										<span>{t("borrower")}</span>
										<input value={itemBorrower} maxLength={200} onChange={(event) => { setItemBorrower(event.target.value); setItemError(""); }} />
									</label><label className="field">
										<span>{t("itemExpectedReturnDate")}</span>
										<input type="date" value={itemExpectedReturnDate} onChange={(event) => { setItemExpectedReturnDate(event.target.value); setItemError(""); }} />
									</label></>
								)}
								<label className="field">
									<span>{t("loanReturnNote")}</span>
									<input value={itemLoanNote} onChange={(event) => { setItemLoanNote(event.target.value); setItemError(""); }} />
								</label>
								<Button
									disabled={itemBusy || !["active", "loaned"].includes(asset.status) || (asset.status === "active" && ["repairing", "resold", "retired"].includes(asset.itemLifecycleStatus ?? ""))}
									onClick={() => {
										if (asset.status === "loaned") { setItemError(""); setItemReturnBase(assetSchema.parse(asset)); }
										else void recordItem("loan");
									}}
								>
									{t(asset.status === "loaned" ? "return" : "loan")}
								</Button>
								{["active", "archived"].includes(asset.status) && (
									<Button disabled={itemBusy} onClick={() => void changeItemArchive()}>
										{t(asset.status === "archived" ? "reactivateItem" : "archiveItem")}
									</Button>
								)}
							</div>
							<div className="toolbar">
								<label className="field">
									<span>{t("maintenanceNotes")}</span>
									<input value={itemMaintenanceNote} onChange={(event) => { setItemMaintenanceNote(event.target.value); setItemError(""); }} />
								</label>
								<label className="field">
									<span>{t("maintenanceDate")}</span>
									<input type="date" value={itemEventDate} onChange={(event) => { itemDateManuallySet.current = true; setItemEventDate(event.target.value); setItemError(""); }} />
								</label>
								<label className="field">
									<span>{t("maintenanceReminderDate")}</span>
									<input type="date" value={itemReminderDate} onChange={(event) => { setItemReminderDate(event.target.value); setItemError(""); }} />
								</label>
								<Button
									disabled={itemBusy || !["active", "loaned"].includes(asset.status) || ["resold", "retired"].includes(asset.itemLifecycleStatus ?? "")}
									onClick={() => void recordItem("maintenance")}
								>
									{t("maintenance")}
								</Button>
							</div>
						</>
					)}
					{asset.kind === "subscription" && <p className="subtitle">{t("renewalLocalHint")}</p>}
					{histories.length ? (
						<div className={asset.kind === "item" ? "list asset-item-timeline" : "list"}>
							{histories.map((h) => (
								<div className="list-row" key={h.id}>
									<Check size={17} />
									<div>
										<strong>{h.action === "itemStatus" ? `${h.itemStatusBefore ? t(`itemStatus_${h.itemStatusBefore}`) : t("itemStatusUnrecorded")} → ${h.itemStatusAfter ? t(`itemStatus_${h.itemStatusAfter}`) : t("itemStatusUnrecorded")}` : ["expense", "topup", "refund", "balance"].includes(h.action) ? t(`financeAction${h.action[0].toUpperCase()}${h.action.slice(1)}`) : t(h.action)}</strong>
										<small>
											{h.eventDate
												? date(h.eventDate, i18n.language)
												: new Intl.DateTimeFormat(i18n.language, {
													dateStyle: "medium",
												}).format(new Date(h.createdAt))}
											{h.action === "renew" && h.billDate && h.amount !== undefined && h.currency
												? ` · ${date(h.billDate, i18n.language)} · ${t("recordedAmount")}: ${money(h.amount, h.currency, i18n.language)}`
												: ""}
											{h.borrower ? ` · ${t("borrower")}: ${h.borrower}` : ""}
											{h.expectedReturnDate ? ` · ${t("itemExpectedReturnDate")}: ${date(h.expectedReturnDate, i18n.language)}` : ""}
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
			{asset.kind === "item" && itemReturnBase?.id === asset.id && <Dialog title={t("return")} closeDisabled={itemBusy} onClose={() => { if (!itemInFlight.current) setItemReturnBase(null); }}>
				<p>{t(itemReturnBase.borrower.trim() ? "itemReturnConfirm" : "itemReturnConfirmUnnamed", { name: itemReturnBase.name, borrower: itemReturnBase.borrower })}</p>
				{itemError && <p role="alert" className="field-error">{itemError}</p>}
				<div className="actions">
					<Button disabled={itemBusy} onClick={() => setItemReturnBase(null)}>{t("cancel")}</Button>
					<Button variant="primary" disabled={itemBusy} onClick={() => void recordItem("return", itemReturnBase)}>{t("confirm")}</Button>
				</div>
			</Dialog>}
			{asset.kind === "item" && locationOpen && <Dialog title={t("itemEditLocation")} onClose={() => { if (!locationBusy) setLocationOpen(false); }}>
				<div className="asset-item-location-fields">
					<label className="field"><span>{t("itemLocationArea")}</span><input value={locationArea} maxLength={300} disabled={locationBusy} onChange={(event) => { setLocationArea(event.target.value); setLocationError(""); }} /></label>
					<label className="field"><span>{t("itemLocationContainer")}</span><input value={locationContainer} maxLength={300} disabled={locationBusy} onChange={(event) => { setLocationContainer(event.target.value); setLocationError(""); }} /></label>
					<label className="field"><span>{t("itemLocationSpot")}</span><input value={locationSpot} maxLength={300} disabled={locationBusy} onChange={(event) => { setLocationSpot(event.target.value); setLocationError(""); }} /></label>
				</div>
				{locationError && <p className="field-error" role="alert">{locationError}</p>}
				<div className="actions"><Button disabled={locationBusy} onClick={() => setLocationOpen(false)}>{t("cancel")}</Button><Button variant="primary" disabled={locationBusy} onClick={() => void saveLocation()}>{t("itemSaveLocation")}</Button></div>
			</Dialog>}
			{asset.kind === "item" && itemStatusOpen && (
				<Dialog title={t("itemStatusChange")} onClose={() => { if (!itemInFlight.current) setItemStatusOpen(false); }}>
					<div className="form-grid">
						<label className="field" htmlFor="item-lifecycle-status">
							<span>{t("itemLifecycleStatus")}</span>
							<Select id="item-lifecycle-status" value={itemStatusDraft} onValueChange={(selectValue) => { setItemStatusDraft(selectValue as NonNullable<Asset["itemLifecycleStatus"]>); setItemStatusError(""); }}>
								{itemLifecycleStatuses.map((status) => <SelectOption key={status} value={status} disabled={asset.status === "loaned" && (status === "resold" || status === "retired")}>{t(`itemStatus_${status}`)}</SelectOption>)}
							</Select>
						</label>
						<label className="field" htmlFor="item-status-date">
							<span>{t("itemStatusDate")}</span>
							<input id="item-status-date" type="date" required value={itemStatusDateDraft} onChange={(event) => { setItemStatusDateDraft(event.target.value); setItemStatusError(""); }} />
						</label>
						<label className="field" htmlFor="item-status-note">
							<span>{t("itemStatusNote")}</span>
							<textarea id="item-status-note" maxLength={20000} value={itemStatusNote} onChange={(event) => setItemStatusNote(event.target.value)} />
						</label>
					</div>
					<p className="subtitle">{t("itemStatusLocalHint")}</p>
					{asset.status === "loaned" && <p className="subtitle">{t("itemStatusLoanedGuard")}</p>}
					{itemStatusError && <p className="field-error" role="alert">{itemStatusError}</p>}
					<div className="actions">
						<Button disabled={itemBusy} onClick={() => setItemStatusOpen(false)}>{t("cancel")}</Button>
						<Button variant="primary" disabled={itemBusy} onClick={() => void recordItemStatus()}>{t("itemStatusSave")}</Button>
					</div>
				</Dialog>
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
					<TaskEditor assetId={asset.id} className={kind === "account" ? "account-detail-dialog" : undefined} onClose={() => setTaskEdit(false)} />
				</Suspense>
			)}
			{relationEdit && (
				<Dialog
					className={kind === "account" ? "account-detail-dialog" : undefined}
					title={t(relationEditBase ? "editRelation" : "addRelation")}
					onClose={() => {
						if (!relationInFlight.current) setRelationEdit(false);
					}}
				>
					<div className="form-grid">
						<div className="field">
							<label htmlFor="relation-target">{t("target")}</label>
							<Select
								id="relation-target"
								value={relationTarget}
								disabled={!!relationEditBase || relationBusy}
								onValueChange={(selectValue) => setRelationTarget(selectValue)}
							>
								<SelectOption value="">{t("selectAsset")}</SelectOption>
									{relationTargetLabels(liveAssets(data).filter((a) => a.id !== asset.id), (kind) => t(kind))
									.map(({ asset: a, label }) => (
										<SelectOption key={a.id} value={a.id}>
											{label}
										</SelectOption>
									))}
							</Select>
						</div>
						<div className="field">
							<label htmlFor="relation-direction">{t("relationDirection")}</label>
							<Select id="relation-direction" contentClassName="relation-direction-options" value={relationDirection} disabled={!!relationEditBase || relationBusy} onValueChange={(value) => setRelationDirection(value === "incoming" ? "incoming" : "outgoing")}>
								<SelectOption value="outgoing">{t("relationDirectionOutgoing")}</SelectOption>
								<SelectOption value="incoming">{t("relationDirectionIncoming")}</SelectOption>
							</Select>
							{relationEditBase && <p className="subtitle">{t("relationDirectionFixed")}</p>}
						</div>
						<div className="field">
							<label htmlFor="relation-label">{t("relationLabel")}</label>
							<input
								id="relation-label"
								value={relationLabel}
								required aria-required="true"
								aria-invalid={relationLabelTouched && !relationLabel.trim() ? true : undefined}
								aria-describedby={relationLabelTouched && !relationLabel.trim() ? "relation-label-error" : undefined}
								maxLength={100} disabled={relationBusy}
								onChange={(e) => setRelationLabel(e.target.value)}
								onBlur={() => setRelationLabelTouched(true)}
							/>
							{relationLabelTouched && !relationLabel.trim() && <p id="relation-label-error" className="field-error" role="alert">{t("relationLabelRequired")}</p>}
						</div>
						<div className="field">
							<label htmlFor="relation-source">{t("relationSource")}</label>
							<input
								id="relation-source"
								value={relationSource}
								maxLength={500} disabled={relationBusy}
								onChange={(e) => setRelationSource(e.target.value)}
							/>
						</div>
						<div className="field">
							<label htmlFor="relation-verified">{t("verifiedAt")}</label>
							<input
								id="relation-verified"
								type={relationEditBase?.verifiedAt && !validCalendarDay(relationEditBase.verifiedAt.slice(0, 10)) ? "text" : "date"}
								value={relationVerifiedAt}
								disabled={relationBusy}
								onChange={(e) => setRelationVerifiedAt(e.target.value)}
							/>
						</div>
					</div>
					{relationError && (
						<p className="field-error" role="alert">
							{relationError}
						</p>
					)}
					{relationEditBase && <p className="subtitle">{data.assets.find(asset => asset.id === relationEditBase.from)?.name || t("graphEndpointUnavailable")} → {data.assets.find(asset => asset.id === relationEditBase.to)?.name || t("graphEndpointUnavailable")}</p>}
					{relationStale && <><p className="subtitle">{t("graphLatestRelation", { label: data.relations.find(item => item.id === relationEditBase?.id)?.label ?? t("graphNotRecorded"), source: data.relations.find(item => item.id === relationEditBase?.id)?.source || t("graphNotRecorded"), verified: data.relations.find(item => item.id === relationEditBase?.id)?.verifiedAt || t("graphNotRecorded") })}</p><Button disabled={relationBusy} onClick={() => void reviewLatestRelation()}>{t("graphReviewLatest")}</Button></>}

					<div className="actions">
						<Button
							variant="primary"
							disabled={
								!relationTarget || !relationLabel.trim() || relationBusy || relationStale
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
					className={kind === "account" ? "account-detail-dialog" : undefined}
					title={t("deleteRelation")}
					onClose={() => {
						if (!relationInFlight.current) {
							setRelationDeleteError("");
							setRelationToDelete(null);
						}
					}}
				>
					<p style={{ overflowWrap: "anywhere" }}>
						{t("deleteRelationConfirm", { label: relationToDelete.label })}
					</p>
					{relationDeleteError && (
						<p className="field-error" role="alert">
							{relationDeleteError}
						</p>
					)}
					<div className="actions">
						<Button
							disabled={relationBusy}
							onClick={() => {
								setRelationDeleteError("");
								setRelationToDelete(null);
							}}
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
					onClose={closeSubmission}
				>
					<div className="form-grid">
						<div className="field">
							<label htmlFor="submission-name">{t("name")}</label>
							<input
								id="submission-name"
								value={submissionName}
								disabled={submissionBusy}
								aria-invalid={!!submissionNameError}
								aria-describedby={submissionNameError ? "submission-name-error" : undefined}
								onChange={(e) => {
									setSubmissionName(e.target.value);
									setSubmissionNameError("");
								}}
							/>
							{submissionNameError && <small id="submission-name-error" role="alert">{submissionNameError}</small>}
						</div>
							<div className="field">
							<label htmlFor="submission-url">{t("url")}</label>
							<input
								id="submission-url"
								type="url"
								value={submissionUrl}
								disabled={submissionBusy}
								aria-invalid={!!submissionUrlError}
								aria-describedby={submissionUrlError ? "submission-url-error" : undefined}
								onChange={(e) => {
									setSubmissionUrl(e.target.value);
									setSubmissionUrlError("");
								}}
							/>
							{submissionUrlError && <small id="submission-url-error" role="alert">{submissionUrlError}</small>}
						</div>
						<div className="field">
							<label htmlFor="submission-status">{t("status")}</label>
							<Select id="submission-status" value={submissionStatus} disabled={submissionBusy} onValueChange={(selectValue) => { setSubmissionStatus(selectValue as Submission["status"]); setSubmissionSaveError(""); }}>
								{submissionStatuses.map((value) => <SelectOption key={value} value={value}>{t(value)}</SelectOption>)}
							</Select>
						</div>
						<div className="field">
							<label htmlFor="submission-date">{t("submittedAt")}</label>
							<input id="submission-date" type="date" value={submissionDate} disabled={submissionBusy || submissionStatus === "planned"} onChange={(event) => { setSubmissionDate(event.target.value); setSubmissionSaveError(""); }} />
						</div>
						<div className="field backlink-evidence-field">
							<label htmlFor="submission-evidence">{t("evidence")}</label>
							<input id="submission-evidence" value={submissionEvidence} disabled={submissionBusy} onChange={(event) => { setSubmissionEvidence(event.target.value); setSubmissionSaveError(""); }} />
							<small>{t("backlinkReceiptHint")}</small>
						</div>
					</div>
					{submissionSaveError && <p className="field-error" role="alert">{submissionSaveError}</p>}
					<div className="actions">
						<Button disabled={submissionBusy} onClick={closeSubmission}>{t("cancel")}</Button>
						<Button
							variant="primary"
							disabled={submissionBusy}
							onClick={() => void addSubmission()}
						>
							{t("save")}
						</Button>
					</div>
				</Dialog>
			)}
			{pendingImage && (
				<Dialog className={kind === "account" ? "account-detail-dialog" : undefined} title={t("preview")} onClose={() => setPendingImage(null)}>
					{pendingImageUrl && (
						<img
							className="image-preview"
							src={pendingImageUrl}
							alt={pendingImage.name}
							onLoad={() => setPendingImageStatus("ready")}
							onError={() => setPendingImageStatus("error")}
						/>
					)}
					<p style={{ overflowWrap: "anywhere" }}>{pendingImage.name}</p>
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
