import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	assetSchema,
	taskSchema,
	currencies,
	duplicates,
	inputFromMinorUnits,
	newAsset,
	parseMinorUnits,
	type Asset,
	type AssetKind,
	type Category,
	type ProjectMedia,
	type Task,
} from "../../../packages/domain/src";
import { createMaintenanceSchedule, type RepeatRule } from "../../../packages/domain/src/task-repeat";
import {
	decryptBackup,
	encryptBackup,
	BACKUP_CONTAINER_MAX_BYTES,
} from "../../../packages/local-db/src/backup-crypto";
import {
	allRecords,
	exportArchive,
	inspectArchive,
	localRepository,
	fileUrl,
	putFile,
	cleanupUnreferencedFile,
	restoreArchive,
	save,
	saveAssetIfCurrent,
	saveSubscription,
	getPendingSubscriptionSave,
	retrySubscriptionSave,
	abandonSubscriptionSave,
	saveBatch,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { RemoteBackupPanel } from "./components/RemoteBackupPanel";
import { RestoreRecoveryPanel } from "./components/RestoreRecoveryPanel";
import { stageCsvForReview } from "./intake-csv";
import { AiWorkspaceDialog } from "./AiWorkspaceDialog";
import { builtins as categoryOptions, useAppContext } from "./view-shared";
import "./project-editor.css";
import { Select, SelectOption } from "./components/ui/select";

type FieldName = keyof Asset;
type ProjectFormFiles = { logo?: File; home?: File; products?: File[]; promo?: File };
const projectImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function ProjectFormImage({ id, file }: { id?: string; file?: File }) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		let active = true;
		let current = "";
		const source = file ? Promise.resolve(URL.createObjectURL(file)) : id ? fileUrl(id) : null;
		if (!source) return;
		void source.then((value) => {
			current = value;
			if (active) setUrl(value);
			else if (value) URL.revokeObjectURL(value);
		}).catch(() => { if (active) setUrl(""); });
		return () => { active = false; if (current) URL.revokeObjectURL(current); };
	}, [id, file]);
	return url ? <img className="project-editor-image" src={url} alt="" /> : null;
}

function Field({
	label,
	name,
	value,
	onChange,
	type = "text",
	autoComplete,
	error,
	children,
}: {
	label: string;
	name: string;
	value?: string | number;
	onChange?: (s: string) => void;
	type?: string;
	autoComplete?: string;
	error?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="field">
			<label htmlFor={name}>{label}</label>
			{children ?? (
				<input
					id={name}
					name={name}
					type={type}
					autoComplete={autoComplete}
					step={type === "number" ? "any" : undefined}
					value={value ?? ""}
					onChange={(e) => onChange?.(e.target.value)}
					aria-invalid={!!error}
					aria-describedby={error ? `${name}-error` : undefined}
				/>
			)}
			{error && (
				<small id={`${name}-error`} className="field-error">
					{error}
				</small>
			)}
		</div>
	);
}

