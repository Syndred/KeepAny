import { validateCaptureImage, projectImageTypes } from "./workflow-image";
import { Textarea } from "./components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, inputFromMinorUnits, newAsset, parseMinorUnits, type Asset, type AssetKind, type Category, type ProjectMedia } from "../../../packages/domain/src";
import { localRepository, fileUrl, putFile, cleanupUnreferencedFile, save, saveAssetIfCurrent, saveSubscription, getPendingSubscriptionSave, retrySubscriptionSave, abandonSubscriptionSave, saveBatch } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { builtins as categoryOptions, useAppContext } from "./view-shared";
import "./project-editor.css";
import { Select, SelectOption } from "./components/ui/select";
import { assetNotes, editAssetNotes } from "./asset-notes";
import { saveAccountWithIdentityLinks, AccountIdentitySavePending } from "./account-identity-save";
import { AccountLinkConflict } from "./vault-account-links";
import { Field } from "./workflow-field";
type FieldName = keyof Asset;

type ProjectFormFiles = { logo?: File; home?: File; products?: File[]; promo?: File };

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
				category: kind === "account" ? "other" : categoryOptions[kind][0],
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
			if (kind === "account") {
				saveAttempted = true;
				originalRef.current = await saveAccountWithIdentityLinks(original ?? null, assetToSave,
					(linkKind, identifierKind) => t(`pwConnectKind_${identifierKind ?? linkKind}`));
			} else if (kind === "subscription") {
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
			if (error instanceof AccountIdentitySavePending) {
				originalRef.current = error.savedAccount;
				setFailure(t("accountRelationsPending"));
				return;
			}
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
			setFailure(t(error instanceof AccountLinkConflict ? "accountIdentityAmbiguous" :
				reason === "account-link-identity-in-use" ? "pwConnectIdentityInUse" :
				reason === "account-link-batch-limit" ? "pwConnectBatchLimit" :
				reason === "account-link-stale" ? "assetStale" :
				reason === "asset-stale" ? "assetStale" :
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
			<form className={kind === "project" ? "project-editor" : "asset-editor"} onSubmit={(e) => void submit(e)}>
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
									<Field name="projectMediumDescription" label={t("projectMediumDescription")} error={errors.projectMediumDescription}><Textarea id="projectMediumDescription" rows={4} value={draft.projectMediumDescription} onChange={(event) => set("projectMediumDescription", event.target.value)} /></Field>
									<Field name="longDescription" label={t("projectFullDescription")} error={errors.longDescription}><Textarea id="longDescription" rows={4} value={draft.longDescription} onChange={(event) => set("longDescription", event.target.value)} /></Field>
									<Field name="projectFeatures" label={t("projectFeatures")} error={errors.projectFeatures}><Textarea id="projectFeatures" rows={4} value={draft.projectFeatures} onChange={(event) => set("projectFeatures", event.target.value)} /></Field>
									<Field name="projectPricing" label={t("projectPricing")} error={errors.projectPricing}><Textarea id="projectPricing" rows={4} value={draft.projectPricing} onChange={(event) => set("projectPricing", event.target.value)} /></Field>
									<Field name="projectPricingType" label={t("projectPricingType")} value={draft.projectPricingType} onChange={(v) => set("projectPricingType", v)} error={errors.projectPricingType} />
								</div>
							</details>
							<details className="project-editor-group">
								<summary>{t("projectContactDetails")}</summary>
								<div className="project-editor-fields">
									<Field name="projectEmail" label={t("projectBusinessEmail")} type="email" value={draft.projectEmail} onChange={(v) => set("projectEmail", v)} error={errors.projectEmail} />
									<Field name="notes" label={t("projectAdditionalNotes")} error={errors.notes}><Textarea id="notes" rows={4} value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
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
								<Textarea id="description" rows={3} value={draft.description} onChange={(event) => set("description", event.target.value)} />
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
					<label htmlFor="notes">{t("notes")}</label>
					<Textarea
						id="notes"
						rows={3}
						value={assetNotes(draft)}
						onChange={(e) => {
							setDraft((current) => editAssetNotes(current, e.target.value));
							setErrors((current) => ({ ...current, notes: "", longDescription: "" }));
						}}
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
