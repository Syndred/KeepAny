import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { assetSchema } from "../../../packages/domain/src";
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
import { Field } from "./workflow-field";
import { useAppContext } from "./view-shared";

export function CatalogRecordEditor({
	record,
	categoryId = "",
	onClose,
}: {
	record?: CatalogRecord;
	categoryId?: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const [original] = useState(() => record && structuredClone(record));
	const [draft, setDraft] = useState(
		() => original?.asset ?? newCatalogAsset(categoryId),
	);
	const [chosen, setChosen] = useState(original?.categoryId ?? categoryId);
	const [tags, setTags] = useState(draft.tags.join(", "));
	const [error, setError] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const categories = catalogCategories(data.categories);
	function change(key: "name" | "url" | "dueDate", value: string) {
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
		const parsed = assetSchema.safeParse({
			...draft,
			name: legacyLongName ? name.slice(0, 160) : name,
			tags: tags
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean),
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
			title={t(original ? "edit" : "newRecord")}
			onClose={onClose}
			closeDisabled={busy}
		>
			<form className="asset-editor" onSubmit={(event) => void submit(event)}>
				<fieldset disabled={busy} className="catalog-fields">
					<div className="form-grid">
						<Field
							name="catalog-record-name"
							label={`${t("name")} *`}
							value={draft.name}
							onChange={(value) => change("name", value)}
							error={errors.name}
						/>
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
							label={t("catalogDate")}
							error={errors.dueDate}
						>
							<DatePicker
								id="catalog-record-date"
								aria-label={t("catalogDate")}
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
