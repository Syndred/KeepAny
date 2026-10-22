import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	DndContext,
	PointerSensor,
	KeyboardSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	horizontalListSortingStrategy,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, Code2, CreditCard, GripVertical, LockKeyhole, Mail, Package, Plus, Shield, Smartphone, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeCategoryName, type Asset, type AssetKind, type Category } from "../../../packages/domain/src";
import { cancelCategoryEdit, createCategory, deleteCustomCategory, editCustomCategory, fileUrl, localRepository, retryCategoryEdit, save, saveAssetIfCurrent } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { matchesAssetSearch } from "./asset-search";
import "./asset-restoration.css";
import "./vault-restoration.css";
import {
	Empty,
	PageTitle,
	builtins,
	date,
	kinds,
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
const PasswordVaultPanel = lazy(() =>
	import("./components/PasswordVaultPanel").then((module) => ({ default: module.PasswordVaultPanel })),
);
function SortablePill({
	id,
	label,
	active,
	reorder = false,
	disabled = false,
	onClick,
}: {
	id: string;
	label: string;
	active: boolean;
	reorder?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id });
	return (
		<div
			ref={setNodeRef}
			className="sortable-pill"
			style={{ transform: CSS.Transform.toString(transform), transition }}
		>
			{reorder && <button
				type="button"
				className="drag-handle"
				{...attributes}
				{...listeners}
				aria-label={`${label} ${t("drag")}`}
			>
				<GripVertical size={14} />
			</button>}
			<button
				type="button"
				className={active ? "active" : ""}
				aria-pressed={active}
				disabled={disabled}
				onClick={onClick}
			>
				{label}
			</button>
		</div>
	);
}
function CategoryStrip({
	kind,
	chosen,
	choose,
}: {
	kind: AssetKind;
	chosen: string;
	choose: (x: string, id?: string) => void;
}) {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const categoryNames = [
		...builtins[kind],
		...data.categories
			.filter((c) => c.kind === kind && !c.deleted)
			.map((c) => c.name),
	].filter((v, i, a) => a.indexOf(v) === i);
	const preference = data.preferences.find(
		(p) => p.id === `categoryOrder-${kind}`,
	);
	const savedOrder = Array.isArray(preference?.value)
		? (preference.value as string[])
		: [];
	const ordered = [...categoryNames].sort((a, b) => {
		const ai = savedOrder.indexOf(a),
			bi = savedOrder.indexOf(b);
		return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
	});
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const [manage, setManage] = useState(false);
	const [name, setName] = useState("");
	const [categoryError, setCategoryError] = useState("");
	const addingCategory = useRef(false);
	const [categoryBusy, setCategoryBusy] = useState(false);
	const [memberCategory, setMemberCategory] = useState("");
	const [memberIds, setMemberIds] = useState<string[]>([]);
	const [editingCategory, setEditingCategory] = useState<Category | null>(null);
	const [expectedAssets, setExpectedAssets] = useState<Asset[]>([]);
	const [expectedCategories, setExpectedCategories] = useState<Category[]>([]);
	const pending = data.pendingCategoryEdits.find((edit) => edit.kind === kind);
	const blocked = categoryBusy || !!pending || data.categoryEditsLoading || data.categoryEditsError;
	const memberAssets = (manage ? expectedAssets : data.assets).filter((asset) => asset.kind === kind && !asset.deleted).sort((a, b) => a.name.localeCompare(b.name));
	const membersChanged = memberCategory !== "" && memberAssets.some((asset) => memberIds.includes(asset.id) !== (asset.category === memberCategory));
	function categoryFailure(error: unknown) {
		const reason = error instanceof Error ? error.message : "";
		if (["category-duplicate", "category-reserved"].includes(reason)) return t("categoryDuplicate");
		if (["category-stale", "category-members-stale", "asset-stale"].includes(reason)) return t("categoryEditStale");
		if (reason === "category-edit-pending") return t("categoryEditFailed");
		if (reason === "category-edit-conflict") return t("categoryEditConflict");
		if (["category-name", "category-edit-invalid"].includes(reason)) return t("categoryNameInvalid");
		return t("error");
	}
	function selectManagedCategory(category: string, expectedId?: string) {
		const selected = builtins[kind].includes(category) ? null : data.categories.find((item) => item.kind === kind && !item.deleted && item.name === category) ?? null;
		if ((expectedId && selected?.id !== expectedId) || (category && !builtins[kind].includes(category) && !selected)) {
			setCategoryError(t("categoryEditStale"));
			return;
		}
		const snapshot = structuredClone(data.assets.filter((asset) => asset.kind === kind));
		setEditingCategory(selected ? structuredClone(selected) : null);
		setExpectedAssets(snapshot);
		setExpectedCategories(structuredClone(data.categories.filter((item) => item.kind === kind && !item.deleted)));
		setName(selected?.name ?? "");
		setMemberCategory(category);
		setMemberIds(category ? snapshot.filter((asset) => !asset.deleted && asset.category === category).map((asset) => asset.id) : []);
		setCategoryError("");
		choose(category, selected?.id);
	}
	function openManager() {
		selectManagedCategory(chosen);
		setManage(true);
	}
	function openNewCategory() {
		selectManagedCategory("");
		setManage(true);
	}
	async function resolveEdit(cancel: boolean) {
		if (!pending || addingCategory.current) return;
		addingCategory.current = true;
		setCategoryBusy(true);
		setCategoryError("");
		try {
			await (cancel ? cancelCategoryEdit(kind, pending.operationId) : retryCategoryEdit(kind, pending.operationId));
			const current = await (await localRepository()).get<Category>("category", pending.categoryId);
			if (current && !current.deleted) choose(current.name, current.id);
			else choose("");
			setManage(false);
			notify(t(cancel ? "categoryEditCancelled" : "saved"));
		} catch (error) { setCategoryError(categoryFailure(error)); }
		finally { addingCategory.current = false; setCategoryBusy(false); }
	}
	async function saveMembers() {
		if (!memberCategory || blocked || !membersChanged) return;
		setCategoryBusy(true);
		setCategoryError("");
		try {
			for (const asset of memberAssets) {
				const selected = memberIds.includes(asset.id);
				if (selected === (asset.category === memberCategory)) continue;
				await saveAssetIfCurrent(asset, { ...asset, category: selected ? memberCategory : "", updatedAt: new Date().toISOString() });
			}
			setExpectedAssets(structuredClone((await (await localRepository()).list<Asset>("asset", true)).filter((asset) => asset.kind === kind)));
			notify(t("saved"));
		} catch (error) { setCategoryError(categoryFailure(error)); }
		finally { setCategoryBusy(false); }
	}
	async function removeCategory(category: (typeof data.categories)[number]) {
		if (blocked) return;
		setCategoryBusy(true);
		setCategoryError("");
		try {
			await deleteCustomCategory({ expectedCategory: category, expectedAssets });
			if (chosen === category.name) choose("");
			setManage(false);
			notify(t("saved"));
		} catch (error) {
			setCategoryError(categoryFailure(error));
		} finally { setCategoryBusy(false); }
	}
	async function onDragEnd(e: DragEndEvent) {
		if (blocked || !e.over || e.active.id === e.over.id) return;
		const from = ordered.indexOf(String(e.active.id)),
			to = ordered.indexOf(String(e.over.id));
		const next = [...ordered];
		next.splice(to, 0, next.splice(from, 1)[0]);
		try { await save("preference", { id: `categoryOrder-${kind}`, value: next }); }
		catch (error) { setCategoryError(categoryFailure(error)); }
	}
	async function addCategory() {
		if (addingCategory.current || pending) return;
		const trimmed = name.trim();
		if (!trimmed) return;
		const normalized = normalizeCategoryName(trimmed);
		const reservedNames = [...builtins[kind], "all", ...["zh-CN", "en"].flatMap((language) => [...builtins[kind], "all"].map((key) => i18n.getFixedT(language)(key)))];
		if (
			reservedNames.some((reserved) => normalizeCategoryName(reserved) === normalized) ||
			categoryNames.filter((category) => category !== editingCategory?.name).some((category) =>
				[category, niceCategory(category, t)].some(
					(label) => normalizeCategoryName(label) === normalized,
				),
			)
		) {
			setCategoryError(t("categoryDuplicate"));
			return;
		}
		addingCategory.current = true;
		setCategoryBusy(true);
		try {
			const created = editingCategory
				? await editCustomCategory({ expectedCategory: editingCategory, name: trimmed, expectedAssets, memberIds, reservedNames })
				: await createCategory(kind, trimmed, categoryNames.length);
			if (!editingCategory) {
				for (const asset of memberAssets.filter((item) => memberIds.includes(item.id))) {
					await saveAssetIfCurrent(asset, { ...asset, category: created.name, updatedAt: new Date().toISOString() });
				}
			}
			setCategoryError("");
			setManage(false);
			choose(created.name, created.id);
			notify(t("saved"));
		} catch (error) { setCategoryError(categoryFailure(error)); }
		finally {
			addingCategory.current = false;
			setCategoryBusy(false);
		}
	}
	return (
		<>
			<div className="asset-category-toolbar">
			<div className="asset-category-scroll tabs">
				<button
					type="button"
					className={chosen === "" ? "active" : ""}
					onClick={() => choose("")}
				>
					{t("all")}
				</button>
				{ordered.map((id) => (
					<button type="button" key={id} className={chosen === id ? "active" : ""} aria-pressed={chosen === id} onClick={() => choose(id)}>{niceCategory(id, t)}</button>
				))}
				<button type="button" className="asset-category-add" disabled={blocked} aria-label={t("newCategory")} title={t("newCategory")}
						onClick={openNewCategory}
				>
					<Plus size={14} />
				</button>
			</div>
			<Button variant="ghost" size="small" className="asset-category-manage" disabled={categoryBusy} onClick={openManager}>{t("manage")}</Button>
			</div>
			{data.categoryEditsError && <p className="field-error" role="alert">{t("error")}</p>}
			{pending && <section className="card asset-category-recovery" aria-label={t("categoryEditRecovery")}>
				<p role="status">{t(pending.phase === "rolling-back" ? "categoryEditCancelling" : "categoryEditPending")}</p>
				{categoryError && <p className="field-error" role="alert">{categoryError}</p>}
				<div className="actions"><Button variant="primary" disabled={categoryBusy} onClick={() => void resolveEdit(false)}>{t(pending.phase === "rolling-back" ? "categoryEditFinishCancel" : "categoryEditRetry")}</Button>{pending.phase !== "rolling-back" && <Button disabled={categoryBusy} onClick={() => void resolveEdit(true)}>{t("categoryEditCancel")}</Button>}</div>
			</section>}
			{manage && (
				<section className="card asset-category-inline" aria-label={t("category")}>
					<div className="card-header"><h3>{editingCategory ? t("categoryEdit") : memberCategory ? t("categoryMembers") : t("newCategory")}</h3></div>
					{(!memberCategory || editingCategory) && <div className="field">
						<label htmlFor="category-name">{t("categoryName")}</label>
						<input
							id="category-name"
							value={name}
							maxLength={60}
							disabled={blocked}
							aria-invalid={!!categoryError}
							aria-describedby={
								categoryError ? "category-name-error" : undefined
							}
							onChange={(e) => {
								setName(e.target.value);
								setCategoryError("");
							}}
						/>
						{categoryError && (
							<small
								id="category-name-error"
								className="field-error"
								role="alert"
							>
								{categoryError}
							</small>
						)}
					</div>}
					{memberCategory && !editingCategory && categoryError && <p className="field-error" role="alert">{categoryError}</p>}
					<div className="list">
						<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
							<SortableContext items={ordered} strategy={horizontalListSortingStrategy}>
								<fieldset className="asset-category-order" aria-label={t("category")}>
									{ordered.map((id) => <SortablePill key={id} id={id} label={niceCategory(id, t)} active={memberCategory === id} disabled={blocked} reorder={!blocked} onClick={() => { if (!blocked) selectManagedCategory(id); }} />)}
								</fieldset>
							</SortableContext>
						</DndContext>
						<div className="asset-category-members">
							<div className="card-header"><h3>{t("categoryMembers")}{memberCategory ? ` · ${niceCategory(memberCategory, t)}` : ""}</h3>{memberCategory && !editingCategory && <Button size="small" disabled={blocked || !membersChanged} onClick={() => void saveMembers()}>{t("saveMembers")}</Button>}</div>
							<p className="subtitle">{t("categoryMembersHint")}</p>
							<div className="asset-category-member-list">{memberAssets.length ? memberAssets.map((asset) => <label key={asset.id}><input type="checkbox" disabled={blocked} checked={memberIds.includes(asset.id)} onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><span><strong>{asset.name}</strong>{asset.category && asset.category !== memberCategory && <small>{niceCategory(asset.category, t)}</small>}</span></label>) : <p>{t("none")}</p>}</div>
							</div>
						{expectedCategories
							.map((c) => (
								<div className="list-row" key={c.id}>
									<strong>{c.name}</strong>
									<div className="actions"><Button size="small" disabled={blocked} onClick={() => selectManagedCategory(c.name, c.id)}>{t("edit")}</Button>
									<Button
										variant="danger"
										size="small"
										disabled={blocked}
										onClick={() => void removeCategory(c)}
									>
										{t("remove")}
									</Button></div>
								</div>
							))}
					</div>
					<div className="actions">
						{(!memberCategory || editingCategory) && <Button variant="primary" onClick={addCategory} disabled={!name.trim() || blocked}>
							{t("collectionSave")}
						</Button>}
						<Button onClick={openNewCategory} disabled={blocked}>{t("collectionAddAnother")}</Button>
						<Button onClick={() => { setCategoryError(""); setManage(false); }} disabled={categoryBusy}>{t("categoryCollapse")}</Button>
					</div>
					<p className="subtitle">{t("categoryHelp")}</p>
				</section>
			)}
		</>
	);
}

