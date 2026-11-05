import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema, parseMinorUnits, inputFromMinorUnits } from "../../../packages/domain/src";
import { newWalletCard, walletTypes } from './wallet-cards';
import { localRepository } from "../../../packages/local-db/src";
import {
	applyCatalogEdit,
	catalogCategories,
	catalogCategoryLabel,
	newCatalogAsset,
	type CatalogRecord,
} from "./catalog-records";
import { Dialog } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { Select, SelectOption } from "./components/ui/select";
import { DatePicker } from "./components/ui/date-picker";
import { Textarea } from "./components/ui/textarea";
import { Field, useValidationFocus } from "./workflow-field";
import { useAppContext } from "./view-shared";

export function CatalogRecordEditor({
	record,
	categoryId = "",
	wallet = false,
	onClose,
}: {
	record?: CatalogRecord;
	categoryId?: string;
	wallet?: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const [original] = useState(() => record && structuredClone(record));
	const [draft, setDraft] = useState(
		() => original?.asset ?? (wallet ? newWalletCard() : newCatalogAsset(categoryId)),
	);
	const [chosen, setChosen] = useState(original?.categoryId ?? categoryId);
	const [tags, setTags] = useState(draft.tags.join(", "));
	const [balance, setBalance] = useState(() => draft.walletCard?.balanceMinor == null ? '' : inputFromMinorUnits(draft.walletCard.balanceMinor,'CNY'));
	const [uses, setUses] = useState(() => draft.walletCard?.remainingUses == null ? '' : String(draft.walletCard.remainingUses));
	const [error, setError] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const validation = useValidationFocus(errors);
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const categories = catalogCategories(data.categories);
	function change(key: "name" | "url" | "dueDate" | "description", value: string) {
		setDraft((current) => ({ ...current, [key]: value }));
		setErrors((current) => ({ ...current, [key]: "" }));
	}
	async function submit(event: FormEvent) {
		event.preventDefault();
		if (running.current) return;
		const name = draft.name.trim();
		// An unchanged legacy domain can exceed the ordinary asset's 160-character name limit.
		const legacyLongName =
			!!original?.domain && name === original.domain.name && name.length > 160;
		const balanceMinor = balance.trim() ? parseMinorUnits(balance,'CNY') : null;
		const remainingUses = uses.trim() ? (/^\d+$/.test(uses.trim()) ? Number(uses.trim()) : NaN) : null;
		if (draft.walletCard && ((balanceMinor !== null && !Number.isSafeInteger(balanceMinor)) || (remainingUses !== null && !Number.isSafeInteger(remainingUses)))) {
			validation.requestFocus();
			setErrors({ balance: balanceMinor !== null && !Number.isSafeInteger(balanceMinor) ? t('invalid') : '', uses: remainingUses !== null && !Number.isSafeInteger(remainingUses) ? t('invalid') : '' }); return;
		}
		const parsed = assetSchema.safeParse({
			...draft,
			...(draft.walletCard ? {walletCard:{...draft.walletCard,balanceMinor,remainingUses}} : {}),
			name: legacyLongName ? name.slice(0, 160) : name,
			tags: tags
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean),
			updatedAt: new Date().toISOString(),
		});
		if (!parsed.success) {
			validation.requestFocus();
			setErrors(
				Object.fromEntries(
					parsed.error.issues.map((issue) => [
						String(issue.path[0] === 'walletCard' ? issue.path[1] ?? 'walletCard' : issue.path[0]),
						t("invalid"),
					]),
				),
			);
			return;
		}
		running.current = true;
		setBusy(true);
		setError("");
		try {
			const next = original
				? applyCatalogEdit(original, { ...parsed.data, name }, chosen)
				: { ...parsed.data, catalogCategoryId: chosen };
			await (await localRepository()).saveCatalogAsset(
				original?.owner ?? null,
				next,
				chosen,
			);
			notify(t("saved"));
			onClose();
		} catch (reason) {
			setError(
				t(
					reason instanceof Error && reason.message === "category-stale"
						? "catalogUnknown"
						: reason instanceof Error && reason.message === "asset-stale"
							? "assetStale"
							: "error",
				),
			);
		} finally {
			running.current = false;
			setBusy(false);
		}
	}
	return (
		<Dialog
			title={t(original ? "edit" : wallet ? "walletNew" : "newRecord")}
			onClose={onClose}
			closeDisabled={busy}
		>
			<form ref={validation.formRef} className="asset-editor" onSubmit={(event) => void submit(event)}>
				<fieldset disabled={busy} className="catalog-fields">
					<div className="form-grid">
						<Field
							name="catalog-record-name"
							label={`${t("name")} *`}
							value={draft.name}
							onChange={(value) => change("name", value)}
							error={errors.name}
						/>
                        {!original?.domain && <Field name="catalog-record-description" label={t('description')} value={draft.description} onChange={value=>change('description',value)} error={errors.description}/>}
						{draft.walletCard && <>
							<Field name="wallet-type" label={t('walletType')}><Select id="wallet-type" value={draft.walletCard.type} onValueChange={value=>setDraft(current=>({...current,walletCard:{...current.walletCard!,type:value as typeof walletTypes[number]}}))}>{walletTypes.map(type=><SelectOption key={type} value={type}>{t(`walletType_${type}`)}</SelectOption>)}</Select></Field>
							<Field name="wallet-issuer" label={t('walletIssuer')} value={draft.walletCard.issuer} error={errors.issuer} onChange={issuer=>setDraft(current=>({...current,walletCard:{...current.walletCard!,issuer}}))}/>
							<Field name="wallet-last-four" label={t('walletLastFour')} value={draft.walletCard.lastFour} error={errors.lastFour} onChange={lastFour=>setDraft(current=>({...current,walletCard:{...current.walletCard!,lastFour}}))}/>
							<Field name="wallet-balance" label={t('walletBalance')} value={balance} error={errors.balance} onChange={value=>{setBalance(value);setErrors(current=>({...current,balance:''}));}}/>
							<Field name="wallet-uses" label={t('walletRemaining')} value={uses} error={errors.uses} onChange={value=>{setUses(value);setErrors(current=>({...current,uses:''}));}}/>
						</>}
						<Field name="catalog-record-category" label={t("category")}>
							<Select
								id="catalog-record-category"
								value={chosen}
								onValueChange={setChosen}
							>
								<SelectOption value="">{t("catalogUnclassified")}</SelectOption>
								{categories.map((category) => (
									<SelectOption key={category.id} value={category.id}>
										{catalogCategoryLabel(category, t)}
									</SelectOption>
								))}
							</Select>
						</Field>
						<Field
							name="catalog-record-url"
							label={t("url")}
							value={draft.url}
							type="url"
							onChange={(value) => change("url", value)}
							error={errors.url}
						/>
						<Field
							name="catalog-record-tags"
							label={t("tags")}
							value={tags}
							onChange={setTags}
							error={errors.tags}
						/>
						<Field name="catalog-record-status" label={t("status")}>
							<Select
								id="catalog-record-status"
								value={draft.status}
								onValueChange={(value) =>
									setDraft((current) => ({
										...current,
										status: value as typeof draft.status,
									}))
								}
							>
								{[
									"active",
									"paused",
									"archived",
									...(draft.status === "cancelled" || draft.status === "loaned"
										? [draft.status]
										: []),
								].map((value) => (
									<SelectOption key={value} value={value}>
										{t(value)}
									</SelectOption>
								))}
							</Select>
						</Field>
						<Field
							name="catalog-record-date"
							label={t(draft.walletCard ? "walletExpiry" : "catalogDate")}
							error={errors.dueDate}
						>
							<DatePicker
								id="catalog-record-date"
								aria-label={t(draft.walletCard ? "walletExpiry" : "catalogDate")}
								value={draft.dueDate}
								onValueChange={(value) => change("dueDate", value)}
							/>
						</Field>
					</div>
					<label className="field" htmlFor="catalog-record-notes">
						{t("notes")}
						<Textarea
							id="catalog-record-notes"
							rows={3}
							value={draft.notes}
							aria-invalid={!!errors.notes}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									notes: event.target.value,
								}))
							}
						/>
						{errors.notes && (
							<small className="field-error">{errors.notes}</small>
						)}
					</label>
				</fieldset>
				{error && (
					<p role="alert" className="field-error">
						{error}
					</p>
				)}
				<div className="actions">
					<Button disabled={busy} onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{t(busy ? "loading" : "save")}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}
