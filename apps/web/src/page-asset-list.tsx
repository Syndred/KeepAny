import { Input } from "./components/ui/input";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ArrowRight, Code2, CreditCard, GripVertical, LockKeyhole, Mail, Package, Plus, Search, Shield, Smartphone, UserRound, X } from "lucide-react";
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
import { AssetViewToggle, useAssetView } from "./components/AssetViewToggle";
import { AssetMetrics } from "./components/AssetMetrics";
import { useWorkspaceSummary } from "./use-workspace-summary";
import type { AssetSummary } from "./workspace-summary";
import { workspaceReturnKey } from "./workspace-return";
import { assetListFilterSnapshot, readAssetTagFilters, saveAssetTagFilters } from "./asset-list-filters";
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
	searchControl,
}: {
	kind: AssetKind;
	chosen: string;
	choose: (x: string, id?: string) => void;
	searchControl?: ReactNode;
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
			<div className={`asset-category-toolbar${searchControl ? " asset-category-toolbar--search" : ""}`}>
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
			{searchControl}
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
						<Input
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

function rememberAssetList(asset: Asset, search: string) {
	sessionStorage.removeItem(workspaceReturnKey);
	sessionStorage.setItem(`keepany-scroll-${asset.kind}`, String(window.scrollY));
	sessionStorage.setItem(`keepany-scroll-filter-${asset.kind}`, JSON.stringify(assetListFilterSnapshot(asset.kind, search)));
}

export function ProjectCard({ asset, search, backlinks, summary, onOpen }: { asset: Asset; search: string; backlinks: { total: number; pending: number }; summary?: AssetSummary; onOpen?: () => void }) {
	const { t } = useTranslation();
	const repository = asset.category === "repository";
	const domain = assetDomain(asset.url);
	return <Link className={`asset-project-card list-row ${repository ? "is-repository" : ""}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => { rememberAssetList(asset, search); onOpen?.(); }}>
		<div className="asset-project-info"><div className="asset-card-summary"><div className="asset-project-heading"><span className={`asset-project-avatar${asset.projectMedia?.homeScreenshotId ? " has-image" : ""}`}>{asset.projectMedia?.homeScreenshotId ? <AssetCover asset={asset} imageId={asset.projectMedia.homeScreenshotId} /> : repository ? <Code2 size={18} /> : Array.from(asset.name)[0]?.toLocaleUpperCase() || "•"}</span><strong title={asset.name}>{asset.name}</strong></div>
			{asset.description && <p>{asset.description}</p>}</div>
			<div className="asset-card-facts"><AssetMetrics asset={asset} summary={summary} /><div className="asset-project-links"><span title={domain}>{domain || niceCategory(asset.category, t)}</span><span className="asset-project-backlinks">{t("projectCardBacklinks", { count: backlinks.total, pending: backlinks.pending })}</span></div></div>
			<div className="asset-project-foot">{asset.status && <span className="chip">{t(asset.status)}</span>}<ArrowRight size={14} aria-hidden="true" /></div>
		</div>
	</Link>;
}

function AccountCard({ asset, search, connectionCount, passwordCount }: { asset: Asset; search: string; connectionCount: number; passwordCount?: number }) {
	const { t } = useTranslation();
	const categoryLabel = niceCategory(asset.category || "other", t).trim();
	const subtitle = [asset.username, asset.contact, asset.description].map((value) => value.trim()).find((value) => value && value !== asset.name.trim());
	const Icon = asset.category === "email" ? Mail : asset.category === "phone" ? Smartphone : UserRound;
	return <Link className={`asset-account-card list-row asset-account-${asset.category}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<span className="asset-account-avatar"><Icon size={20} /></span><span className="asset-account-summary"><strong>{asset.name}</strong>{subtitle && <small>{subtitle}</small>}<span className="asset-account-tags"><span className="chip">{categoryLabel}</span><span className="chip">{t("accountConnectionCount", { count: connectionCount })}</span>{passwordCount !== undefined && <span className="chip">{t("workspacePasswordCount", { count: passwordCount })}</span>}</span></span>
	</Link>;
}

export function LibraryCard({ asset, search, summary, onOpen }: { asset: Asset; search: string; summary?: AssetSummary; onOpen?: () => void }) {
	const { t, i18n } = useTranslation();
	const Icon = asset.kind === "subscription" ? CreditCard : asset.kind === "vault" ? Shield : Package;
	const coverId = asset.kind === "item" ? asset.itemMedia?.coverId : asset.attachments[0];
	return <Link className="asset-library-card list-row" to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => { rememberAssetList(asset, search); onOpen?.(); }}>
		<div className="asset-library-body"><div className="asset-card-summary"><div className="asset-library-heading"><span className={`asset-kind-icon${coverId ? " has-image" : ""}`}>{coverId ? <AssetCover asset={asset} imageId={coverId} /> : <Icon size={19} strokeWidth={1.8} />}</span><strong title={asset.name}>{asset.name}</strong></div>{asset.description && <small>{asset.description}</small>}</div><div className="asset-card-facts"><div className="asset-library-meta">
			{asset.kind === "subscription" ? <><span>{money(asset.amount, asset.currency, i18n.language)}</span><span>{asset.interval} {t(asset.cycle)}</span>{asset.dueDate && <span>{t("dueDate")}: {date(asset.dueDate, i18n.language)}</span>}</> : asset.kind === "vault" ? <>{asset.category && <span>{niceCategory(asset.category, t)}</span>}{asset.url && <span>{asset.url}</span>}</> : <>{asset.category && <span>{niceCategory(asset.category, t)}</span>}{asset.location && <span>{asset.location}</span>}{asset.warrantyDate && <span>{t("warrantyDate")}: {date(asset.warrantyDate, i18n.language)}</span>}</>}
		</div><AssetMetrics asset={asset} summary={summary} /></div><div className="asset-library-foot"><span className="chip">{asset.kind === "item" ? asset.itemLifecycleStatus ? t(`itemStatus_${asset.itemLifecycleStatus}`) : t("itemStatusUnrecorded") : t(asset.status)}</span>{asset.kind === "item" && asset.status !== "active" && <span className="chip">{t(asset.status)}</span>}<ArrowRight size={14} aria-hidden="true" /></div></div>
	</Link>;
}

export function AssetList() {
	const { kind: rawKind } = (useRouterState({
		select: (s) => s.matches.at(-1)?.params,
	}) ?? {}) as { kind?: string };
	const kind = validKind(rawKind ?? "project");
	return <AssetKindList kind={kind} />;
}

export type AccountListFilters = { search: string; category: string; tag: string };
export function AssetKindList({ kind, beforeList, afterList, passwordCounts, onAccountFiltersChange, privateSearch = false }: {
	kind: AssetKind; beforeList?: ReactNode; afterList?: ReactNode;
	passwordCounts?: ReadonlyMap<string, number>;
	onAccountFiltersChange?: (filters: AccountListFilters) => void;
	privateSearch?: boolean;
}) {
	const { data, search, notify } = useAppContext();
	const workspace = useWorkspaceSummary();
 const [assetView, setAssetView] = useAssetView();
	const [accountSearch, setAccountSearch] = useState(() => sessionStorage.getItem("keepany-account-list-search") || "");
	const [ordinarySearches, setOrdinarySearches] = useState<Record<string, string>>(() =>
		Object.fromEntries(["project", "item", "subscription"].map(key => [key, sessionStorage.getItem(`keepany-${key}-list-search`) || ""])),
	);
	const accountSearchRef = useRef<HTMLInputElement>(null);
	const wasPrivateSearch = useRef(privateSearch);
	useEffect(() => {
		if (wasPrivateSearch.current && !privateSearch) setAccountSearch(sessionStorage.getItem("keepany-account-list-search") ?? "");
		wasPrivateSearch.current = privateSearch;
	}, [privateSearch]);
	const localQuery = kind === "account" ? accountSearch : ordinarySearches[kind] ?? "";
	const listSearch = privateSearch ? "" : localQuery ? JSON.stringify([search, localQuery]) : search;
	function changeAccountSearch(value: string) {
		setAccountSearch(value);
		if (!privateSearch) sessionStorage.setItem("keepany-account-list-search", value);
	}
	function changeListSearch(value: string) {
		if (kind === "account") changeAccountSearch(value);
		else {
			setOrdinarySearches(previous => ({ ...previous, [kind]: value }));
			if (!privateSearch) sessionStorage.setItem(`keepany-${kind}-list-search`, value);
		}
	}
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
	const [tags, setTags] = useState<Record<string, string[]>>(() =>
		Object.fromEntries(kinds.map((key) => [key, readAssetTagFilters(key)])),
	);
	const selectedTags = tags[kind] ?? [];
	const tag = selectedTags[0] ?? "";
	const tagSignature = JSON.stringify(selectedTags);
	useEffect(() => { onAccountFiltersChange?.({ search: accountSearch, category, tag }); }, [onAccountFiltersChange, accountSearch, category, tag]);
	const changeTags = (values: string[]) => {
		saveAssetTagFilters(kind, values);
		setTags((prev) => ({ ...prev, [kind]: readAssetTagFilters(kind) }));
	};
	const chooseTag = (value: string) => changeTags(value ? [value] : []);
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
	const normalizedSearch = `${search} ${localQuery}`.trim().toLocaleLowerCase();
	const assets = allKindAssets.filter(
		(a) =>
			(!category || a.category === category || kind === "account" && category === "other" && !a.category || !!pendingCategory && [pendingCategory.beforeName, pendingCategory.afterName].includes(a.category)) &&
			selectedTags.every(value => a.tags.includes(value)) &&
			matchesAssetSearch(a, search) && matchesAssetSearch(a, localQuery),
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
					tags?: string[];
					search?: string;
				};
				if (saved.category !== category || JSON.stringify(saved.tags ?? (saved.tag ? [saved.tag] : [])) !== tagSignature || saved.search !== listSearch) {
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
	}, [kind, category, tagSignature, listSearch, data.loading, assets.length]);
	return (
		<main className={kind === "vault" ? "page vault-page" : "page"}>
			{kind !== "vault" && <PageTitle
				title={t(kind === "account" ? "accountsWorkspace" : kind)}
				subtitle={t(kind === "project" ? "projectListSubtitle" : kind === "account" ? "workspaceAccountSubtitle" : kind === "item" ? "itemListSubtitle" : "summary")}
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
					<PasswordVaultPanel assets={data.assets} notify={notify} focusAssetId={focusAssetId} />
				</Suspense>
				{<><div className="card-header vault-references-header" id="vault-references"><h2>{t("vaultReferencesTitle")}</h2><Button size="icon" aria-label={t("vaultLinkEntry")} title={t("vaultLinkEntry")} disabled={data.pendingCategoryEdits.some((pending) => pending.kind === kind)} onClick={() => setEdit(true)}><Plus size={18} /></Button></div>
				<div className="notice vault-privacy-note" role="note"><LockKeyhole size={16} aria-hidden="true" /><span>{t("vaultHint")}</span></div></>}
			</>}
			{beforeList}
			{<>
			<CategoryStrip key={kind} kind={kind} chosen={category} choose={choose} searchControl={kind !== "vault" ? <div className="asset-account-search">
				<Search size={18} aria-hidden="true" />
				<Input ref={accountSearchRef} type="search" aria-label={t(kind === "account" ? "accountListSearch" : "assetListSearch")} placeholder={t(kind === "account" ? "accountListSearchHint" : "assetListSearchHint")} autoComplete="off" value={localQuery} onChange={(event) => changeListSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); changeListSearch(""); } }} />
				{localQuery && <Button variant="ghost" size="icon" aria-label={t(kind === "account" ? "accountListClearSearch" : "assetListClearSearch")} onClick={() => { changeListSearch(""); accountSearchRef.current?.focus(); }}><X size={18} /></Button>}
			</div> : undefined} />
			{(availableTags.length > 0 || tag) && (
				<div className="list-filters">
					<label htmlFor="asset-tag-filter">{t("filterTag")}</label>
					<Select id="asset-tag-filter" value={tag} onValueChange={(selectValue) => chooseTag(selectValue)}>
						<SelectOption value="">{t("allTags")}</SelectOption>
						{tag && !availableTags.includes(tag) && <SelectOption value={tag}>{tag}</SelectOption>}
						{availableTags.map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}
					</Select>
					{tag && availableTags.some(value => !selectedTags.includes(value)) && <>
						<label htmlFor="asset-tag-filter-add">{t("assetTagAddFilter")}</label>
						<Select id="asset-tag-filter-add" value="" onValueChange={value => { if (value) changeTags([...selectedTags, value]); }}>
							<SelectOption value="">{t("assetTagAddFilter")}</SelectOption>
							{availableTags.filter(value => !selectedTags.includes(value)).map(value => <SelectOption key={value} value={value}>{value}</SelectOption>)}
						</Select>
					</>}
					{selectedTags.map(value => <span className="chip" key={value} data-selected-asset-tag={value}>
						{value}<Button size="icon" variant="ghost" aria-label={t("assetTagRemoveFilter", { tag: value })} onClick={() => changeTags(selectedTags.filter(tag => tag !== value))}><X size={16} /></Button>
					</span>)}
				</div>
			)}
			{kind !== "account" && kind !== "vault" && <div className="asset-list-view-tools"><AssetViewToggle value={assetView} onChange={setAssetView} /></div>}
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
			</section>) : <section className={`asset-list-content ${assetView === "list" && kind !== "account" ? "asset-dense-list" : ""} ${kind === "project" ? "asset-project-grid" : kind === "account" ? "asset-account-grid" : "asset-library-grid"}`}>
				{assets.length ? (
						assets.map((a) => kind === "project" ? <ProjectCard asset={a} search={listSearch} summary={workspace.summaries.get(a.id)} backlinks={backlinksByAsset.get(a.id) ?? { total: 0, pending: 0 }} key={a.id} /> : kind === "account" ? <AccountCard asset={a} search={listSearch} passwordCount={passwordCounts?.get(a.id)} connectionCount={new Set(data.relations.filter((relation) => !relation.deleted && liveIds.has(relation.from) && liveIds.has(relation.to) && relation.from !== relation.to && (relation.from === a.id || relation.to === a.id)).map((relation) => relation.from === a.id ? relation.to : relation.from)).size} key={a.id} /> : <LibraryCard asset={a} search={listSearch} summary={workspace.summaries.get(a.id)} key={a.id} />)
				) : (
					afterList ? null : category || tag || normalizedSearch ? (
						<div className="empty"><strong>{t("noMatches")}</strong></div>
					) : (
						<Empty />
					)
				)}
			</section>}
			</>}
			{afterList}
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
