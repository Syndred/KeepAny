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
import { ArrowDownRight, ArrowLeft, Check, ExternalLink, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	type Asset,
	type ProjectDomain,
	type Submission,
	type Relation,
	actualCharge,
	dueOnCycle,
	inputFromMinorUnits,
	monthlyMinorUnits,
	parseMinorUnits,
	projectDomainSchema,
	submissionSchema,
} from "../../../packages/domain/src";
import { buildImpactTasks, upgradeLegacyImpactTasks } from "../../../packages/domain/src/impact";
import {
	cleanupUnreferencedFile,
	deleteEntity,
	fileUrl,
	localRepository,
	putFile,
	recordItemAction as commitItemAction,
	recordRenewal,
	save,
	saveAssetIfCurrent,
	saveBatch,
	setItemArchived,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import "./asset-restoration.css";
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
				? localCalendarDay(new Date())
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
				{submission.externalLink && <small>{t("extImportedSource")} · {submission.externalLink.profileId}</small>}
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
	const [deleteError, setDeleteError] = useState("");
	const [deleteBusy, setDeleteBusy] = useState(false);
	const deleteInFlight = useRef(false);
	const [relationEdit, setRelationEdit] = useState(false);
	const [relationToDelete, setRelationToDelete] = useState<Relation | null>(
		null,
	);
	const [relationDeleteError, setRelationDeleteError] = useState("");
	const [relationBusy, setRelationBusy] = useState(false);
	const relationInFlight = useRef(false);
	const [relationError, setRelationError] = useState("");
	const [relationFilter, setRelationFilter] = useState("");
	const centerId = asset?.id;
	const relationReturnId = sessionStorage.getItem("keepany-relation-return-id");
	const relationReturnKind = sessionStorage.getItem("keepany-relation-return-kind");
	const returnKind = relationReturnId === asset?.id && relationReturnKind && validKind(relationReturnKind) === relationReturnKind ? relationReturnKind : kind;
	function visitRelation(target: Asset) {
		if (!asset || target.id === asset.id) return;
		if (relationReturnId !== asset.id || !relationReturnKind) sessionStorage.setItem("keepany-relation-return-kind", kind);
		sessionStorage.setItem("keepany-relation-return-id", target.id);
		void navigate({ to: "/assets/$kind/$id", params: { kind: target.kind, id: target.id } });
	}
	useEffect(() => {
		if (centerId) setRelationFilter("");
	}, [centerId]);
	const [submissionEdit, setSubmissionEdit] = useState(false);
	const [backlinksOpen, setBacklinksOpen] = useState(false);
	const [materialsOpen, setMaterialsOpen] = useState(false);
	const [domainEditing, setDomainEditing] = useState<string | null>(null);
	const [domainDraft, setDomainDraft] = useState<ProjectDomain | null>(null);
	const [domainFee, setDomainFee] = useState("");
	const [domainError, setDomainError] = useState("");
	const [domainBusy, setDomainBusy] = useState(false);
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
	const [itemBorrower, setItemBorrower] = useState("");
	const [itemLoanNote, setItemLoanNote] = useState("");
	const [itemMaintenanceNote, setItemMaintenanceNote] = useState("");
	const [itemEventDate, setItemEventDate] = useState(() => localCalendarDay(new Date()));
	const itemDateManuallySet = useRef(false);
	const [itemReminderDate, setItemReminderDate] = useState("");
	const [itemError, setItemError] = useState("");
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
	const relatedAssets = Array.from(new Map(relations.map((relation) => {
		const linked = liveById.get(relation.from === asset?.id ? relation.to : relation.from);
		return [linked?.id, linked] as const;
	})).values()).filter((linked): linked is Asset => !!linked);
	const relatedAccounts = relatedAssets.filter((linked) => linked.kind === "account");
	const relatedSubscriptions = relatedAssets.filter((linked) => linked.kind === "subscription" && linked.status === "active");
	const pendingBacklinks = submissions.filter((entry) => entry.status === "verify");
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
	const projectDomains = asset.kind === "project" ? (asset.projectDomains ?? []) : [];
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
		const next = domain ?? { id: crypto.randomUUID(), name: "", registrar: "", accountId: "", expiryDate: "", annualAmount: null, currency: "CNY", autoRenew: "unknown" } as ProjectDomain;
		setDomainDraft(next);
		setDomainFee(next.annualAmount === null ? "" : inputFromMinorUnits(next.annualAmount, next.currency));
		setDomainEditing(domain?.id ?? "new");
		setDomainError("");
	}
	async function storeDomains(next: ProjectDomain[]) {
		if (asset?.kind !== "project") return;
		await saveAssetIfCurrent(asset, { ...asset, projectDomains: next, updatedAt: new Date().toISOString() });
	}
	async function saveDomain() {
		if (!domainDraft || !domainEditing || domainBusy) return;
		let fee: number | null;
		try { fee = domainFee.trim() === "" ? null : parseMinorUnits(domainFee, domainDraft.currency); }
		catch { setDomainError(t("invalid")); return; }
		const parsed = projectDomainSchema.safeParse({ ...domainDraft, name: domainDraft.name.trim().toLowerCase(), annualAmount: fee });
		if (!parsed.success || (parsed.success && parsed.data.expiryDate && !validCalendarDay(parsed.data.expiryDate))) {
			setDomainError(t(!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "name") ? "projectDomainNameInvalid" : "invalid"));
			return;
		}
		if (projectDomains.some((domain) => domain.id !== domainEditing && domain.name.toLowerCase() === parsed.data.name.toLowerCase())) {
			setDomainError(t("duplicate"));
			return;
		}
		setDomainBusy(true);
		setDomainError("");
		try {
			await storeDomains(domainEditing === "new" ? [...projectDomains, parsed.data] : projectDomains.map((entry) => entry.id === domainEditing ? parsed.data : entry));
			setDomainEditing(null);
			notify(t("saved"));
		} catch (error) {
			setDomainError(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally { setDomainBusy(false); }
	}
	async function removeDomain() {
		if (!domainEditing || domainEditing === "new" || domainBusy) return;
		setDomainBusy(true);
		try {
			await storeDomains(projectDomains.filter((entry) => entry.id !== domainEditing));
			setDomainEditing(null);
			notify(t("saved"));
		} catch (error) {
			setDomainError(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally { setDomainBusy(false); }
	}
	async function confirmDelete() {
		if (!asset || deleteInFlight.current) return;
		deleteInFlight.current = true;
		setDeleteBusy(true);
		setDeleteError("");
		try {
			await deleteEntity("asset", asset.id);
			setDeleteOpen(false);
			await navigate({ to: "/assets/$kind", params: { kind } });
			notify(t("saved"));
		} catch (error) {
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
		setRelationDeleteError("");
		try {
			await deleteEntity("relation", relationToDelete.id);
			setRelationToDelete(null);
			notify(t("saved"));
		} catch {
			setRelationDeleteError(t("error"));
		} finally {
			relationInFlight.current = false;
			setRelationBusy(false);
		}
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
		setSubmissionSaveError("");
		if (nameError || urlError) return;
		submissionInFlight.current = true;
		setSubmissionBusy(true);
		try {
			await save("submission", {
				id: crypto.randomUUID(),
				assetId: asset.id,
				name,
				url,
				status: "planned",
				submittedAt: "",
				verifiedAt: "",
				evidence: "",
				deleted: false,
			});
			setSubmissionEdit(false);
			setBacklinksOpen(true);
			setSubmissionName("");
			setSubmissionUrl("");
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
		setSubmissionNameError("");
		setSubmissionUrlError("");
		setSubmissionSaveError("");
	}
	async function addImage(file: File) {
		if (!asset || imageInFlight.current) return;
		imageInFlight.current = true;
		setUploading(true);
		let fileId = "";
		try {
			fileId = await putFile(file);
			await saveAssetIfCurrent(asset, {
				...asset,
				attachments: replaceImageId
					? asset.attachments.map((id) => id === replaceImageId ? fileId : id)
					: [...asset.attachments, fileId],
				updatedAt: new Date().toISOString(),
			});
			if (replaceImageId) await cleanupUnreferencedFile(replaceImageId).catch(() => false);
			setPendingImage(null);
			setReplaceImageId("");
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
			await saveAssetIfCurrent(asset, {
				...asset,
				attachments: asset.attachments.filter((attachmentId) => attachmentId !== id),
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
	async function recordItem(action: "loan" | "return" | "maintenance") {
		if (!asset || itemInFlight.current) return;
		itemInFlight.current = true;
		setItemBusy(true);
		setItemError("");
		try {
			const borrower = action === "return" ? asset.borrower : itemBorrower.trim();
			const note = action === "maintenance" ? itemMaintenanceNote.trim() : itemLoanNote.trim();
			if (action === "loan" && !borrower) throw Error("item-borrower-required");
			if (action === "maintenance" && !note) throw Error("item-note-required");
			const now = new Date();
			const eventDate = action === "maintenance" && itemDateManuallySet.current
				? itemEventDate
				: localCalendarDay(now);
			if (action === "maintenance" && !itemDateManuallySet.current) setItemEventDate(eventDate);
			if (!validCalendarDay(eventDate)) throw Error("item-date-invalid");
			if (action === "maintenance" && itemReminderDate && !validCalendarDay(itemReminderDate)) throw Error("item-date-invalid");
			const historyId = crypto.randomUUID();
			const timestamp = now.toISOString();
			const next = {
				...asset,
				status: action === "loan" ? "loaned" as const : action === "return" ? "active" as const : asset.status,
				borrower: action === "loan" ? borrower : action === "return" ? "" : asset.borrower,
				lastItemEventId: historyId,
				updatedAt: timestamp,
			};
			await commitItemAction(asset, next, {
				id: historyId,
				assetId: asset.id,
				action,
				borrower: action === "maintenance" ? undefined : borrower,
				eventDate,
				note,
				createdAt: timestamp,
				deleted: false,
			});
			setItemRecoveryPending(false);
			setItemBorrower("");
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
	const attachmentSection = (
				<section className="card asset-attachments-card">
					<div className="card-header">
						<h2>{t(asset.kind === "project" ? "projectMaterialsImage" : "attachments")}</h2>
						<Button
							size="small"
							disabled={uploading || asset.attachments.length >= 20}
							onClick={() => { setReplaceImageId(""); imageInput.current?.click(); }}
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
										file.size > 20 * 1024 * 1024 ||
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
					{asset.attachments.length ? (
						<div className="image-grid">
							{asset.attachments.map((id) => (
								<div key={id} className="image-item">
									<ImageTile id={id} />
									<Button size="small" disabled={uploading} onClick={() => {
										setReplaceImageId(id);
										imageInput.current?.click();
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
	return (
		<main className={`page asset-detail asset-detail-${kind}${relations.length ? " has-relations" : ""}`}>
			{kind === "project" && <div className="asset-project-action-bar">
				<Button onClick={() => setEdit(true)}>{t("edit")}</Button>
				<Button variant="primary" onClick={() => setSubmissionEdit(true)}><Plus size={14} />{t("addSubmission")}</Button>
				<Button asChild><Link to="/assets/project/$id/workflow/$flow" params={{ id: asset.id, flow: "brand" }}>{t("workflowBrandEntry")}</Link></Button>
				<Button asChild><Link to="/assets/project/$id/workflow/$flow" params={{ id: asset.id, flow: "close" }}>{t("workflowCloseEntry")}</Link></Button>
				<Button variant="danger" disabled={deleteBusy} onClick={() => { setDeleteError(""); setDeleteOpen(true); }}>{t("delete")}</Button>
			</div>}
			<div className="page-header">
				<div>
					{kind !== "project" && <Link className="back-link" to="/assets/$kind" params={{ kind: returnKind }} onClick={() => { sessionStorage.removeItem("keepany-relation-return-id"); sessionStorage.removeItem("keepany-relation-return-kind"); }}>
						<ArrowLeft size={16} />
						{t("back")}
					</Link>}
					<div className="eyebrow">
						{t(kind)} · {niceCategory(asset.category, t)}
					</div>
					<h1>{asset.name}</h1>
					<p className="subtitle">
						{asset.description || asset.url || t("local")}
					</p>
					{kind === "project" && <div className="asset-project-hero-meta"><span>{niceCategory(asset.category, t)}</span>{asset.status && <span>{t(asset.status)}</span>}{asset.url && <a href={asset.url} target="_blank" rel="noopener noreferrer">{asset.url}<ExternalLink size={13} /></a>}</div>}
					{kind === "project" && <div className="asset-project-hero-actions">
						<Button onClick={() => scrollToFold("asset-project-materials", setMaterialsOpen)}>{t("projectViewMaterials")}<ArrowDownRight size={15} /></Button>
						<Button onClick={() => scrollToFold("asset-backlinks", setBacklinksOpen)}>{t("projectViewBacklinks")}<ArrowDownRight size={15} /></Button>
					</div>}
				</div>
				{kind === "project" && <div className="asset-project-hero-visual" role="img" aria-label={t("preview")}><ProjectPreview asset={asset} /></div>}
				{kind !== "project" && <div className="actions">
					{kind === "subscription" && <Button asChild><Link to="/finance">{t("financeViewLedger")}</Link></Button>}
					<Button onClick={() => setEdit(true)}>{t("edit")}</Button>
					<Button
						variant="danger"
						disabled={deleteBusy}
						onClick={() => { setDeleteError(""); setDeleteOpen(true); }}
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
			{deleteOpen && (
				<Dialog
					title={t("delete")}
					onClose={() => {
						if (!deleteInFlight.current) setDeleteOpen(false);
					}}
				>
					<p>{t("deleteConfirm")}</p>
					{deleteError && <p className="field-error" role="alert">{deleteError}</p>}
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
			<div className="detail-grid asset-detail-primary">
				{asset.kind === "project" && <section className="card asset-profile-card asset-project-profile-card">
					<div className="card-header"><h2>{t("profile")}</h2></div>
					<dl className="asset-project-facts">
						<div><dt>{t("projectOfficialUrl")}</dt><dd>{asset.url ? <a href={asset.url} target="_blank" rel="noopener noreferrer">{asset.url}</a> : "—"}</dd></div>
						<div><dt>{t("projectType")}</dt><dd>{niceCategory(asset.category, t) || "—"}</dd></div>
						<div><dt>{t("projectLaunchMonth")}</dt><dd>{asset.projectLaunchMonth ? new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${asset.projectLaunchMonth}-01T12:00:00Z`)) : "—"}</dd></div>
						<div><dt>{t("projectAccount")}</dt><dd>{relatedAccounts.length ? relatedAccounts.map((linked, index) => <span key={linked.id}>{index > 0 && " · "}<Link to="/assets/$kind/$id" params={{ kind: linked.kind, id: linked.id }} onClick={(event) => { event.preventDefault(); visitRelation(linked); }}>{linked.name}</Link></span>) : "—"}</dd></div>
					</dl>
					<div className="asset-project-related">
						<div className="card-header"><h3>{t("related")}</h3></div>
						{relatedAssets.length ? <div className="asset-project-related-list">{relatedAssets.map((linked) => <Link key={linked.id} className="asset-project-related-card" to="/assets/$kind/$id" params={{ kind: linked.kind, id: linked.id }} onClick={(event) => { event.preventDefault(); visitRelation(linked); }}><span className="asset-project-related-icon" aria-hidden="true">{linked.name.charAt(0).toUpperCase()}</span><span><strong>{linked.name}</strong><small>{t(linked.kind)}{linked.kind === "subscription" ? ` · ${money(linked.amount, linked.currency, i18n.language)}` : linked.username ? ` · ${linked.username}` : ""}</small></span><ArrowDownRight size={15} aria-hidden="true" /></Link>)}</div> : <p className="asset-quiet-empty">{t("none")}</p>}
					</div>
				</section>}
				{asset.kind === "project" && <section className="card asset-project-reminders" id="project-reminders">
					<div className="card-header"><h2>{t("projectLinkReminders")}</h2></div>
					{pendingBacklinks.length ? <button type="button" className="asset-project-reminder-row" onClick={() => scrollToFold("asset-backlinks", setBacklinksOpen)}><span className="asset-project-reminder-symbol" aria-hidden="true">!</span><span><strong>{t("projectVerifyCount", { count: pendingBacklinks.length })}</strong><small>{t("projectViewBacklinks")}</small></span><ArrowDownRight size={16} /></button> : <p className="asset-quiet-empty">{t("projectNoLinkReminders")}</p>}
					<div className="asset-project-reminder-row asset-project-reminder-static"><span className="asset-project-reminder-symbol" aria-hidden="true">↗</span><span><strong>{t("projectNextInspection")}</strong><small>{asset.projectInspectionDate ? date(asset.projectInspectionDate, i18n.language) : t("projectNoInspection")}</small></span></div>
				</section>}
				{asset.kind !== "project" && <section className="card asset-profile-card">
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
								{asset.status === "loaned" && asset.borrower && (
									<div>
										<dt>{t("borrower")}</dt>
										<dd>{asset.borrower}</dd>
									</div>
								)}
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
				</section>}
				{asset.kind !== "project" && attachmentSection}
			</div>
			{asset.kind === "project" && <section className="card asset-project-costs">
				<div className="card-header"><h2>{t("projectDomainCosts")}</h2><Button size="small" onClick={() => openDomain()}><Plus size={14} />{t("projectAddDomain")}</Button></div>
				<div className="asset-project-cost-grid">
					<div><small>{t("projectMonthlyCost")}</small><strong>{formatTotals(monthlyByCurrency)}</strong><small>{relatedSubscriptions.length} {t("projectLinkedSubscriptions")}</small></div>
					<div><small>{t("projectAnnualEstimate")}</small><strong>{formatTotals(annualByCurrency)}</strong>{incompleteCost && <small>{t("projectCostPartial")}</small>}</div>
					<div><small>{t("projectNextRenewal")}</small><strong>{nextRenewal ? date(nextRenewal, i18n.language) : "—"}</strong><small>{projectDomains.length} {t("projectDomain")}</small></div>
				</div>
				{projectDomains.length ? <div className="asset-project-domain-list">{projectDomains.map((domain) => <div className="asset-project-domain-row" key={domain.id}><div><strong>{domain.name}</strong><small>{[domain.registrar, domain.accountId ? liveById.get(domain.accountId)?.name : "", domain.annualAmount === null ? "" : `${money(domain.annualAmount, domain.currency, i18n.language)} / ${t("year")}`].filter(Boolean).join(" · ") || "—"}</small><span>{t("projectExpiry")}: {date(domain.expiryDate, i18n.language)} · {t("projectAutoRenew")}: {t(domain.autoRenew === "on" ? "projectAutoRenewOn" : domain.autoRenew === "off" ? "projectAutoRenewOff" : "projectAutoRenewUnknown")}</span></div><Button size="small" onClick={() => openDomain(domain)}>{t("edit")}</Button></div>)}</div> : <p className="asset-quiet-empty">{t("projectNoDomains")}</p>}
				<details className="asset-project-linked-subscriptions"><summary>{t("projectLinkedSubscriptions")} · {relatedSubscriptions.length}</summary>{relatedSubscriptions.length ? relatedSubscriptions.map((linked) => <Link key={linked.id} to="/assets/$kind/$id" params={{ kind: linked.kind, id: linked.id }} onClick={(event) => { event.preventDefault(); visitRelation(linked); }}><strong>{linked.name}</strong><span>{money(linked.amount, linked.currency, i18n.language)} / {t(linked.cycle)} · {date(linked.dueDate, i18n.language)}</span></Link>) : <p className="asset-quiet-empty">{t("none")}</p>}</details>
			</section>}
			{asset.kind === "project" && domainEditing && domainDraft && <Dialog title={domainEditing === "new" ? t("projectAddDomain") : t("projectEditDomain")} onClose={() => { if (!domainBusy) setDomainEditing(null); }}>
				<form className="asset-project-domain-form" onSubmit={(event) => { event.preventDefault(); void saveDomain(); }}>
					<label>{t("projectDomain")}<input required value={domainDraft.name} onChange={(event) => setDomainDraft({ ...domainDraft, name: event.target.value })} placeholder="example.com" /></label>
					<label>{t("projectRegistrar")}<input value={domainDraft.registrar} onChange={(event) => setDomainDraft({ ...domainDraft, registrar: event.target.value })} /></label>
					<label>{t("projectDomainAccount")}<select value={domainDraft.accountId} onChange={(event) => setDomainDraft({ ...domainDraft, accountId: event.target.value })}><option value="">—</option>{liveAssets(data).filter((entry) => entry.kind === "account").map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
					<label>{t("projectExpiry")}<input type="date" value={domainDraft.expiryDate} onChange={(event) => setDomainDraft({ ...domainDraft, expiryDate: event.target.value })} /></label>
					<label>{t("projectAnnualFee")}<span className="asset-project-fee-row"><input inputMode="decimal" value={domainFee} onChange={(event) => setDomainFee(event.target.value)} /><select aria-label={t("currency")} value={domainDraft.currency} onChange={(event) => { const currency = event.target.value as ProjectDomain["currency"]; setDomainDraft({ ...domainDraft, currency }); setDomainFee(""); }}><option>CNY</option><option>USD</option><option>EUR</option><option>GBP</option><option>JPY</option></select></span></label>
					<label>{t("projectAutoRenew")}<select value={domainDraft.autoRenew} onChange={(event) => setDomainDraft({ ...domainDraft, autoRenew: event.target.value as ProjectDomain["autoRenew"] })}><option value="unknown">{t("projectAutoRenewUnknown")}</option><option value="on">{t("projectAutoRenewOn")}</option><option value="off">{t("projectAutoRenewOff")}</option></select></label>
					{domainError && <p role="alert" className="field-error">{domainError}</p>}
					<div className="actions"><Button type="submit" variant="primary" disabled={domainBusy}>{t("save")}</Button>{domainEditing !== "new" && <Button type="button" variant="danger" disabled={domainBusy} onClick={() => void removeDomain()}>{t("projectDomainDelete")}</Button>}<Button type="button" disabled={domainBusy} onClick={() => setDomainEditing(null)}>{t("cancel")}</Button></div>
				</form>
			</Dialog>}
			<div className="detail-grid asset-detail-secondary">
				<section className="card asset-relations-card">
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
												className: "asset-graph-center",
											},
											...visibleRelated.map((a, i) => ({
												id: a.id,
												position: {
													x: 20 + (i % 3) * 180,
													y: 240 + Math.floor(i / 3) * 110,
												},
												data: { label: a.name },
												type: "default",
												className: "asset-graph-neighbor",
											})),
										] as Node[]
									}
									edges={graphEdges}
									onNodeClick={(_, node) => {
										const target = liveById.get(node.id);
										if (target) visitRelation(target);
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
																onClick={(event) => { event.preventDefault(); visitRelation(neighbor); }}
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
													onClick={() => {
														setRelationDeleteError("");
														setRelationToDelete(relation);
													}}
												>
													{t("remove")}
												</Button>
											</div>
										);
									})}
								</div>
							) : (
								asset.kind === "project" ? <p className="asset-quiet-empty">{t("noMatches")}</p> : <Empty hint={false} />
							)}
						</>
					) : (
						asset.kind === "project" ? <p className="asset-quiet-empty">{t("none")}</p> : <Empty hint={false} />
					)}
				</section>
				<section className="card asset-tasks-card">
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
						asset.kind === "project" ? <p className="asset-quiet-empty">{t("none")}</p> : <Empty hint={false} />
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
				<details className="card asset-backlinks-card" id="asset-backlinks" open={backlinksOpen} onToggle={(event) => setBacklinksOpen(event.currentTarget.open)}>
					<summary>{t("backlinks")}</summary>
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
						<p className="asset-quiet-empty">{t("none")}</p>
					)}
				</details>
			)}
			{asset.kind === "project" && <details className="card asset-project-materials" id="asset-project-materials" open={materialsOpen} onToggle={(event) => setMaterialsOpen(event.currentTarget.open)}>
				<summary>{t("projectProfileMaterials")}</summary>
				<div className="asset-project-materials-body">
					<div className="card-header"><h2>{t("projectViewMaterials")}</h2><Button size="small" onClick={() => setEdit(true)}>{t("edit")}</Button></div>
					<div className="asset-project-copy"><strong>{t("projectMaterialsShort")}</strong><p>{asset.description || "—"}</p></div>
					<div className="asset-project-copy"><strong>{t("projectMaterialsLong")}</strong><p>{asset.longDescription || "—"}</p></div>
					{attachmentSection}
				</div>
			</details>}
			{(asset.kind === "item" || asset.kind === "subscription") && (
				<section className="card">
					<div className="card-header">
						<h2>{t("history")}</h2>
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
									<label className="field">
										<span>{t("borrower")}</span>
										<input value={itemBorrower} maxLength={200} onChange={(event) => { setItemBorrower(event.target.value); setItemError(""); }} />
									</label>
								)}
								<label className="field">
									<span>{t("loanReturnNote")}</span>
									<input value={itemLoanNote} onChange={(event) => { setItemLoanNote(event.target.value); setItemError(""); }} />
								</label>
								<Button
									disabled={itemBusy || !["active", "loaned"].includes(asset.status)}
									onClick={() => void recordItem(asset.status === "loaned" ? "return" : "loan")}
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
									disabled={itemBusy || !["active", "loaned"].includes(asset.status)}
									onClick={() => void recordItem("maintenance")}
								>
									{t("maintenance")}
								</Button>
							</div>
						</>
					)}
					{asset.kind === "subscription" && <p className="subtitle">{t("renewalLocalHint")}</p>}
					{histories.length ? (
						<div className="list">
							{histories.map((h) => (
								<div className="list-row" key={h.id}>
									<Check size={17} />
									<div>
										<strong>{t(h.action)}</strong>
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