function AssetCover({ asset, imageId = asset.kind === "item" ? asset.itemMedia?.coverId : asset.attachments[0] }: { asset: Asset; imageId?: string }) {
	const [src, setSrc] = useState("");
	useEffect(() => {
		setSrc("");
		if (!imageId) return;
		let active = true;
		let objectUrl = "";
		void fileUrl(imageId).then((url) => {
			objectUrl = url;
			if (active) setSrc(url);
			else if (url) URL.revokeObjectURL(url);
		}).catch(() => { if (active) setSrc(""); });
		return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
	}, [imageId]);
	return src ? <img src={src} alt="" /> : null;
}

function assetDomain(url: string) {
	try { return new URL(url).hostname.replace(/^www\./, ""); }
	catch { return url; }
}

export function ProjectPreview({ asset }: { asset: Asset }) {
	const { t } = useTranslation();
	const repository = asset.category === "repository";
	const domain = assetDomain(asset.url);
	const screenshotId = asset.projectMedia?.homeScreenshotId ?? "";
	if (repository) return <div className="asset-repository-cover"><Code2 size={36} strokeWidth={1.8} /><strong title={asset.name}>{asset.name}</strong><small>{domain || t("projectRepoCover")}</small></div>;
	return <div className={`asset-editorial-preview asset-editorial-${asset.category}`}>
		<div className="asset-browser-bar"><span /><span /><span /><small>{domain || asset.name}</small></div>
		<div className={`asset-browser-body${screenshotId ? " has-image" : ""}`}><AssetCover asset={asset} imageId={screenshotId} />{!screenshotId && <div className="asset-editorial-copy"><span className="asset-editorial-kicker">{domain || niceCategory(asset.category, t)}</span><strong title={asset.name}>{asset.name}</strong>{asset.description && <p>{asset.description}</p>}</div>}</div>
	</div>;
}

