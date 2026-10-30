import { useEffect, useRef, useState } from "react";
import "./workspaces.css";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, ExternalLink } from "lucide-react";
import {
	putFile,
	fileUrl,
	cleanupUnreferencedFile,
	save,
	saveAssetIfCurrent,
	saveRelationIfCurrent,
} from "../../../packages/local-db/src";
import type { Relation } from "../../../packages/domain/src";
import { CatalogRecordEditor } from "./catalog-record-editor";
import {
	applyCatalogEdit,
	catalogCategories,
	catalogCategoryLabel,
	catalogRecords,
	type CatalogRecord,
} from "./catalog-records";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { Select, SelectOption } from "./components/ui/select";
import { Input } from "./components/ui/input";
import { date, useAppContext } from "./view-shared";

function RecordImage({
	id,
	onRemove,
	disabled,
}: {
	id: string;
	onRemove: () => void;
	disabled: boolean;
}) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		let active = true;
		let current = "";
		void fileUrl(id).then((value) => {
			current = value;
			if (active) setUrl(value);
			else if (value) URL.revokeObjectURL(value);
		});
		return () => {
			active = false;
			if (current) URL.revokeObjectURL(current);
		};
	}, [id]);
	const { t } = useTranslation();
	return (
		<div className="catalog-image">
			{url && (
				<a href={url} target="_blank" rel="noopener noreferrer">
					<img src={url} alt={t("attachments")} />
				</a>
			)}
			<Button size="small" disabled={disabled} onClick={onRemove}>
				{t("removeImage")}
			</Button>
		</div>
	);
}

export function CatalogRecordCard({
	record,
	categoryName,
	onOpen,
}: {
	record: CatalogRecord;
	categoryName: string;
	onOpen?: () => void;
}) {
	const { t, i18n } = useTranslation();
	return (
		<Link
			className="card catalog-record-card"
			to="/records/$id"
			params={{ id: record.id }}
			onClick={onOpen}
		>
			<span className="muted">{categoryName || t("catalogUnclassified")}</span>
			<strong>{record.asset.name}</strong>
			{record.asset.url && (
				<span className="catalog-record-url">{record.asset.url}</span>
			)}
			<span>
				{t(record.asset.status)}
				{record.asset.dueDate
					? ` · ${date(record.asset.dueDate, i18n.language)}`
					: ""}
			</span>
			{!!record.asset.tags.length && (
				<span className="catalog-tags">{record.asset.tags.join(" · ")}</span>
			)}
		</Link>
	);
}