export function AssetEditor({
	kind,
	asset,
	categories = [],
	onClose,
}: {
	kind: AssetKind;
	asset?: Asset;
	categories?: Category[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const originalRef = useRef(asset);
	const original = originalRef.current;
	const linkedSubscriptionAssets = original?.kind === "subscription" ? data.relations
		.filter((relation) => !relation.deleted && (relation.from === original.id || relation.to === original.id))
		.map((relation) => data.assets.find((candidate) => candidate.id === (relation.from === original.id ? relation.to : relation.from)))
		.filter((candidate): candidate is Asset => !!candidate && !candidate.deleted) : [];
	const linkedProjects = linkedSubscriptionAssets.filter((candidate) => candidate.kind === "project");
	const linkedAccounts = linkedSubscriptionAssets.filter((candidate) => candidate.kind === "account");
	const [projectId, setProjectId] = useState(() => linkedProjects.length === 1 ? linkedProjects[0].id : "");
	const [accountId, setAccountId] = useState(() => linkedAccounts.length === 1 ? linkedAccounts[0].id : "");
	const [vaultRelatedId, setVaultRelatedId] = useState("");
	const [vaultVerifiedAt, setVaultVerifiedAt] = useState("");
	const [draft, setDraft] = useState<Asset>(
		() =>
			(original && (kind === "project" || kind === "account" || kind === "subscription") ? assetSchema.parse(original) : original) ?? {
				...newAsset(kind),
				name: "",
				category: categoryOptions[kind][0],
			},
	);
	const [amount, setAmount] = useState(
		kind === "item" && !asset?.itemPurchasePriceKnown
			? ""
			: asset?.amount != null
			? inputFromMinorUnits(asset.amount, asset.currency)
			: "0",
	);
	const [discount, setDiscount] = useState(
		asset?.discountAmount != null
			? inputFromMinorUnits(asset.discountAmount, asset.currency)
			: "0",
	);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [tagsInput, setTagsInput] = useState(() => original?.tags.join(", ") ?? "");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const [pendingConnections, setPendingConnections] = useState(false);
	const [checkingConnections, setCheckingConnections] = useState(kind === "subscription");
	const [projectFiles, setProjectFiles] = useState<ProjectFormFiles>({});
	const inFlight = useRef(false);
	useEffect(() => {
		if (kind !== "subscription") return;
		let active = true;
		void getPendingSubscriptionSave(draft.id).then(pending => {
			if (active) setPendingConnections(!!pending);
		}).catch(() => { if (active) setFailure(t("error")); })
			.finally(() => { if (active) setCheckingConnections(false); });
		return () => { active = false; };
	}, [kind, draft.id, t]);
	async function resolveConnections(abandon: boolean) {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setFailure("");
		try {
			await (abandon ? abandonSubscriptionSave(draft.id) : retrySubscriptionSave(draft.id));
			const current = await (await localRepository()).get<Asset>("asset", draft.id);
			if (current) {
				originalRef.current = current;
				setDraft(current);
				setAmount(inputFromMinorUnits(current.amount, current.currency));
				setDiscount(inputFromMinorUnits(current.discountAmount, current.currency));
				setTagsInput(current.tags.join(", "));
			}
			if (abandon) { setProjectId(""); setAccountId(""); }
			setPendingConnections(!!(await getPendingSubscriptionSave(draft.id)));
			if (!abandon) onClose();
		} catch { setFailure(t("subscriptionPendingConnections")); }
		finally { inFlight.current = false; setBusy(false); }
	}
	function closeIfIdle() {
		if (!inFlight.current) onClose();
	}
	function set<K extends FieldName>(key: K, value: Asset[K]) {
		setDraft((prev) => ({ ...prev, [key]: value }));
		setErrors((prev) => ({ ...prev, [key]: "" }));
	}
	function selectProjectFiles(key: keyof ProjectFormFiles, files: FileList | null) {
		const selected = files ? Array.from(files) : [];
		setProjectFiles((previous) => ({ ...previous, [key]: key === "products" ? selected : selected[0] }));
		setErrors((previous) => ({ ...previous, projectMedia: "" }));
	}
	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (inFlight.current || pendingConnections || checkingConnections) return;
		const selectedFiles = kind === "project"
			? [projectFiles.logo, projectFiles.home, ...(projectFiles.products ?? []), projectFiles.promo].filter((file): file is File => !!file)
			: [];
		const previousMedia = draft.projectMedia;
		const replacedIds = kind === "project" ? new Set([
			projectFiles.logo ? previousMedia.logoId : "",
			projectFiles.home ? previousMedia.homeScreenshotId : "",
			projectFiles.promo ? previousMedia.promoCoverId : "",
			...(projectFiles.products?.length ? previousMedia.productScreenshotIds : []),
		].filter(Boolean)) : new Set<string>();
		if ((projectFiles.products?.length ?? 0) > 4) {
			setErrors((previous) => ({ ...previous, projectMedia: t("projectProductScreenshotsLimit") }));
			return;
		}
		if (draft.attachments.length - replacedIds.size + selectedFiles.length > 20) {
			setErrors((previous) => ({ ...previous, projectMedia: t("projectMediaAttachmentLimit") }));
			return;
		}
		if (selectedFiles.some((file) => file.name.length > 255 || file.size > 20 * 1024 * 1024 || !projectImageTypes.has(file.type))) {
			setErrors((previous) => ({ ...previous, projectMedia: t("uploadError") }));
			return;
		}
		const parsedAmount = kind === "item" && !amount.trim() ? 0 : parseMinorUnits(amount, draft.currency);
		const parsedDiscount = kind === "subscription" ? parseMinorUnits(discount, draft.currency) : draft.discountAmount;
		const scheduleChanged =
			kind === "subscription" &&
			original !== undefined &&
			(draft.dueDate !== original.dueDate ||
				draft.cycle !== original.cycle ||
				draft.interval !== original.interval);
		const parsed = assetSchema.safeParse({
			...draft,
			tags: tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
			name: draft.name.trim(),
			subscriptionPaymentMethod: kind === "subscription" ? draft.subscriptionPaymentMethod.trim() : draft.subscriptionPaymentMethod,
			amount: parsedAmount,
			itemPurchasePriceKnown: kind === "item" ? !!amount.trim() : draft.itemPurchasePriceKnown,
			discountAmount: parsedDiscount,
			billingAnchor:
				kind === "subscription" && (scheduleChanged || !draft.billingAnchor)
					? draft.dueDate
					: draft.billingAnchor,
			renewalCount: scheduleChanged ? 0 : draft.renewalCount,
			cancelledAt:
				kind === "subscription" &&
				draft.status === "cancelled" &&
				original?.status !== "cancelled"
					? new Date().toISOString()
					: kind === "subscription" && draft.status !== "cancelled"
						? ""
						: draft.cancelledAt,
			updatedAt: new Date().toISOString(),
		});
		if (!parsed.success) {
			setErrors(
				Object.fromEntries(
					parsed.error.issues.map((issue) => [
						String(issue.path[0]),
						t("invalid"),
					]),
				),
			);
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setFailure("");
		const uploadedIds: string[] = [];
		let candidate: Asset | null = null;
		let saveAttempted = false;
		try {
			if (kind === "project" && selectedFiles.length) {
				const media: ProjectMedia = { ...previousMedia, productScreenshotIds: [...previousMedia.productScreenshotIds] };
				const upload = async (file: File) => { const id = await putFile(file); uploadedIds.push(id); return id; };
				if (projectFiles.logo) media.logoId = await upload(projectFiles.logo);
				if (projectFiles.home) media.homeScreenshotId = await upload(projectFiles.home);
				if (projectFiles.products?.length) {
					media.productScreenshotIds = [];
					for (const file of projectFiles.products) media.productScreenshotIds.push(await upload(file));
				}
				if (projectFiles.promo) media.promoCoverId = await upload(projectFiles.promo);
				const attachments = [
					...parsed.data.attachments.filter((id) => !replacedIds.has(id)),
					...uploadedIds,
				];
				if (projectFiles.home) {
					attachments.splice(attachments.indexOf(media.homeScreenshotId), 1);
					attachments.unshift(media.homeScreenshotId);
				}
				candidate = assetSchema.parse({ ...parsed.data, attachments, projectMedia: media });
			} else candidate = parsed.data;
			const assetToSave = candidate;
			const selectedLinks = kind === "subscription" ? [
				{ id: projectId, kind: "project" as const, label: t("subscriptionProject") },
				{ id: accountId, kind: "account" as const, label: t("subscriptionLoginAccount") },
			].filter((link) => !!link.id) : [];
			if (kind === "subscription") {
				saveAttempted = true;
				originalRef.current = await saveSubscription(original ?? null, assetToSave, selectedLinks);
			} else if (original) {
				saveAttempted = true;
				await saveAssetIfCurrent(original, candidate);
				originalRef.current = candidate;
			}
			else if (kind === "vault" && vaultRelatedId) {
				const linked = data.assets.some((candidate) => candidate.id === vaultRelatedId && !candidate.deleted && candidate.kind !== "vault");
				if (!linked) throw Error("relation-endpoint");
				await saveBatch([
					{ type: "asset", value: candidate },
					{ type: "relation", value: { id: crypto.randomUUID(), from: candidate.id, to: vaultRelatedId, label: t("vault"), createdAt: new Date().toISOString(), verifiedAt: vaultVerifiedAt, deleted: false } },
				]);
			} else { saveAttempted = true; await save("asset", candidate); }
			if (uploadedIds.length) {
				const cleanup = await Promise.allSettled([...replacedIds].map((id) => cleanupUnreferencedFile(id)));
				if (cleanup.some((result) => result.status === "rejected")) notify(t("projectMediaCleanupPending"));
			}
			onClose();
		} catch (error) {
			if (kind === "subscription" && candidate && error instanceof Error && error.message === "subscription-relations-pending") {
				setPendingConnections(true);
				try {
					const current = await (await localRepository()).get<Asset>("asset", candidate.id);
					if (current) originalRef.current = current;
				} catch { /* Keep the persistent intent for the next open/retry. */ }
			}
			if (uploadedIds.length) {
				let safeToCleanup = !saveAttempted;
				if (saveAttempted && candidate) {
					try {
						const current = await (await localRepository()).get<Asset>("asset", candidate.id);
						if (current && uploadedIds.every((id) => current.attachments.includes(id))) {
							originalRef.current = current;
							notify(t("projectMediaSavedCheck"));
							onClose();
							return;
						}
						safeToCleanup = true;
					} catch { setFailure(t("projectMediaSaveUnknown")); return; }
				}
				if (safeToCleanup) {
					const cleanup = await Promise.allSettled(uploadedIds.map((id) => cleanupUnreferencedFile(id)));
					if (cleanup.some((result) => result.status === "rejected" || !result.value)) {
						setFailure(t("projectMediaUploadCleanupPending"));
						return;
					}
				}
			}
			const reason = error instanceof Error ? error.message : "";
			setFailure(t(reason === "asset-stale" ? "assetStale" :
				reason === "relation-endpoint" ? "subscriptionRelationUnavailable" :
				reason === "subscription-relations-pending" ? "subscriptionRelationsNotSaved" :
				reason === "asset-stale-renewal" ? "renewalStale" :
				reason === "item-stale" ? "itemStale" :
				reason === "renewal-recovery-pending" && kind === "item" ? "itemRecoveryPending" : "error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<Dialog title={asset ? t("edit") : t("newRecord")} className={kind === "account" ? "account-detail-dialog" : undefined} onClose={closeIfIdle}>
			<form className={kind === "project" ? "project-editor" : undefined} onSubmit={(e) => void submit(e)}>
				<div className="form-grid">
					<Field
						name="name"
						label={t(kind === "vault" ? "vaultEntryName" : "name")}
						value={draft.name}
						onChange={(v) => set("name", v)}
						error={errors.name}
					/>
					<Field name="category" label={t("category")} error={errors.category}>
						<Select
							id="category"
							value={draft.category}
							onValueChange={(selectValue) => set("category", selectValue)}
						>
							{[
								...new Set([
									draft.category,
									...categoryOptions[kind],
									...categories
										.filter((c) => c.kind === kind && !c.deleted)
										.map((c) => c.name),
								]),
							].map((c) => (
								<SelectOption key={c} value={c}>
									{t(c)}
								</SelectOption>
							))}
						</Select>
					</Field>
					{kind !== "item" && (
						<Field
							name="url"
							label={t("url")}
							value={draft.url}
							onChange={(v) => set("url", v)}
							type="url"
							error={errors.url}
						/>
					)}
					{kind === "project" && (
						<>
							<Field
								name="projectLaunchMonth"
								label={t("projectLaunchMonth")}
								type="month"
								value={draft.projectLaunchMonth}
								onChange={(v) => set("projectLaunchMonth", v)}
								error={errors.projectLaunchMonth}
							/>
							<Field
								name="projectInspectionDate"
								label={t("projectNextInspection")}
								type="date"
								value={draft.projectInspectionDate}
								onChange={(v) => set("projectInspectionDate", v)}
								error={errors.projectInspectionDate}
							/>
							<Field
								name="contact"
								label={t("contact")}
								value={draft.contact}
								onChange={(v) => set("contact", v)}
								error={errors.contact}
							/>
							<Field
								name="description"
								label={t("description")}
								value={draft.description}
								onChange={(v) => set("description", v)}
								error={errors.description}
							/>
							<details className="project-editor-group" open>
								<summary>{t("projectPositioning")}</summary>
								<div className="project-editor-fields">
									<Field name="projectTitle" label={t("projectProductTitle")} value={draft.projectTitle} onChange={(v) => set("projectTitle", v)} error={errors.projectTitle} />
									<Field name="projectPromoUrl" label={t("projectPromoUrl")} type="url" value={draft.projectPromoUrl} onChange={(v) => set("projectPromoUrl", v)} error={errors.projectPromoUrl} />
									<Field name="tags" label={t("tags")} value={tagsInput} onChange={(value) => { setTagsInput(value); setErrors((previous) => ({ ...previous, tags: "" })); }} error={errors.tags} />
								</div>
							</details>
							<details className="project-editor-group">
								<summary>{t("projectIntroductionPricing")}</summary>
								<div className="project-editor-fields">
									<Field name="projectMediumDescription" label={t("projectMediumDescription")} error={errors.projectMediumDescription}><textarea id="projectMediumDescription" rows={4} value={draft.projectMediumDescription} onChange={(event) => set("projectMediumDescription", event.target.value)} /></Field>
									<Field name="longDescription" label={t("projectFullDescription")} error={errors.longDescription}><textarea id="longDescription" rows={4} value={draft.longDescription} onChange={(event) => set("longDescription", event.target.value)} /></Field>
									<Field name="projectFeatures" label={t("projectFeatures")} error={errors.projectFeatures}><textarea id="projectFeatures" rows={4} value={draft.projectFeatures} onChange={(event) => set("projectFeatures", event.target.value)} /></Field>
									<Field name="projectPricing" label={t("projectPricing")} error={errors.projectPricing}><textarea id="projectPricing" rows={4} value={draft.projectPricing} onChange={(event) => set("projectPricing", event.target.value)} /></Field>
									<Field name="projectPricingType" label={t("projectPricingType")} value={draft.projectPricingType} onChange={(v) => set("projectPricingType", v)} error={errors.projectPricingType} />
								</div>
							</details>
							<details className="project-editor-group">
								<summary>{t("projectContactDetails")}</summary>
								<div className="project-editor-fields">
									<Field name="projectEmail" label={t("projectBusinessEmail")} type="email" value={draft.projectEmail} onChange={(v) => set("projectEmail", v)} error={errors.projectEmail} />
									<Field name="notes" label={t("projectAdditionalNotes")} error={errors.notes}><textarea id="notes" rows={4} value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
								</div>
							</details>
						</>
					)}
					{kind === "account" && (
						<>
							<Field name="accountProvider" label={t("accountProvider")} value={draft.accountProvider} onChange={(value) => set("accountProvider", value)} error={errors.accountProvider} />
							<Field
								name="username"
								label={t("username")}
								value={draft.username}
								onChange={(v) => set("username", v)}
								error={errors.username}
							/>
							<Field
								name="contact"
								label={t("contact")}
								value={draft.contact}
								onChange={(v) => set("contact", v)}
								error={errors.contact}
							/>
							<Field name="description" label={t("accountPurpose")} error={errors.description}>
								<textarea id="description" rows={3} value={draft.description} onChange={(event) => set("description", event.target.value)} />
							</Field>
							<Field name="status" label={t("status")}>
								<Select id="status" value={draft.status} onValueChange={(selectValue) => set("status", selectValue as Asset["status"])}>
									{["active", "paused", "cancelled", "archived"].map((value) => <SelectOption value={value} key={value}>{t(value)}</SelectOption>)}
								</Select>
							</Field>
							<Field name="accountProfileVerifiedAt" label={t("accountProfileVerifiedAt")} type="date" value={draft.accountProfileVerifiedAt} onChange={(value) => set("accountProfileVerifiedAt", value)} error={errors.accountProfileVerifiedAt} />
						</>
					)}
					{kind === "subscription" && (
						<>
							<Field name="subscriptionProject" label={t("subscriptionProject")}>
								<Select id="subscriptionProject" value={projectId} onValueChange={(selectValue) => setProjectId(selectValue)}>
									<SelectOption value="">{t("none")}</SelectOption>
									{data.assets.filter((candidate) => candidate.kind === "project" && !candidate.deleted).map((candidate) => <SelectOption key={candidate.id} value={candidate.id}>{candidate.name}</SelectOption>)}
								</Select>
							</Field>
							<Field name="subscriptionLoginAccount" label={t("subscriptionLoginAccount")}>
								<Select id="subscriptionLoginAccount" value={accountId} onValueChange={(selectValue) => setAccountId(selectValue)}>
									<SelectOption value="">{t("none")}</SelectOption>
									{data.assets.filter((candidate) => candidate.kind === "account" && !candidate.deleted).map((candidate) => <SelectOption key={candidate.id} value={candidate.id}>{candidate.name}</SelectOption>)}
								</Select>
							</Field>
							{original && (linkedProjects.length > 0 || linkedAccounts.length > 0) && <p className="notice">{t("subscriptionExistingLinks")}: {[...linkedProjects, ...linkedAccounts].map((candidate) => candidate.name).join(" · ")}. {t("subscriptionLinksAdditive")}</p>}
							<Field name="subscriptionPaymentMethod" label={t("subscriptionPaymentMethod")} value={draft.subscriptionPaymentMethod} onChange={(value) => set("subscriptionPaymentMethod", value)} error={errors.subscriptionPaymentMethod} />
							<small>{t("subscriptionPaymentHint")}</small>
							<Field
								name="amount"
								label={t("amount")}
								value={amount}
								type="number"
								onChange={setAmount}
								error={errors.amount}
							/>
							<Field name="currency" label={t("currency")}>
								<Select
									id="currency"
									value={draft.currency}
									onValueChange={(selectValue) =>
										set("currency", selectValue as Asset["currency"])
									}
								>
									{["CNY", "USD", "EUR", "GBP", "JPY"].map((v) => (
										<SelectOption key={v} value={v}>
											{v}
										</SelectOption>
									))}
								</Select>
							</Field>
							<Field name="cycle" label={t("cycle")}>
								<Select
									id="cycle"
									value={draft.cycle}
									onValueChange={(selectValue) =>
										set("cycle", selectValue as Asset["cycle"])
									}
								>
									{["month", "year", "week", "day"].map((v) => (
										<SelectOption key={v} value={v}>
											{t(v)}
										</SelectOption>
									))}
								</Select>
							</Field>
							<Field
								name="interval"
								label={t("interval")}
								value={draft.interval}
								type="number"
								onChange={(v) => set("interval", Number(v))}
								error={errors.interval}
							/>
							<Field
								name="dueDate"
								label={t("dueDate")}
								value={draft.dueDate}
								type="date"
								onChange={(v) => set("dueDate", v)}
								error={errors.dueDate}
							/>
							<Field
								name="trialEndsAt"
								label={t("trialEndsAt")}
								value={draft.trialEndsAt}
								type="date"
								onChange={(v) => set("trialEndsAt", v)}
								error={errors.trialEndsAt}
							/>
							<Field
								name="discountAmount"
								label={t("discountAmount")}
								value={discount}
								type="number"
								onChange={setDiscount}
								error={errors.discountAmount}
							/>
							<Field
								name="discountUntil"
								label={t("discountUntil")}
								value={draft.discountUntil}
								type="date"
								onChange={(v) => set("discountUntil", v)}
								error={errors.discountUntil}
							/>
							<Field name="status" label={t("status")}>
								<Select
									id="status"
									value={draft.status}
									onValueChange={(selectValue) =>
										set("status", selectValue as Asset["status"])
									}
								>
									{["active", "paused", "cancelled"].map((v) => (
										<SelectOption key={v} value={v}>
											{t(v)}
										</SelectOption>
									))}
								</Select>
							</Field>
						</>
					)}
					{kind === "item" && (
						<>
							<Field
								name="amount"
								label={t("itemPurchasePrice")}
								value={amount}
								type="number"
								onChange={setAmount}
								error={errors.amount}
							/>
							<Field name="currency" label={t("currency")}>
								<Select id="currency" value={draft.currency} onValueChange={(selectValue) => set("currency", selectValue as Asset["currency"])}>
									{["CNY", "USD", "EUR", "GBP", "JPY"].map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}
								</Select>
							</Field>
							<Field
								name="purchaseDate"
								label={t("purchaseDate")}
								value={draft.purchaseDate}
								type="date"
								onChange={(v) => set("purchaseDate", v)}
								error={errors.purchaseDate}
							/>
							<Field
								name="itemStartDate"
								label={t("itemStartDate")}
								value={draft.itemStartDate}
								type="date"
								onChange={(value) => set("itemStartDate", value)}
								error={errors.itemStartDate}
							/>
							<Field name="itemWarrantyStatus" label={t("itemWarrantyStatus")}>
								<Select id="itemWarrantyStatus" value={draft.itemWarrantyStatus ?? ""} onValueChange={(selectValue) => set("itemWarrantyStatus", selectValue ? selectValue as NonNullable<Asset["itemWarrantyStatus"]> : null)}>
									<SelectOption value="">{t("itemStatusUnrecorded")}</SelectOption>
									{["unverified", "inWarranty", "outOfWarranty", "notApplicable"].map((value) => <SelectOption key={value} value={value}>{t(`itemWarranty_${value}`)}</SelectOption>)}
								</Select>
							</Field>
							<Field
								name="warrantyDate"
								label={t("warrantyDate")}
								value={draft.warrantyDate}
								type="date"
								onChange={(v) => set("warrantyDate", v)}
								error={errors.warrantyDate}
							/>
							<Field
								name="location"
								label={t("location")}
								value={draft.location}
								onChange={(v) => set("location", v)}
								error={errors.location}
							/>
						</>
					)}
					{kind === "vault" && <>
						<Field name="location" label={t("vaultStorageLocation")} value={draft.location} onChange={(value) => set("location", value)} error={errors.location} />
						{!original && <>
							<Field name="vaultRelatedId" label={t("vaultUsedFor")}>
								<Select id="vaultRelatedId" value={vaultRelatedId} onValueChange={(selectValue) => setVaultRelatedId(selectValue)}>
									<SelectOption value="">{t("select")}</SelectOption>
									{data.assets.filter((candidate) => !candidate.deleted && candidate.kind !== "vault").map((candidate) => <SelectOption key={candidate.id} value={candidate.id}>{candidate.name}</SelectOption>)}
								</Select>
							</Field>
							{vaultRelatedId && <Field name="vaultVerifiedAt" label={t("vaultVerifyDate")} type="date" value={vaultVerifiedAt} onChange={setVaultVerifiedAt} />}
						</>}
					</>}
					{kind !== "project" && <Field
						name="tags"
						label={t("tags")}
						value={tagsInput}
						onChange={(value) => {
							setTagsInput(value);
							setErrors((previous) => ({ ...previous, tags: "" }));
						}}
						error={errors.tags}
					/>}
				</div>
				{kind === "project" && <details className="project-editor-group project-editor-media" open>
					<summary>{t("projectMaterialsImage")}</summary>
					<div className="project-editor-fields">
						<Field name="projectLogoFile" label={t("projectLogo")}>
							<input id="projectLogoFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => selectProjectFiles("logo", event.target.files)} />
							{(projectFiles.logo || draft.projectMedia.logoId) && <div className="project-editor-image-list"><ProjectFormImage id={draft.projectMedia.logoId} file={projectFiles.logo} /></div>}
						</Field>
						<Field name="projectHomeFile" label={t("projectHomeScreenshot")}>
							<input id="projectHomeFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => selectProjectFiles("home", event.target.files)} />
							{(projectFiles.home || draft.projectMedia.homeScreenshotId) && <div className="project-editor-image-list"><ProjectFormImage id={draft.projectMedia.homeScreenshotId} file={projectFiles.home} /></div>}
						</Field>
						<Field name="projectProductFiles" label={t("projectProductScreenshots")}>
							<input id="projectProductFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => selectProjectFiles("products", event.target.files)} />
							<small>{t("projectProductScreenshotsLimit")}. {t("projectMediaReplaceHint")}</small>
							<div className="project-editor-image-list">{projectFiles.products?.length
					? projectFiles.products.map((file) => <ProjectFormImage key={`${file.name}-${file.size}-${file.lastModified}`} file={file} />)
								: draft.projectMedia.productScreenshotIds.map((id) => <ProjectFormImage key={id} id={id} />)}</div>
						</Field>
						<Field name="projectPromoFile" label={t("projectPromoCover")}>
							<input id="projectPromoFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => selectProjectFiles("promo", event.target.files)} />
							{(projectFiles.promo || draft.projectMedia.promoCoverId) && <div className="project-editor-image-list"><ProjectFormImage id={draft.projectMedia.promoCoverId} file={projectFiles.promo} /></div>}
						</Field>
						{errors.projectMedia && <p className="field-error" role="alert">{errors.projectMedia}</p>}
					</div>
				</details>}
				{kind === "vault" && <p className="notice">{t("vaultHint")}</p>}
				{kind !== "project" && <div className="field">
					<label htmlFor="longDescription">{t("longDescription")}</label>
					<textarea
						id="longDescription"
						rows={3}
						value={draft.longDescription}
						onChange={(e) => set("longDescription", e.target.value)}
						aria-invalid={!!errors.longDescription}
						aria-describedby={errors.longDescription ? "longDescription-error" : undefined}
					/>
					{errors.longDescription && <small id="longDescription-error" className="field-error">{errors.longDescription}</small>}
				</div>}
				{kind !== "project" && <div className="field">
					<label htmlFor="notes">{t("notes")}</label>
					<textarea
						id="notes"
						rows={3}
						value={draft.notes}
						onChange={(e) => set("notes", e.target.value)}
						aria-invalid={!!errors.notes}
						aria-describedby={errors.notes ? "notes-error" : undefined}
					/>
					{errors.notes && <small id="notes-error" className="field-error">{errors.notes}</small>}
				</div>}
				{failure && (
					<p className="field-error" role="alert">
						{failure}
					</p>
				)}
				{pendingConnections && <div className="notice" role="status">
					<p>{t("subscriptionPendingConnections")}</p>
					<div className="actions">
						<Button type="button" disabled={busy} onClick={() => void resolveConnections(false)}>{t("subscriptionRetryConnections")}</Button>
						<Button type="button" disabled={busy} onClick={() => void resolveConnections(true)}>{t("subscriptionAbandonConnections")}</Button>
					</div>
				</div>}
				<div className="actions">
					<Button type="button" onClick={closeIfIdle} disabled={busy}>
						{t("cancel")}
					</Button>
					<Button type="submit" variant="primary" disabled={busy || pendingConnections || checkingConnections}>
						{busy ? t("loading") : t("save")}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

export function TaskEditor({
	assetId = "",
	mode = "simple",
	className,
	onClose,
}: {
	assetId?: string;
	mode?: "simple" | "maintenance";
	className?: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [dueDate, setDueDate] = useState("");
	const [nameError, setNameError] = useState("");
	const [dueDateError, setDueDateError] = useState("");
	const [failure, setFailure] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	function closeIfIdle() {
		if (!inFlight.current) onClose();
	}
	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (inFlight.current) return;
		setNameError("");
		setDueDateError("");
		setFailure("");
		if (!name.trim()) {
			setNameError(t("required"));
			return;
		}
		const candidate = {
			id: crypto.randomUUID(),
			name: name.trim(),
			assetId,
			dueDate,
			done: false,
			completedAt: "",
			createdAt: new Date().toISOString(),
			dedupeKey: "",
			deleted: false,
		};
		const parsed = taskSchema.safeParse(candidate);
		if (!parsed.success) {
			const invalidDate = parsed.error.issues.some((issue) => issue.path[0] === "dueDate");
			if (invalidDate) setDueDateError(t("invalid"));
			else setNameError(t("invalid"));
			return;
		}
		inFlight.current = true;
		setBusy(true);
		try {
			const normalizedName = name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en");
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedName));
			const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
			const dedupeKey = `manual:${assetId || "global"}:${hash}:${dueDate || "none"}`;
			await save("task", {
				...parsed.data,
				dedupeKey,
			});
			onClose();
		} catch (error) {
			setFailure(error instanceof Error && error.message === "task-duplicate" ? t("taskDuplicatePending") : t("error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	if (mode === "maintenance") return <MaintenancePlanEditor onClose={onClose} />;
	return (
		<Dialog title={t("newTask")} className={className} onClose={closeIfIdle}>
			<form onSubmit={(e) => void submit(e)}>
				<div className="form-grid">
					<Field
						name="taskName"
						label={t("name")}
						value={name}
						onChange={(value) => { setName(value); setNameError(""); setFailure(""); }}
						error={nameError}
					/>
					<Field
						name="taskDue"
						label={t("date")}
						type="date"
						value={dueDate}
						onChange={(value) => { setDueDate(value); setDueDateError(""); setFailure(""); }}
						error={dueDateError}
					/>
				</div>
				{failure && <p className="notice" role="alert">{failure}</p>}
				<div className="actions">
					<Button type="button" onClick={closeIfIdle} disabled={busy}>
						{t("cancel")}
					</Button>
					<Button variant="primary" type="submit" disabled={busy}>
						{t("save")}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

function MaintenancePlanEditor({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const { data } = useAppContext();
	const [name, setName] = useState("");
	const [assetId, setAssetId] = useState("");
	const [dueDate, setDueDate] = useState("");
	const [mode, setMode] = useState<RepeatRule["mode"]>("once");
	const [every, setEvery] = useState("1");
	const [unit, setUnit] = useState<"day" | "week" | "month" | "year">("month");
	const [leadDays, setLeadDays] = useState("7");
	const [amount, setAmount] = useState("");
	const [currency, setCurrency] = useState<(typeof currencies)[number]>("CNY");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const assets = data.assets.filter((asset) => !asset.deleted);
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (inFlight.current) return;
		setError("");
		if (!name.trim() || !assetId || !assets.some((asset) => asset.id === assetId)) { setError(t("maintenanceRequired")); return; }
		const minor = amount.trim() ? parseMinorUnits(amount, currency) : null;
		if (minor !== null && !Number.isSafeInteger(minor)) { setError(t("maintenanceAmountInvalid")); return; }
		if (!leadDays.trim()) { setError(t("maintenanceScheduleInvalid")); return; }
		const rule: RepeatRule = mode === "once" ? { mode } : { mode, unit, every: Number(every) };
		let candidate: Task;
		try {
			const schedule = createMaintenanceSchedule({ dueDate, rule, leadDays: Number(leadDays), plannedAmountMinor: minor, currency });
			candidate = taskSchema.parse({ id: crypto.randomUUID(), name: name.trim(), assetId, dueDate: schedule.dueDate, done: false, completedAt: "", createdAt: new Date().toISOString(), dedupeKey: "", maintenancePlan: { schedule, active: true, records: [] }, deleted: false });
		} catch { setError(t("maintenanceScheduleInvalid")); return; }
		inFlight.current = true; setBusy(true);
		try {
			const currentAsset = await (await localRepository()).get<Asset>("asset", assetId);
			if (!currentAsset || currentAsset.deleted) throw Error("asset-missing");
			const normalized = name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en");
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
			const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
			await save("task", { ...candidate, dedupeKey: `maintenance:${assetId}:${hash.slice(0, 48)}:${dueDate}` });
			onClose();
		} catch (cause) { setError(cause instanceof Error && cause.message === "task-duplicate" ? t("taskDuplicatePending") : cause instanceof Error && cause.message === "asset-missing" ? t("maintenanceAssetMissing") : t("error")); }
		finally { inFlight.current = false; setBusy(false); }
	}
	return <Dialog title={t("newMaintenancePlan")} onClose={() => { if (!inFlight.current) onClose(); }}>
		<form className="maintenance-editor" onSubmit={(event) => void submit(event)}>
			<div className="form-grid">
				<Field name="maintenanceName" label={t("maintenanceName")} value={name} onChange={(value) => setName(value)} />
				<div className="field"><label htmlFor="maintenanceAsset">{t("maintenanceAsset")}</label><Select id="maintenanceAsset" value={assetId} onValueChange={(selectValue) => setAssetId(selectValue)} required><SelectOption value="">{t("maintenanceSelectAsset")}</SelectOption>{assets.map((asset) => <SelectOption key={asset.id} value={asset.id}>{asset.name} · {t(asset.kind)}</SelectOption>)}</Select></div>
				<div className="field"><label htmlFor="maintenanceRule">{t("maintenanceRule")}</label><Select id="maintenanceRule" value={mode} onValueChange={(selectValue) => setMode(selectValue as RepeatRule["mode"])}><SelectOption value="once">{t("maintenanceOnce")}</SelectOption><SelectOption value="fixed">{t("maintenanceFixed")}</SelectOption><SelectOption value="afterCompletion">{t("maintenanceAfterCompletion")}</SelectOption></Select></div>
				<Field name="maintenanceDue" label={t("maintenanceDue")} type="date" value={dueDate} onChange={setDueDate} />
				{mode !== "once" && <><Field name="maintenanceEvery" label={t("maintenanceEvery")} type="number" value={every} onChange={setEvery} /><div className="field"><label htmlFor="maintenanceUnit">{t("maintenanceUnit")}</label><Select id="maintenanceUnit" value={unit} onValueChange={(selectValue) => setUnit(selectValue as typeof unit)}>{(["day", "week", "month", "year"] as const).map((value) => <SelectOption key={value} value={value}>{t(value)}</SelectOption>)}</Select></div></>}
				<Field name="maintenanceLead" label={t("maintenanceLead")} type="number" value={leadDays} onChange={setLeadDays} />
				<Field name="maintenanceAmount" label={t("maintenanceAmount")} value={amount} onChange={setAmount} />
				<div className="field"><label htmlFor="maintenanceCurrency">{t("currency")}</label><Select id="maintenanceCurrency" value={currency} onValueChange={(selectValue) => setCurrency(selectValue as typeof currency)}>{currencies.map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}</Select></div>
			</div>
			<p className="maintenance-estimate-note">{t("maintenanceEstimateOnly")}</p>
			{!assets.length && <p className="field-error">{t("maintenanceNoAssets")}</p>}
			{error && <p className="field-error" role="alert">{error}</p>}
			<div className="actions"><Button type="button" onClick={onClose} disabled={busy}>{t("cancel")}</Button><Button type="submit" variant="primary" disabled={busy || !assets.length}>{t("maintenanceCreate")}</Button></div>
		</form>
	</Dialog>;
}

type ImportCandidate = { asset: Asset; duplicate: boolean; invalid: boolean; selected: boolean };

function validateImportCandidates(candidates: ImportCandidate[], existing: Asset[]): ImportCandidate[] {
	const preceding: Asset[] = [];
	return candidates.map((candidate) => {
		const parsed = assetSchema.safeParse({ ...candidate.asset, name: candidate.asset.name.trim() });
		const invalid = !parsed.success;
		const duplicate = parsed.success && duplicates(parsed.data, [...existing, ...preceding]).length > 0;
		if (parsed.success) preceding.push(parsed.data);
		return {
			...candidate,
			invalid,
			duplicate,
			selected: candidate.selected || (!invalid && !duplicate && (candidate.invalid || candidate.duplicate)),
		};
	});
}
export function IntakeTools({ onCsvStaged }: { onCsvStaged: () => void }) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const [mode, setMode] = useState<"url" | "image" | "csv" | "pdf" | "manual">("url");
	const [manualKind, setManualKind] = useState<AssetKind>("project");
	const [manualName, setManualName] = useState("");
	const [photoAssetId, setPhotoAssetId] = useState("");
	const [photoFile, setPhotoFile] = useState<File | null>(null);
	const [photoName, setPhotoName] = useState("");
	const [photoPreview, setPhotoPreview] = useState("");
	const [photoBusy, setPhotoBusy] = useState(false);
	const photoInFlight = useRef(false);
	const photoFileInput = useRef<HTMLInputElement>(null);
	const restoreFileInput = useRef<HTMLInputElement>(null);
	const [password, setPassword] = useState("");
	const [restoreFile, setRestoreFile] = useState<File | null>(null);
	const [readyArchive, setReadyArchive] = useState<Uint8Array | null>(null);
	const [readyArchiveGeneration, setReadyArchiveGeneration] = useState<number | null>(null);
	const [readyArchiveOrigin, setReadyArchiveOrigin] = useState<"local" | "remote" | null>(null);
	const [archiveCount, setArchiveCount] = useState(0);
	const [archiveReviewCount, setArchiveReviewCount] = useState(0);
	const [archiveHasVault, setArchiveHasVault] = useState(false);
	const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
	const [candidateGeneration, setCandidateGeneration] = useState<number | null>(null);
	const [url, setUrl] = useState("");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [csvBusy, setCsvBusy] = useState(false);
	const [inspecting, setInspecting] = useState(false);
	const importing = useRef(false);
	const previewExisting = useRef<Asset[]>([]);
	const restoring = useRef(false);
	const importGeneration = useRef(0);
	const restoreGeneration = useRef(0);
	const [readyDownload, setReadyDownload] = useState<{
		url: string;
		name: string;
	} | null>(null);
	const activeAssets = data.assets.filter(asset => !asset.deleted && asset.kind !== "vault");
	const recentAssets = [...activeAssets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
	useEffect(() => {
		if (!photoFile) { setPhotoPreview(""); return; }
		const address = URL.createObjectURL(photoFile);
		setPhotoPreview(address);
		return () => URL.revokeObjectURL(address);
	}, [photoFile]);
	function changeMode(next: typeof mode) {
		if (importing.current) return;
		importGeneration.current++;
		setCandidates([]);
		setCandidateGeneration(null);
		setMessage("");
		setMode(next);
	}
	async function addPhoto() {
		const asset = activeAssets.find(item => item.id === photoAssetId);
		if (!asset || !photoFile || photoInFlight.current) return;
		photoInFlight.current = true;
		setPhotoBusy(true);
		let fileId = "";
		try {
			fileId = await putFile(photoFile);
			await saveAssetIfCurrent(asset, {
				...asset,
				attachments: [...asset.attachments, fileId],
				updatedAt: new Date().toISOString(),
			});
			setPhotoFile(null);
			if (photoFileInput.current) photoFileInput.current.value = "";
			notify(t("saved"));
		} catch (error) {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "uploadError"));
		} finally {
			setPhotoBusy(false);
			photoInFlight.current = false;
		}
	}
	async function createPhotoItem() {
		if (!photoFile || photoInFlight.current) return;
		const name = photoName.trim();
		if (!name) { notify(t("required")); return; }
		photoInFlight.current = true;
		setPhotoBusy(true);
		let fileId = "";
		try {
			const existing = (await allRecords())
				.filter((row) => row.type === "asset")
				.map((row) => JSON.parse(row.payload) as Asset);
			const candidate = { ...newAsset("item"), name };
			if (duplicates(candidate, existing).length) { notify(t("duplicate")); return; }
			fileId = await putFile(photoFile);
			await save("asset", assetSchema.parse({
				...candidate,
				attachments: [fileId],
				itemMedia: { coverId: fileId, detailIds: [], receiptIds: [] },
			}));
			setPhotoFile(null);
			setPhotoName("");
			if (photoFileInput.current) photoFileInput.current.value = "";
			notify(t("saved"));
		} catch {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t("uploadError"));
		} finally {
			photoInFlight.current = false;
			setPhotoBusy(false);
		}
	}
	useEffect(() => {
		let active = true;
		void localRepository().then((repository) => {
			if (active && repository.restoreRecoveryError)
				setMessage((current) => current || t("restoreRecoveryPending"));
		}).catch(() => undefined);
		return () => { active = false; };
	}, [t]);
	useEffect(() => {
		return () => {
			if (readyDownload) URL.revokeObjectURL(readyDownload.url);
		};
	}, [readyDownload]);
	function invalidateRestorePreview() {
		const generation = ++restoreGeneration.current;
		setInspecting(false);
		setReadyArchive(null);
		setReadyArchiveGeneration(null);
		setReadyArchiveOrigin(null);
		setArchiveCount(0);
		setArchiveReviewCount(0);
		setArchiveHasVault(false);
		setMessage("");
		return generation;
	}
	function acceptRemotePreview(archive: Uint8Array, count: number, generation: number, reviewCount = 0, hasVault = false) {
		if (generation !== restoreGeneration.current) return false;
		setReadyArchive(archive);
		setReadyArchiveGeneration(generation);
		setReadyArchiveOrigin("remote");
		setArchiveCount(count);
		setArchiveReviewCount(reviewCount);
		setArchiveHasVault(hasVault);
		return true;
	}
	async function download() {
		if (password.length < 12) {
			setMessage(t("backupPassword"));
			return;
		}
		setBusy(true);
		setReadyDownload(null);
		try {
			const plain = await exportArchive();
			const encrypted = await encryptBackup(plain, password);
			const blob = new Blob([encrypted as BlobPart], {
				type: "application/octet-stream",
			});
			const address = URL.createObjectURL(blob);
			setReadyDownload({
				url: address,
				name: `stackperch-${new Date().toISOString().slice(0, 10)}.ka1`,
			});
			setMessage(t("backupReady"));
		} catch {
			setMessage(t("error"));
		} finally {
			setBusy(false);
		}
	}
	async function inspect() {
		if (!restoreFile || !password) return;
		const generation = ++restoreGeneration.current;
		setInspecting(true);
		setReadyArchive(null);
		setReadyArchiveGeneration(null);
		setReadyArchiveOrigin(null);
		setArchiveCount(0);
		setArchiveReviewCount(0);
		try {
			if (restoreFile.size > BACKUP_CONTAINER_MAX_BYTES) {
				setMessage(t("backupTooLarge"));
				return;
			}
			const decrypted = await decryptBackup(
				new Uint8Array(await restoreFile.arrayBuffer()),
				password,
			);
			if (generation !== restoreGeneration.current) return;
			try {
				const result = await inspectArchive(decrypted);
				if (generation !== restoreGeneration.current) return;
				setReadyArchive(decrypted);
				setReadyArchiveGeneration(generation);
				setReadyArchiveOrigin("local");
				setArchiveCount(result.rows.length);
				setArchiveReviewCount(result.intakeReview.length);
				setArchiveHasVault(!!result.passwordVault);
				setMessage(t("preview"));
			} catch {
				if (generation === restoreGeneration.current) setMessage(t("archiveInvalid"));
			}
		} catch (error) {
			if (generation === restoreGeneration.current)
				setMessage(t(error instanceof Error && error.message === "backup-size" ? "backupTooLarge" : "decryptError"));
		} finally {
			if (generation === restoreGeneration.current) setInspecting(false);
		}
	}
	async function restore() {
		if (restoring.current || !readyArchive || readyArchiveGeneration !== restoreGeneration.current) return;
		restoring.current = true;
		setBusy(true);
		try {
			const count = await restoreArchive(readyArchive);
			onCsvStaged();
			setMessage(t(archiveReviewCount ? "restoreReadyReview" : "restoreReady", { count, reviewCount: archiveReviewCount }));
			setReadyArchive(null);
			setReadyArchiveGeneration(null);
			setReadyArchiveOrigin(null);
			setRestoreFile(null);
			if (restoreFileInput.current) restoreFileInput.current.value = "";
		} catch (error) {
			const key = error instanceof Error && error.message === "restore-vault-conflict"
				? "restoreVaultConflict"
				: error instanceof Error && error.message === "restore-conflict"
				? "restoreConflict"
				: error instanceof Error && error.message === "restore-source-identity"
					? "restoreSourceIdentity"
				: error instanceof Error && error.message === "restore-recovery-pending"
					? "restoreRecoveryPending"
					: "error";
			setMessage(t(key));
		} finally {
			restoring.current = false;
			setBusy(false);
		}
	}
	async function stageCSV(file: File) {
		setMessage("");
		setCsvBusy(true);
		try {
			const pdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
			const count = pdf ? await (await import("./intake-pdf")).stagePdfForReview(file) : await stageCsvForReview(file);
			onCsvStaged();
			setMessage(t("reviewCsvStaged", { count }));
		} catch (error) {
			const reason = error instanceof Error ? error.message : "";
			setMessage(t(reason.startsWith("pdf") ? ({ pdfLimit: "reviewPdfLimit", pdfNoText: "reviewPdfNoText", pdfTimeout: "reviewPdfTimeout" }[reason] ?? "reviewPdfUnavailable") : reason === "limit" ? "reviewCsvLimit" : reason === "invalid" ? "reviewCsvInvalid" : "error"));
		} finally {
			setCsvBusy(false);
		}
	}
	async function previewUrl() {
		const generation = ++importGeneration.current;
		setCandidates([]);
		setCandidateGeneration(null);
		try {
			const address = new URL(url);
			if (!["http:", "https:"].includes(address.protocol)) throw Error("url");
			const existing = (await allRecords())
				.filter((r) => r.type === "asset")
				.map((r) => JSON.parse(r.payload) as Asset);
			if (generation !== importGeneration.current) return;
			const asset = {
				...newAsset("project"),
				name: address.hostname,
				category: "website",
				url: address.toString(),
			};
			const duplicate = duplicates(asset, existing).length > 0;
			previewExisting.current = existing;
			setCandidates([{ asset, duplicate, invalid: false, selected: !duplicate }]);
			setCandidateGeneration(generation);
			setMessage(t("preview"));
		} catch {
			if (generation === importGeneration.current) setMessage(t("invalid"));
		}
	}
	async function previewManual() {
		const generation = ++importGeneration.current;
		setCandidates([]);
		setCandidateGeneration(null);
		const name = manualName.trim();
		if (!name) {
			setMessage(t("required"));
			return;
		}
		try {
			const existing = (await allRecords())
				.filter((row) => row.type === "asset")
				.map((row) => JSON.parse(row.payload) as Asset);
			if (generation !== importGeneration.current) return;
			const asset = { ...newAsset(manualKind), name };
			const duplicate = duplicates(asset, existing).length > 0;
			previewExisting.current = existing;
			setCandidates([{ asset, duplicate, invalid: false, selected: !duplicate }]);
			setCandidateGeneration(generation);
			setMessage(t("preview"));
		} catch {
			if (generation === importGeneration.current) setMessage(t("error"));
		}
	}
	async function importCandidates() {
		if (importing.current || candidateGeneration !== importGeneration.current) return;
		importing.current = true;
		setBusy(true);
		try {
			const requested = new Set(candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.asset.id));
			const existing = (await allRecords())
				.filter((row) => row.type === "asset")
				.map((row) => JSON.parse(row.payload) as Asset);
			if (candidateGeneration !== importGeneration.current) return;
			previewExisting.current = existing;
			const checked = validateImportCandidates(candidates, existing);
			setCandidates(checked);
			const blocked = checked.find((candidate) => requested.has(candidate.asset.id) && (candidate.invalid || candidate.duplicate));
			if (blocked) {
				setMessage(t(blocked.invalid ? "invalid" : "duplicate"));
				return;
			}
			const selected = checked.filter((candidate) => requested.has(candidate.asset.id));
			if (!selected.length) return;
			await saveBatch(selected.map((candidate) => ({
				type: "asset",
				value: { ...candidate.asset, name: candidate.asset.name.trim() },
			})));
			importGeneration.current++;
			setCandidates([]);
			setCandidateGeneration(null);
			setMessage(`${t("imported")} · ${selected.length}`);
		} catch {
			setMessage(t("error"));
		} finally {
			importing.current = false;
			setBusy(false);
		}
	}
	return (
		<div className="intake-tools">
			<div className="card-grid intake-primary-grid">
				<section className="card padded intake-quick-card">
					<div className="intake-card-title">
						<h2>{t("intakeQuickTitle")}</h2>
					</div>
					<fieldset className="tabs intake-mode-tabs">
						<legend>{t("intakeMode")}</legend>
						{([
							["url", "intakeModeUrl"],
							["image", "intakeModeImage"],
							["csv", "intakeModeCsv"],
							["pdf", "intakeModePdf"],
							["manual", "intakeModeManual"],
						] as const).map(([value, key]) => (
							<button key={value} type="button" aria-pressed={mode === value} disabled={busy || inspecting || csvBusy} onClick={() => changeMode(value)}>
								{t(key)}
							</button>
						))}
					</fieldset>
					{mode === "url" && (
						<>
							<div className="field">
								<label htmlFor="import-url">{t("url")}</label>
								<input
									id="import-url"
									type="url"
									value={url}
									disabled={busy || inspecting}
									onChange={(event) => {
										importGeneration.current++;
										setUrl(event.target.value);
										setCandidates([]);
										setCandidateGeneration(null);
									}}
									placeholder="https://your-project.com"
								/>
							</div>
							<Button variant="primary" onClick={() => void previewUrl()} disabled={busy || inspecting || !url}>
								<Link2 size={16} />{t("intakePreviewRecords")}
							</Button>
						</>
					)}
					{(mode === "csv" || mode === "pdf") && (
						<>
							<p>{t(mode === "pdf" ? "reviewPdfHint" : "csvHint")}</p>
							<div className="field">
								<label htmlFor="csv-file">{t(mode === "pdf" ? "intakeModePdf" : "csv")}</label>
								<input
									id="csv-file"
									type="file"
									accept=".csv,text/csv,.pdf,application/pdf"
									disabled={busy || inspecting || csvBusy}
									onChange={(event) => {
										const file = event.target.files?.[0];
										event.currentTarget.value = "";
										if (file) void stageCSV(file);
									}}
								/>
							</div>
						</>
					)}
					{mode === "manual" && (
						<>
							<div className="field">
								<label htmlFor="intake-manual-name">{t("name")}</label>
								<input id="intake-manual-name" value={manualName} maxLength={160} disabled={busy || inspecting} onChange={event => {
									importGeneration.current++;
									setManualName(event.target.value);
									setCandidates([]);
									setCandidateGeneration(null);
								}} />
							</div>
							<div className="field">
								<label htmlFor="intake-manual-kind">{t("intakeRecordType")}</label>
								<Select id="intake-manual-kind" value={manualKind} disabled={busy || inspecting} onValueChange={selectValue => {
									importGeneration.current++;
									setManualKind(selectValue as AssetKind);
									setCandidates([]);
									setCandidateGeneration(null);
								}}>
									{(["project", "account", "subscription", "item"] as const).map(kind => <SelectOption key={kind} value={kind}>{t(kind)}</SelectOption>)}
								</Select>
							</div>
							<Button variant="primary" onClick={() => void previewManual()} disabled={busy || inspecting || !manualName.trim()}>{t("intakePreviewRecords")}</Button>
						</>
					)}
					{mode === "image" && (
						<>
							<p>{t("intakeImageHint")}</p>
							<div className="field">
								<label htmlFor="intake-photo-asset">{t("selectAsset")}</label>
								<Select id="intake-photo-asset" value={photoAssetId} disabled={photoBusy} onValueChange={selectValue => setPhotoAssetId(selectValue)}>
									<SelectOption value="">{t("intakePhotoNewItem")}</SelectOption>
									{activeAssets.map(asset => <SelectOption key={asset.id} value={asset.id}>{asset.name}</SelectOption>)}
								</Select>
							</div>
							<div className="field">
								<label htmlFor="intake-photo-file">{t("attachments")}</label>
								<input
									ref={photoFileInput}
									id="intake-photo-file"
									type="file"
									accept="image/jpeg,image/png,image/webp,image/gif"
									disabled={photoBusy}
									onChange={event => {
										const file = event.target.files?.[0] ?? null;
										if (file && (file.size > 20 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))) {
											setPhotoFile(null);
											event.currentTarget.value = "";
											notify(t("uploadError"));
											return;
										}
										setPhotoFile(file);
										setPhotoName(file ? (file.name.replace(/\.[^.]+$/, "").slice(0, 160) || file.name.slice(0, 160)) : "");
									}}
								/>
							</div>
							{photoPreview && photoFile && <img className="image-preview" src={photoPreview} alt={photoFile.name} />}
							{photoFile && !photoAssetId && <div className="field"><label htmlFor="intake-photo-name">{t("name")}</label><input id="intake-photo-name" value={photoName} maxLength={160} disabled={photoBusy} onChange={event => setPhotoName(event.target.value)} /></div>}
							<Button variant="primary" disabled={photoBusy || !photoFile || (!photoAssetId && !photoName.trim())} onClick={() => void (photoAssetId ? addPhoto() : createPhotoItem())}>{t(photoAssetId ? "addPhoto" : "confirmImport")}</Button>
						</>
					)}
					{candidates.length > 0 && (mode === "url" || mode === "manual") && (
						<div className="import-preview" aria-live="polite">
							<h3>{t("preview")}</h3>
							{candidates.map((candidate, index) => (
								<div className="list-row" key={candidate.asset.id}>
									<input
										type="checkbox"
										checked={candidate.selected}
										aria-label={`${t("select")} ${candidate.asset.name || index + 1}`}
										disabled={busy || ((candidate.duplicate || candidate.invalid) && !candidate.selected)}
										onChange={event => setCandidates(current => current.map(item =>
											item.asset.id === candidate.asset.id ? { ...item, selected: event.target.checked } : item
										))}
									/>
									<div style={{ gridColumn: 2, minWidth: 0 }}>
										<input
											aria-label={`${t("name")} ${index + 1}`}
											value={candidate.asset.name}
											aria-invalid={candidate.invalid}
											disabled={busy}
											style={{ width: "100%" }}
											onChange={event => {
												const name = event.target.value;
												setCandidates(current => validateImportCandidates(current.map(item =>
													item.asset.id === candidate.asset.id ? { ...item, asset: { ...item.asset, name } } : item
												), previewExisting.current));
											}}
										/>
										{candidate.invalid && <small className="field-error">{t(candidate.asset.name.trim() ? "invalid" : "required")}</small>}
									</div>
									<span className={`chip ${candidate.duplicate || candidate.invalid ? "warn" : ""}`}>{t(candidate.invalid ? "invalid" : candidate.duplicate ? "duplicate" : "ready")}</span>
								</div>
							))}
							<Button variant="primary" onClick={() => void importCandidates()} disabled={
								busy || inspecting || candidateGeneration !== importGeneration.current ||
				!candidates.some(candidate => candidate.selected) ||
				candidates.some(candidate => candidate.selected && (candidate.duplicate || candidate.invalid))
							}>{t("confirmImport")}</Button>
						</div>
					)}
				</section>
				<section className="card padded intake-backup-card">
					<div className="intake-card-title">
						<h2>{t("intakeBackupTitle")}</h2>
						<p>{t("backupHint")}</p>
					</div>
					<div className="chips">
						<span className="chip">{t("intakeBackupRecords")}</span>
						<span className="chip">{t("relations")}</span>
						<span className="chip">{t("intakeBackupFiles")}</span>
						<span className="chip">{t("intakeBackupReview")}</span>
					</div>
					<div className="field">
						<label htmlFor="backup-password">{t("backupPassword")}</label>
						<input
							id="backup-password"
							type="password"
							aria-describedby="backup-password-hint"
							minLength={12}
							autoComplete="new-password"
							disabled={busy}
							value={password}
							onChange={event => {
								invalidateRestorePreview();
								setPassword(event.target.value);
								setReadyDownload(null);
							}}
						/>
						<small id="backup-password-hint">{t("backupWarning")}</small>
					</div>
					<div className="actions">
						<Button onClick={() => void download()} disabled={busy || inspecting || password.length < 12}>
							<Download size={16} />{t("backup")}
						</Button>
						{readyDownload && (
							<Button asChild variant="primary">
								<a href={readyDownload.url} download={readyDownload.name}><Download size={16} />{t("saveBackupFile")}</a>
							</Button>
						)}
					</div>
					<p className="intake-backup-status" role="status">{readyDownload ? t("backupReady") : t("intakeBackupIdle")}</p>
					<RestoreRecoveryPanel />
					<details className="intake-secondary">
						<summary>{t("restoreBackup")}</summary>
						<div className="field">
							<label htmlFor="restore-file">{t("restoreBackup")}</label>
							<input
								ref={restoreFileInput}
								id="restore-file"
								type="file"
								accept=".ka1"
								disabled={busy}
								onChange={event => {
									invalidateRestorePreview();
									setRestoreFile(event.target.files?.[0] || null);
									if (event.target.files?.length) event.currentTarget.closest("details")?.setAttribute("open", "");
								}}
							/>
						</div>
						<small>{t("restoreHint")}</small>
						{readyArchive && readyArchiveOrigin === "local" && <p role="status">{t("restorePreviewSummary", { count: archiveCount, reviewCount: archiveReviewCount })}</p>}
						{readyArchive && readyArchiveOrigin === "local" && archiveHasVault && <p>{t("restoreContainsVault")}</p>}
						<div className="actions">
							<Button onClick={() => void inspect()} disabled={busy || inspecting || !restoreFile || !password}>{t("preview")}</Button>
							{readyArchive && readyArchiveOrigin === "local" && (
								<Button variant="primary" onClick={() => void restore()} disabled={busy || inspecting || readyArchiveGeneration !== restoreGeneration.current}>
									{t("confirm")} · {archiveCount}
								</Button>
							)}
						</div>
					</details>
					<details className="intake-secondary">
						<summary>{t("intakeBackupLocation")}</summary>
						<RemoteBackupPanel
							password={password}
							busy={busy || inspecting}
							setBusy={setBusy}
							invalidatePreview={invalidateRestorePreview}
							acceptPreview={acceptRemotePreview}
							canConfirm={!!readyArchive && readyArchiveOrigin === "remote" && readyArchiveGeneration === restoreGeneration.current}
							restoreCount={archiveCount}
							restoreReviewCount={archiveReviewCount}
							restoreHasVault={archiveHasVault}
							confirmRestore={() => void restore()}
						/>
					</details>
				</section>
			</div>
			<section className="card intake-recent">
				<h2>{t("intakeRecent")}</h2>
				{recentAssets.length ? (
					<ul className="list">
						{recentAssets.map(asset => (
							<li className="list-row" key={asset.id}>
								<Link to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }}>{asset.name}</Link>
								<span>{t(asset.kind)}</span>
							</li>
						))}
					</ul>
				) : <p>{t("intakeRecentEmpty")}</p>}
			</section>
			{message && <div className="notice" role="status">{message}</div>}
		</div>
	);
}

export function AiDialog({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
	return <AiWorkspaceDialog assets={assets} onClose={onClose} />;
}