function rememberAssetList(asset: Asset, search: string) {
	sessionStorage.setItem(`keepany-scroll-${asset.kind}`, String(window.scrollY));
	sessionStorage.setItem(`keepany-scroll-filter-${asset.kind}`, JSON.stringify({
		category: sessionStorage.getItem(`keepany-category-${asset.kind}`) || "",
		tag: sessionStorage.getItem(`keepany-tag-${asset.kind}`) || "",
		search,
	}));
}

function ProjectCard({ asset, search, backlinks }: { asset: Asset; search: string; backlinks: { total: number; pending: number } }) {
	const { t } = useTranslation();
	const repository = asset.category === "repository";
	const domain = assetDomain(asset.url);
	return <Link className={`asset-project-card list-row ${repository ? "is-repository" : ""}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<div className="asset-project-cover">
			<ProjectPreview asset={asset} />
		</div>
		<div className="asset-project-info"><div className="asset-project-heading"><span className="asset-project-avatar">{Array.from(asset.name)[0]?.toLocaleUpperCase() || "•"}</span><strong>{asset.name}</strong>{asset.status && <span className="chip">{t(asset.status)}</span>}</div>
			<p>{asset.description || niceCategory(asset.category, t)}</p>
			<div className="asset-project-foot"><span>{domain || niceCategory(asset.category, t)}</span><span className="asset-project-backlinks">{t("projectCardBacklinks", { count: backlinks.total, pending: backlinks.pending })}<ArrowRight size={14} aria-hidden="true" /></span></div>
		</div>
	</Link>;
}

function AccountCard({ asset, search, connectionCount }: { asset: Asset; search: string; connectionCount: number }) {
	const { t } = useTranslation();
	const categoryLabel = niceCategory(asset.category || "other", t).trim();
	const subtitle = [asset.username, asset.contact, asset.description].map((value) => value.trim()).find((value) => value && value !== asset.name.trim());
	const Icon = asset.category === "email" ? Mail : asset.category === "phone" ? Smartphone : UserRound;
	return <Link className={`asset-account-card list-row asset-account-${asset.category}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<span className="asset-account-avatar"><Icon size={20} /></span><span className="asset-account-summary"><strong>{asset.name}</strong>{subtitle && <small>{subtitle}</small>}<span className="asset-account-tags"><span className="chip">{categoryLabel}</span><span className="chip">{t("accountConnectionCount", { count: connectionCount })}</span></span></span>
	</Link>;
}

function LibraryCard({ asset, search }: { asset: Asset; search: string }) {
	const { t, i18n } = useTranslation();
	const Icon = asset.kind === "subscription" ? CreditCard : asset.kind === "vault" ? Shield : Package;
	const coverId = asset.kind === "item" ? asset.itemMedia?.coverId : asset.attachments[0];
	return <Link className="asset-library-card list-row" to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<div className="asset-library-cover"><AssetCover asset={asset} imageId={coverId} />{!coverId && <><Icon size={40} strokeWidth={1.7} /><span>{niceCategory(asset.category, t)}</span></>}</div>
		<div className="asset-library-body"><strong>{asset.name}</strong><small>{asset.description || asset.location || niceCategory(asset.category, t)}</small><div className="asset-library-meta">
			{asset.kind === "subscription" ? <><span>{money(asset.amount, asset.currency, i18n.language)}</span><span>{asset.interval} {t(asset.cycle)}</span>{asset.dueDate && <span>{t("dueDate")}: {date(asset.dueDate, i18n.language)}</span>}</> : asset.kind === "vault" ? <><span>{niceCategory(asset.category, t)}</span>{asset.url && <span>{asset.url}</span>}</> : <><span>{niceCategory(asset.category, t)}</span>{asset.location && <span>{asset.location}</span>}{asset.warrantyDate && <span>{t("warrantyDate")}: {date(asset.warrantyDate, i18n.language)}</span>}</>}
		</div><div className="asset-library-foot"><span className="chip">{asset.kind === "item" ? asset.itemLifecycleStatus ? t(`itemStatus_${asset.itemLifecycleStatus}`) : t("itemStatusUnrecorded") : t(asset.status)}</span>{asset.kind === "item" && asset.status !== "active" && <span className="chip">{t(asset.status)}</span>}<ArrowRight size={14} aria-hidden="true" /></div></div>
	</Link>;
}

export function AssetList() {
	const { kind: rawKind } = (useRouterState({
		select: (s) => s.matches.at(-1)?.params,
	}) ?? {}) as { kind?: string };
	const kind = validKind(rawKind ?? "project");
	const { data, search, notify } = useAppContext();
	const hash = useRouterState({ select: (state) => state.location.hash });
	const focusAssetId = hash.startsWith("asset-") ? hash.slice(6) : undefined;
	const { t, i18n } = useTranslation();
	const backlinksByAsset = useMemo(() => {
		const counts = new Map<string, { total: number; pending: number }>();
		for (const submission of data.submissions) {
			if (submission.deleted) continue;
			const count = counts.get(submission.assetId) ?? { total: 0, pending: 0 };
			count.total += 1;
			if (submission.status === "verify") count.pending += 1;
			counts.set(submission.assetId, count);
		}
		return counts;
	}, [data.submissions]);
	const [categories, setCategories] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			kinds.map((k) => [
				k,
				sessionStorage.getItem(`keepany-category-${k}`) || "",
			]),
		),
	);
	const [categoryIds, setCategoryIds] = useState<Record<string, string>>(() =>
		Object.fromEntries(kinds.map((key) => [key, sessionStorage.getItem(`keepany-category-id-${key}`) || ""])),
	);
	const selectedCategory = data.categories.find((item) => item.id === categoryIds[kind] && item.kind === kind && !item.deleted);
	const category = selectedCategory?.name ?? categories[kind] ?? "";
	const pendingCategory = data.pendingCategoryEdits.find((edit) => edit.kind === kind && (edit.categoryId === selectedCategory?.id || [edit.beforeName, edit.afterName].includes(category)));
	useEffect(() => {
		if (selectedCategory) sessionStorage.setItem(`keepany-category-${kind}`, selectedCategory.name);
	}, [kind, selectedCategory]);
	const [tags, setTags] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			kinds.map((k) => [k, sessionStorage.getItem(`keepany-tag-${k}`) || ""]),
		),
	);
	const tag = tags[kind] || "";
	const chooseTag = (value: string) => {
		sessionStorage.setItem(`keepany-tag-${kind}`, value);
		setTags((prev) => ({ ...prev, [kind]: value }));
	};
	const choose = (value: string, id?: string) => {
		const categoryId = id ?? data.categories.find((item) => item.kind === kind && !item.deleted && item.name === value)?.id ?? "";
		sessionStorage.setItem(`keepany-category-${kind}`, value);
		sessionStorage.setItem(`keepany-category-id-${kind}`, categoryId);
		setCategories((prev) => ({ ...prev, [kind]: value }));
		setCategoryIds((prev) => ({ ...prev, [kind]: categoryId }));
	};
	useEffect(() => {
		function selectCategory(event: Event) {
			const selection = (event as CustomEvent<{ kind: AssetKind; category: string; categoryId?: string }>).detail;
			if (!selection || !kinds.includes(selection.kind)) return;
			sessionStorage.setItem(`keepany-category-${selection.kind}`, selection.category);
			setCategories((prev) => ({ ...prev, [selection.kind]: selection.category }));
			setCategoryIds((prev) => ({ ...prev, [selection.kind]: selection.categoryId ?? "" }));
		}
		window.addEventListener("keepany-category-select", selectCategory);
		return () => window.removeEventListener("keepany-category-select", selectCategory);
	}, []);
	useEffect(() => {
		setCategories((prev) => ({ ...prev, [kind]: sessionStorage.getItem(`keepany-category-${kind}`) || "" }));
		setCategoryIds((prev) => ({ ...prev, [kind]: sessionStorage.getItem(`keepany-category-id-${kind}`) || "" }));
	}, [kind]);
	const [edit, setEdit] = useState(false);
	const allLiveAssets = liveAssets(data);
	const liveIds = new Set(allLiveAssets.map((asset) => asset.id));
	const assetById = new Map(allLiveAssets.map((asset) => [asset.id, asset]));
	const vaultRelations = data.relations.filter((relation) => !relation.deleted && liveIds.has(relation.from) && liveIds.has(relation.to));
	const allKindAssets = allLiveAssets.filter((asset) => asset.kind === kind);
	const availableTags = [...new Set(allKindAssets.flatMap((asset) => asset.tags))].sort(
		(a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
	);
	const normalizedSearch = search.trim().toLocaleLowerCase();
	const assets = allKindAssets.filter(
		(a) =>
			(!category || a.category === category || kind === "account" && category === "other" && !a.category || !!pendingCategory && [pendingCategory.beforeName, pendingCategory.afterName].includes(a.category)) &&
			(!tag || a.tags.includes(tag)) &&
			matchesAssetSearch(a, search),
	);
	const restored = useRef("");
	useEffect(() => {
		if (data.loading || restored.current === kind) return;
		const savedFilter = sessionStorage.getItem(`keepany-scroll-filter-${kind}`);
		if (savedFilter) {
			try {
				const saved = JSON.parse(savedFilter) as {
					category?: string;
					tag?: string;
					search?: string;
				};
				if (saved.category !== category || (saved.tag || "") !== tag || saved.search !== search) {
					// Navigation clears the shell's temporary query. Keep the position
					// pending until the matching filters return instead of consuming it.
					return;
				}
			} catch {
				// An old or malformed scroll hint must not block the list.
			}
		}
		if (!assets.length) return;
		const frame = requestAnimationFrame(() => {
			const y = Number(sessionStorage.getItem(`keepany-scroll-${kind}`) || 0);
			if (Number.isFinite(y) && y > 0) window.scrollTo(0, y);
			restored.current = kind;
		});
		return () => cancelAnimationFrame(frame);
	}, [kind, category, tag, search, data.loading, assets.length]);
	return (
		<main className={kind === "vault" ? "page vault-page" : "page"}>
			{kind !== "vault" && <PageTitle
				eyebrow={kind === "project" ? "PROJECT LIBRARY" : kind === "account" ? "MY ACCOUNTS" : t("brandName")}
				title={t(kind === "project" ? "projectListTitle" : kind === "account" ? "accountListTitle" : kind === "subscription" ? "subscriptionListTitle" : "itemListTitle")}
				subtitle={t(kind === "project" ? "projectListSubtitle" : kind === "account" ? "accountListSubtitle" : kind === "item" ? "itemListSubtitle" : "summary")}
				action={
					<>
						{kind === "subscription" && <Button asChild><Link to="/finance">{t("financeViewLedger")}</Link></Button>}
						<Button variant="primary" disabled={data.pendingCategoryEdits.some((pending) => pending.kind === kind)} onClick={() => setEdit(true)}>
							<Plus size={17} />
							{t("add")}
						</Button>
					</>
				}
			/>}
			{kind === "vault" && <>
				<Suspense fallback={<div className="notice" role="status">{t("pwVaultLoading")}</div>}>
					<PasswordVaultPanel assets={liveAssets(data)} notify={notify} focusAssetId={focusAssetId} />
				</Suspense>
				{<><div className="card-header vault-references-header"><h2>{t("vaultReferencesTitle")}</h2><Button size="icon" aria-label={t("vaultLinkEntry")} title={t("vaultLinkEntry")} disabled={data.pendingCategoryEdits.some((pending) => pending.kind === kind)} onClick={() => setEdit(true)}><Plus size={18} /></Button></div>
				<div className="notice vault-privacy-note" role="note"><LockKeyhole size={16} aria-hidden="true" /><span>{t("vaultHint")}</span></div></>}
			</>}
			{<>
			<CategoryStrip key={kind} kind={kind} chosen={category} choose={choose} />
			{(availableTags.length > 0 || tag) && (
				<div className="list-filters">
					<label htmlFor="asset-tag-filter">{t("filterTag")}</label>
					<Select id="asset-tag-filter" value={tag} onValueChange={(selectValue) => chooseTag(selectValue)}>
						<SelectOption value="">{t("allTags")}</SelectOption>
						{tag && !availableTags.includes(tag) && <SelectOption value={tag}>{tag}</SelectOption>}
						{availableTags.map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}
					</Select>
				</div>
			)}
			{kind === "vault" ? (
				<section className="card vault-table-wrap asset-list-content" aria-label={t("vaultReferencesTitle")} tabIndex={assets.length ? 0 : undefined}>
				{assets.length ? <table className="vault-reference-table">
					<thead><tr><th>{t("vaultEntryName")}</th><th>{t("vaultUsedFor")}</th><th>{t("vaultStorageLocation")}</th><th>{t("vaultVerifyDate")}</th><th>{t("status")}</th></tr></thead>
					<tbody>{assets.map((asset) => {
						const links = vaultRelations.filter((relation) => relation.from === asset.id || relation.to === asset.id);
						const related = links.map((relation) => assetById.get(relation.from === asset.id ? relation.to : relation.from)).filter((candidate): candidate is Asset => !!candidate && candidate.kind !== "vault");
						const verifiedAt = links.map((relation) => relation.verifiedAt).filter(Boolean).sort().at(-1);
						return <tr key={asset.id}>
							<td><Link to="/assets/$kind/$id" params={{ kind: "vault", id: asset.id }} onClick={() => rememberAssetList(asset, search)}><strong>{asset.name}</strong></Link>{asset.description && <small>{asset.description}</small>}</td>
							<td>{related.length ? related.map((candidate) => candidate.name).join(" · ") : "—"}</td>
							<td>{asset.location || asset.url || "—"}</td>
							<td>{verifiedAt ? date(verifiedAt, i18n.language) : "—"}</td>
							<td><span className={`chip ${related.length ? "" : "warn"}`}>{t(related.length ? "vaultLinked" : "vaultUnlinked")}</span></td>
						</tr>;
					})}</tbody>
				</table> : <div className="vault-reference-empty"><strong>{category || tag || normalizedSearch ? t("noMatches") : t("none")}</strong></div>}
			</section>) : <section className={`asset-list-content ${kind === "project" ? "asset-project-grid" : kind === "account" ? "asset-account-grid" : "asset-library-grid"}`}>
				{assets.length ? (
						assets.map((a) => kind === "project" ? <ProjectCard asset={a} search={search} backlinks={backlinksByAsset.get(a.id) ?? { total: 0, pending: 0 }} key={a.id} /> : kind === "account" ? <AccountCard asset={a} search={search} connectionCount={new Set(data.relations.filter((relation) => !relation.deleted && liveIds.has(relation.from) && liveIds.has(relation.to) && relation.from !== relation.to && (relation.from === a.id || relation.to === a.id)).map((relation) => relation.from === a.id ? relation.to : relation.from)).size} key={a.id} /> : <LibraryCard asset={a} search={search} key={a.id} />)
				) : (
					category || tag || normalizedSearch ? (
						<div className="empty"><strong>{t("noMatches")}</strong></div>
					) : (
						<Empty />
					)
				)}
			</section>}
			</>}
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
						categories={data.categories}
						onClose={() => setEdit(false)}
					/>
				</Suspense>
			)}
		</main>
	);
}