export function CatalogRecordPage({ recordId }: { recordId?: string } = {}) {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const id = useRouterState({
		select: (state) => (state.matches.at(-1)?.params as { id?: string })?.id,
	});
	const record = catalogRecords(data.assets, data.categories).find(
		(value) => value.id === (recordId ?? id),
	);
	const category =
		record &&
		catalogCategories(data.categories).find(
			(value) => value.id === record.categoryId,
		);
	const [edit, setEdit] = useState(false),
		[remove, setRemove] = useState<CatalogRecord | null>(null);
	const [unlink, setUnlink] = useState<Relation | null>(null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const running = useRef(false);
	const [target, setTarget] = useState(""),
		[label, setLabel] = useState("");
	const upload = useRef<HTMLInputElement>(null);
	useEffect(() => {
		setEdit(false);
		setRemove(null);
		setUnlink(null);
		setTarget("");
		setLabel("");
		setError("");
	}, [id, recordId]);
	async function run(action: () => Promise<void>) {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (reason) {
			setError(
				t(
					reason instanceof Error && reason.message === "asset-stale"
						? "assetStale"
						: reason instanceof Error && reason.message === "relation-duplicate"
							? "relationDuplicate"
							: "error",
				),
			);
		} finally {
			running.current = false;
			setBusy(false);
		}
	}
	if (data.loading) return <p role="status">{t("loading")}</p>;
	if (!record)
		return (
			<main className="page">
				<p>{t("noMatches")}</p>
				<Button asChild>
					<Link to="/assets">{t("back")}</Link>
				</Button>
			</main>
		);
	const current = record;
	let backCategoryId: string | undefined;
	try {
		const saved = JSON.parse(
			sessionStorage.getItem("keepany-catalog-record-return") ?? "null",
		);
		if (
			saved?.recordId === current.id &&
			typeof saved.categoryId === "string" &&
			catalogCategories(data.categories).some(
				(category) => category.id === saved.categoryId,
			)
		)
			backCategoryId = saved.categoryId;
	} catch {
		/* Invalid return hints fall back to All. */
	}
	const linked = data.relations.filter(
		(relation) =>
			!relation.deleted &&
			(relation.from === current.owner.id || relation.to === current.owner.id),
	);
	const related = linked
		.map((relation) => ({
			relation,
			asset: data.assets.find(
				(asset) =>
					!asset.deleted &&
					asset.id ===
						(relation.from === current.owner.id ? relation.to : relation.from),
			),
		}))
		.filter((value) => value.asset && value.asset.kind !== "vault");
	async function storeImages(ids: string[]) {
		await saveAssetIfCurrent(
			current.owner,
			applyCatalogEdit(
				current,
				{
					...current.asset,
					attachments: ids,
					updatedAt: new Date().toISOString(),
				},
				current.categoryId,
			),
		);
	}
	return (
		<main className="page catalog-record-detail">
			<div className="page-header">
				<div>
					<Link
						className="back-link"
						to={backCategoryId ? "/assets/category/$categoryId" : "/assets"}
						params={backCategoryId ? { categoryId: backCategoryId } : {}}
					>
						{t("back")}
					</Link>
					<div className="eyebrow">
						{category
							? catalogCategoryLabel(category, t)
							: t("catalogUnclassified")}
					</div>
					<h1>{current.asset.name}</h1>
				</div>
				<div className="actions">
					<Button
						variant="primary"
						disabled={busy}
						onClick={() => setEdit(true)}
					>
						{t("edit")}
					</Button>
					{!current.domain && (
						<Button
							variant="danger"
							disabled={busy}
							onClick={() => setRemove(structuredClone(current))}
						>
							{t("delete")}
						</Button>
					)}
				</div>
			</div>
			{error && !remove && !unlink && (
				<p role="alert" className="field-error">
					{error}
				</p>
			)}
			<section className="card catalog-record-info">
				<dl>
					<dt>{t("category")}</dt>
					<dd>
						{category
							? catalogCategoryLabel(category, t)
							: t("catalogUnclassified")}
					</dd>
					<dt>{t("url")}</dt>
					<dd>
						{/^https?:\/\//i.test(current.asset.url) ? (
							<a
								href={current.asset.url}
								target="_blank"
								rel="noopener noreferrer"
							>
								{current.asset.url}
								<ExternalLink size={14} />
							</a>
						) : (
							t("none")
						)}
					</dd>
					<dt>{t("tags")}</dt>
					<dd>{current.asset.tags.join(" · ") || t("none")}</dd>
					<dt>{t("status")}</dt>
					<dd>{t(current.asset.status)}</dd>
					<dt>{t("catalogDate")}</dt>
					<dd>{date(current.asset.dueDate, i18n.language)}</dd>
				</dl>
				<h2>{t("notes")}</h2>
				<p className="catalog-record-notes">
					{current.asset.notes || t("none")}
				</p>
			</section>
			<details className="card catalog-record-extra">
				<summary>{t("catalogSupplement")}</summary>
				<section>
					<header className="card-header">
						<h2>{t("attachments")}</h2>
						<Button
							size="small"
							disabled={busy || current.asset.attachments.length >= 20}
							onClick={() => upload.current?.click()}
						>
							<Plus size={16} />
							{t("addPhoto")}
						</Button>
					</header>
					<input
						ref={upload}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						className="sr-only"
						aria-label={t("addPhoto")}
						disabled={busy}
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (!file) return;
							void run(async () => {
								let fileId = "";
								try {
									fileId = await putFile(file);
									await storeImages([...current.asset.attachments, fileId]);
									notify(t("saved"));
								} catch (reason) {
									if (fileId) await cleanupUnreferencedFile(fileId);
									throw reason;
								}
							});
						}}
					/>
					<div className="catalog-images">
						{current.asset.attachments.map((image) => (
							<RecordImage
								key={image}
								id={image}
								disabled={busy}
								onRemove={() =>
									void run(async () => {
										await storeImages(
											current.asset.attachments.filter((id) => id !== image),
										);
										await cleanupUnreferencedFile(image);
									})
								}
							/>
						))}
					</div>
				</section>
				{current.domain ? (
					<section>
						<h2>{t("catalogRelated")}</h2>
						<Link
							to="/assets/$kind/$id"
							params={{ kind: "project", id: current.owner.id }}
							hash={`project-domain-${current.domain.id}`}
						>
							{t("catalogLegacy")} · {current.owner.name}
						</Link>
					</section>
				) : (
					<section>
						<h2>{t("catalogRelated")}</h2>
						{related.map(({ relation, asset }) => (
							<div className="catalog-related-row" key={relation.id}>
								<Link
									to="/assets/$kind/$id"
									params={{ kind: asset!.kind, id: asset!.id }}
								>
									{asset!.name}
								</Link>
								<span>{relation.label}</span>
								<Button
									size="small"
									disabled={busy}
									onClick={() => setUnlink(structuredClone(relation))}
								>
									{t("remove")}
								</Button>
							</div>
						))}
						<form
							className="catalog-relation-form"
							onSubmit={(event) => {
								event.preventDefault();
								void run(async () => {
									if (
										linked.some(
											(relation) =>
												relation.from === current.owner.id &&
												relation.to === target &&
												relation.label.trim().toLocaleLowerCase() ===
													label.trim().toLocaleLowerCase(),
										)
									)
										throw Error("relation-duplicate");
									await save("relation", {
										id: crypto.randomUUID(),
										from: current.owner.id,
										to: target,
										label: label.trim(),
										createdAt: new Date().toISOString(),
										verifiedAt: "",
										deleted: false,
									});
									setTarget("");
									setLabel("");
									notify(t("saved"));
								});
							}}
						>
							<label className="field" htmlFor="catalog-relation-target">
								{t("catalogRelated")}
								<Select
									id="catalog-relation-target"
									value={target}
									disabled={busy}
									onValueChange={setTarget}
								>
									<SelectOption value="">{t("none")}</SelectOption>
									{data.assets
										.filter(
											(asset) =>
												!asset.deleted &&
												asset.kind !== "vault" &&
												asset.id !== current.owner.id,
										)
										.map((asset) => (
											<SelectOption key={asset.id} value={asset.id}>
												{asset.name}
											</SelectOption>
										))}
								</Select>
							</label>
							<label className="field" htmlFor="catalog-relation-label">
								{t("relationLabel")}
								<Input
									id="catalog-relation-label"
									value={label}
									maxLength={100}
									disabled={busy}
									onChange={(event) => setLabel(event.target.value)}
								/>
							</label>
							<Button type="submit" disabled={busy || !target || !label.trim()}>
								{t("addRelation")}
							</Button>
						</form>
					</section>
				)}
			</details>
			{(current.domain ||
				current.owner.catalogCategoryId === undefined ||
				current.owner.projectDomains.length > 0 ||
				[
					current.owner.description,
					current.owner.contact,
					current.owner.longDescription,
					current.owner.projectLaunchMonth,
					current.owner.projectInspectionDate,
					current.owner.projectTitle,
					current.owner.projectPromoUrl,
					current.owner.projectMediumDescription,
					current.owner.projectFeatures,
					current.owner.projectPricing,
					current.owner.projectPricingType,
					current.owner.projectEmail,
				].some(Boolean)) && (
				<Button asChild>
					<Link
						to="/assets/$kind/$id"
						params={{ kind: "project", id: current.owner.id }}
						hash={
							current.domain
								? `project-domain-${current.domain.id}`
								: "project-details"
						}
					>
						{t("catalogLegacy")}
					</Link>
				</Button>
			)}
			{edit && (
				<CatalogRecordEditor
					key={current.id}
					record={current}
					onClose={() => setEdit(false)}
				/>
			)}
			{unlink && (
				<Dialog
					title={t("remove")}
					onClose={() => setUnlink(null)}
					closeDisabled={busy}
				>
					<p>{unlink.label}</p>
					{error && (
						<p role="alert" className="field-error">
							{error}
						</p>
					)}
					<div className="actions">
						<Button disabled={busy} onClick={() => setUnlink(null)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									await saveRelationIfCurrent(unlink, {
										...unlink,
										deleted: true,
									});
									setUnlink(null);
								})
							}
						>
							{t("remove")}
						</Button>
					</div>
				</Dialog>
			)}
			{remove && (
				<Dialog
					title={t("delete")}
					closeDisabled={busy}
					onClose={() => setRemove(null)}
				>
					<p>{remove.asset.name}</p>
					{error && (
						<p role="alert" className="field-error">
							{error}
						</p>
					)}
					<div className="actions">
						<Button disabled={busy} onClick={() => setRemove(null)}>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									await saveAssetIfCurrent(remove.owner, {
										...remove.owner,
										deleted: true,
										updatedAt: new Date().toISOString(),
									});
									setRemove(null);
									void navigate({ to: "/assets" });
								})
							}
						>
							{t("delete")}
						</Button>
					</div>
				</Dialog>
			)}
		</main>
	);
}
