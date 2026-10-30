import { Textarea } from "./components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, inputFromMinorUnits, newAsset, parseMinorUnits, type Asset, type AssetKind, type Category } from "../../../packages/domain/src";
import { localRepository, save, saveAssetIfCurrent, saveSubscription, getPendingSubscriptionSave, retrySubscriptionSave, abandonSubscriptionSave } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { builtins as categoryOptions, useAppContext } from "./view-shared";
import { Select, SelectOption } from "./components/ui/select";
import { assetNotes, editAssetNotes } from "./asset-notes";
import { saveAccountWithIdentityLinks, AccountIdentitySavePending } from "./account-identity-save";
import { AccountLinkConflict } from "./vault-account-links";
import { Field } from "./workflow-field";
type FieldName = keyof Asset;

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
	const { data } = useAppContext();
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
	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (inFlight.current || pendingConnections || checkingConnections) return;
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
		const candidate = parsed.data;
		try {
			const assetToSave = candidate;
			const selectedLinks = kind === "subscription" ? [
				{ id: projectId, kind: "project" as const, label: t("subscriptionProject") },
				{ id: accountId, kind: "account" as const, label: t("subscriptionLoginAccount") },
			].filter((link) => !!link.id) : [];
			if (kind === "account") {
				originalRef.current = await saveAccountWithIdentityLinks(original ?? null, assetToSave,
					(linkKind, identifierKind) => t(`pwConnectKind_${identifierKind ?? linkKind}`));
			} else if (kind === "subscription") {
				originalRef.current = await saveSubscription(original ?? null, assetToSave, selectedLinks);
			} else if (original) {
				await saveAssetIfCurrent(original, candidate);
				originalRef.current = candidate;
			}
			else await save("asset", candidate);
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
			<form className="asset-editor" onSubmit={(e) => void submit(e)}>
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
										.filter((c) => c.kind === kind && !c.deleted && !c.scope)
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
					<Field
						name="tags"
						label={t("tags")}
						value={tagsInput}
						onChange={(value) => {
							setTagsInput(value);
							setErrors((previous) => ({ ...previous, tags: "" }));
						}}
						error={errors.tags}
					/>
				</div>
				<div className="field">
					<label htmlFor="notes">{t("notes")}</label>
					<Textarea
						id="notes"
						rows={3}
						value={kind === "project" ? draft.notes : assetNotes(draft)}
						onChange={(e) => {
							const value = e.target.value;
							setDraft((current) => kind === "project" ? { ...current, notes: value } : editAssetNotes(current, value));
							setErrors((current) => ({ ...current, notes: "", longDescription: "" }));
						}}
						aria-invalid={!!errors.notes}
						aria-describedby={errors.notes ? "notes-error" : undefined}
					/>
					{errors.notes && <small id="notes-error" className="field-error">{errors.notes}</small>}
				</div>
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
