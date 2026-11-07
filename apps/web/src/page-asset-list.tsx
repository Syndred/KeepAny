import { AssetCardContent } from "./components/AssetSummaryCard";
import { AssetThumbnail as AssetCover } from "./components/AssetThumbnail";
import { Input } from "./components/ui/input";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	DndContext,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	horizontalListSortingStrategy,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, Code2, CreditCard, GripVertical, Mail, Package, Plus, Search, Smartphone, UserRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeCategoryName, type Asset, type AssetKind, type Category } from "../../../packages/domain/src";
import { cancelCategoryEdit, createCategory, deleteCustomCategory, editCustomCategory, localRepository, retryCategoryEdit, save, saveAssetIfCurrent } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { matchesAssetSearch } from "./asset-search";
import "./asset-restoration.css";
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
const AssetEditor = lazy(() =>
	import("./workflow-asset-editor").then((module) => ({ default: module.AssetEditor })),
);
function SortablePill({
	id,
	label,
	active,
	reorder = false,
	disabled = false,
	keyboardMode = false,
	keyboardActive = false,
	onSortKey,
	registerHandle,
	instructionsId,
	onClick,
}: {
	id: string;
	label: string;
	active: boolean;
	reorder?: boolean;
	disabled?: boolean;
	keyboardMode?: boolean;
	keyboardActive?: boolean;
	onSortKey?: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
	registerHandle?: (id: string, node: HTMLButtonElement | null) => void;
	instructionsId?: string;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
		useSortable({ id, disabled: keyboardMode });
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
				ref={(node) => { setActivatorNodeRef(node); registerHandle?.(id, node); }}
				aria-disabled={disabled}
				aria-pressed={keyboardActive || attributes["aria-pressed"]}
				aria-describedby={instructionsId ?? attributes["aria-describedby"]}
				onKeyDown={(event) => onSortKey?.(id, event)}
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
	toolbarActions,
	wrapToolbar,
}: {
	kind: AssetKind;
	chosen: string;
	choose: (x: string, id?: string) => void;
	searchControl?: ReactNode;
	toolbarActions?: ReactNode;
	wrapToolbar?: (toolbar: ReactNode) => ReactNode;
}) {
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const categoryFieldId = kind === "vault" ? "vault-category-name" : "category-name";
	const categoryNames = [
		...builtins[kind],
		...data.categories
			.filter((c) => c.kind === kind && !c.deleted && !c.scope)
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
	const [keyboardSort, setKeyboardSort] = useState<{ id: string; order: string[] } | null>(null);
	const [sortStatus, setSortStatus] = useState("");
	const sortInstructionsId = useId();
	const sortHandles = useRef(new Map<string, HTMLButtonElement>());
	const sortReturnId = useRef<string | null>(null);
	const displayedOrder = keyboardSort?.order ?? ordered;
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);
	const [manage, setManage] = useState<false | "manage" | "new">(false);
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
	useEffect(() => {
		if (!manage || categoryBusy) return;
		const id = keyboardSort?.id ?? sortReturnId.current;
		if (!id) return;
		const handle = sortHandles.current.get(id);
		handle?.focus({ preventScroll: true });
		if (keyboardSort) handle?.closest(".sortable-pill")?.scrollIntoView({ block: "nearest", inline: "nearest" });
		else sortReturnId.current = null;
	}, [keyboardSort, categoryBusy, manage]);
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
		setKeyboardSort(null);
		setSortStatus("");
		sortReturnId.current = null;
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
		setManage("manage");
	}
	function openNewCategory() {
		selectManagedCategory("");
		setManage("new");
	}
	function closeManager() {
		if (categoryBusy) return;
		setKeyboardSort(null);
		setSortStatus("");
		sortReturnId.current = null;
		setCategoryError("");
		setManage(false);
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
	async function persistOrder(next: string[]) {
		if (blocked) return;
		setCategoryBusy(true);
		setCategoryError("");
		try { await save("preference", { id: `categoryOrder-${kind}`, value: next }); setSortStatus(t("saved")); }
		catch (error) { setCategoryError(categoryFailure(error)); }
		finally { setKeyboardSort(null); setCategoryBusy(false); }
	}
	function sortKey(id: string, event: KeyboardEvent<HTMLButtonElement>) {
		if (blocked) return;
		if (event.key === "Tab" && keyboardSort) { setKeyboardSort(null); setSortStatus(t("categorySortCancelled")); return; }
		if (![" ", "Enter", "ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) return;
		if (!keyboardSort && event.key !== " " && event.key !== "Enter") return;
		event.preventDefault();
		event.stopPropagation();
		if (!keyboardSort) {
			setKeyboardSort({ id, order: [...ordered] });
			setSortStatus(t("categorySortPosition", { name: niceCategory(id, t), position: ordered.indexOf(id) + 1, total: ordered.length }));
		} else if (event.key === "Escape") {
			sortReturnId.current = keyboardSort.id;
			setKeyboardSort(null);
			setSortStatus(t("categorySortCancelled"));
		} else if (event.key === " " || event.key === "Enter") {
			sortReturnId.current = keyboardSort.id;
			const next = keyboardSort.order;
			void persistOrder(next);
		} else {
			const index = keyboardSort.order.indexOf(keyboardSort.id);
			const target = index + (event.key === "ArrowLeft" ? -1 : 1);
			if (index < 0 || target < 0 || target >= keyboardSort.order.length) return;
			setKeyboardSort({ ...keyboardSort, order: arrayMove(keyboardSort.order, index, target) });
			setSortStatus(t("categorySortPosition", { name: niceCategory(keyboardSort.id, t), position: target + 1, total: keyboardSort.order.length }));
		}
	}
	async function onDragEnd(e: DragEndEvent) {
		if (blocked || keyboardSort || !e.over || e.active.id === e.over.id) return;
		const from = ordered.indexOf(String(e.active.id)),
			to = ordered.indexOf(String(e.over.id));
		if (from < 0 || to < 0) return;
		const next = [...ordered];
		next.splice(to, 0, next.splice(from, 1)[0]);
		await persistOrder(next);
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
	const toolbar = (
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
			<Button size="small" className="asset-category-manage" disabled={categoryBusy} onClick={openManager}>{t("manage")}</Button>
			{toolbarActions}
		</div>
	);
	return (
		<>
			{wrapToolbar ? wrapToolbar(toolbar) : toolbar}
			{data.categoryEditsError && <p className="field-error" role="alert">{t("error")}</p>}
			{pending && <section className="card asset-category-recovery" aria-label={t("categoryEditRecovery")}>
				<p role="status">{t(pending.phase === "rolling-back" ? "categoryEditCancelling" : "categoryEditPending")}</p>
				{categoryError && <p className="field-error" role="alert">{categoryError}</p>}
				<div className="actions"><Button variant="primary" disabled={categoryBusy} onClick={() => void resolveEdit(false)}>{t(pending.phase === "rolling-back" ? "categoryEditFinishCancel" : "categoryEditRetry")}</Button>{pending.phase !== "rolling-back" && <Button disabled={categoryBusy} onClick={() => void resolveEdit(true)}>{t("categoryEditCancel")}</Button>}</div>
			</section>}
			{manage && (
				<Dialog title={editingCategory ? t("categoryEdit") : manage === "new" ? t("newCategory") : t("categoryManage")} closeDisabled={categoryBusy} onClose={closeManager} onKeyDown={(event) => {
					// Pointer drag cancellation must reach dnd-kit before the popup closes.
					if (event.key === "Escape" && event.target instanceof Element && event.target.closest('.asset-category-order .drag-handle[aria-pressed="true"]')) event.preventBaseUIHandler();
				}}>
				<div className="asset-category-inline">
					{(!memberCategory || editingCategory) && <div className="field">
						<label htmlFor={categoryFieldId}>{t("categoryName")}</label>
						<Input
							id={categoryFieldId}
							value={name}
							maxLength={60}
							disabled={blocked}
							aria-invalid={!!categoryError}
							aria-describedby={
								categoryError ? `${categoryFieldId}-error` : undefined
							}
							onChange={(e) => {
								setName(e.target.value);
								setCategoryError("");
							}}
						/>
						{categoryError && (
							<small
								id={`${categoryFieldId}-error`}
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
							<SortableContext items={displayedOrder} strategy={horizontalListSortingStrategy}>
								<fieldset className="asset-category-order" aria-label={t("category")}>
									{displayedOrder.map((id) => <SortablePill key={id} id={id} label={niceCategory(id, t)} active={memberCategory === id} disabled={blocked} reorder={!blocked} keyboardMode={!!keyboardSort} keyboardActive={keyboardSort?.id === id} instructionsId={sortInstructionsId} registerHandle={(key, node) => { if (node) sortHandles.current.set(key, node); else sortHandles.current.delete(key); }} onSortKey={sortKey} onClick={() => { if (!blocked) selectManagedCategory(id); }} />)}
								</fieldset>
							</SortableContext>
						</DndContext>
						<p id={sortInstructionsId} className="sr-only">{t("categorySortKeysHint")}</p>
						<p className="sr-only category-sort-status" role="status" aria-live="polite">{sortStatus}</p>
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
						<Button onClick={closeManager} disabled={categoryBusy}>{t("cancel")}</Button>
					</div>
					<p className="subtitle">{t("categoryHelp")}</p>
				</div>
				</Dialog>
			)}
		</>
	);
}


function assetDomain(url: string) {
	try { return new URL(url).hostname.replace(/^www\./, ""); }
	catch { return url; }
}

function rememberAssetList(asset: Asset, search: string) {
	sessionStorage.removeItem(workspaceReturnKey);
	sessionStorage.setItem(`keepany-scroll-${asset.kind}`, String(window.scrollY));
	sessionStorage.setItem(`keepany-scroll-filter-${asset.kind}`, JSON.stringify({
		category: sessionStorage.getItem(`keepany-category-${asset.kind}`) || "",
		...(asset.kind !== "account" && { tag: sessionStorage.getItem(`keepany-tag-${asset.kind}`) || "" }),
		search,
	}));
}

export function ProjectCard({ asset, search, summary, onOpen }: { asset: Asset; search: string; summary?: AssetSummary; onOpen?: () => void }) {
	const { t } = useTranslation();
	const repository = asset.category === "repository";
	const domain = assetDomain(asset.url);
	return <Link className={`asset-project-card list-row ${repository ? "is-repository" : ""}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => { rememberAssetList(asset, search); onOpen?.(); }}>
		<div className="asset-project-info"><div className="asset-card-summary"><div className="asset-project-heading"><span className="asset-project-avatar">{repository ? <Code2 size={18} /> : Array.from(asset.name)[0]?.toLocaleUpperCase() || "•"}</span><strong title={asset.name}>{asset.name}</strong></div>
			{asset.description && <p>{asset.description}</p>}</div>
			<div className="asset-card-facts"><AssetMetrics asset={asset} summary={summary} /><div className="asset-project-links"><span title={domain}>{domain || niceCategory(asset.category, t)}</span></div></div>
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
    return <Link className="asset-summary-card" to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => { rememberAssetList(asset, search); onOpen?.(); }}><AssetCardContent asset={asset}/></Link>;
}

export function AssetList() {
	const { kind: rawKind } = (useRouterState({
		select: (s) => s.matches.at(-1)?.params,
	}) ?? {}) as { kind?: string };
	const kind = validKind(rawKind ?? "project");
	return <AssetKindList key={kind} kind={kind === "vault" ? "account" : kind} />;
}

export function AssetKindList({ kind, beforeList, afterList, passwordCounts, privateSearch = false, embedded = false, hideTitle = false, accountSearchExtras, renderAccountDetails, renderAccountCard, accountExtras = [], filterAccountId, toolbarActions, accountCardGroupIds, accountToolbarExtras }: {
	toolbarActions?: ReactNode;
	accountToolbarExtras?: (visibleAccounts: readonly Asset[]) => ReactNode;
	accountExtras?: Asset[]; filterAccountId?: string; accountCardGroupIds?: ReadonlyMap<string, string>;
	kind: AssetKind; beforeList?: ReactNode; afterList?: ReactNode;
	passwordCounts?: ReadonlyMap<string, number>;
	privateSearch?: boolean;
	embedded?: boolean;
	hideTitle?: boolean;
	accountSearchExtras?: ReadonlyMap<string, string>;
	renderAccountDetails?: (asset: Asset) => ReactNode;
	renderAccountCard?: (asset: Asset, context: { connectionCount: number; queries: string[]; onOpen: () => void }) => ReactNode;
}) {
	const Container = embedded ? "section" : "main";
	const { data, search, accountToolbarTarget } = useAppContext();
	const workspace = useWorkspaceSummary();
 const [assetView, setAssetView] = useAssetView();
	const [accountSearch, setAccountSearch] = useState(() => sessionStorage.getItem("keepany-account-list-search") || "");
	const accountSearchRef = useRef<HTMLInputElement>(null);
	const wasPrivateSearch = useRef(privateSearch);
	useEffect(() => {
		if (wasPrivateSearch.current && !privateSearch) setAccountSearch(sessionStorage.getItem("keepany-account-list-search") ?? "");
		wasPrivateSearch.current = privateSearch;
	}, [privateSearch]);
	const accountQuery = kind === "account" ? accountSearch : "";
	const listSearch = privateSearch ? "" : accountQuery ? JSON.stringify([search, accountQuery]) : search;
	function changeAccountSearch(value: string) {
		setAccountSearch(value);
		if (!privateSearch) sessionStorage.setItem("keepany-account-list-search", value);
	}
	const { t, i18n } = useTranslation();

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
			kinds.filter((k) => k !== "account").map((k) => [k, sessionStorage.getItem(`keepany-tag-${k}`) || ""]),
		),
	);
	const tag = kind === "account" ? "" : tags[kind] || "";
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
 const navigateForCreation = useNavigate();
 const creationConsumed = useRef(false);
 const creationRoute = useRouterState({ select: state => ({
  pathname: state.location.pathname, hash: state.location.hash, status: state.status,
  kind: (state.matches.at(-1)?.params as { kind?: string } | undefined)?.kind,
 }) });
 useEffect(() => {
  if (creationRoute.hash !== "new") { creationConsumed.current = false; return; }
  // A pending destination can arrive before this outlet receives its new kind.
  if (embedded || data.loading || creationRoute.status !== "idle" || creationRoute.pathname !== `/assets/${kind}` || creationRoute.kind !== kind || creationConsumed.current) return;
  creationConsumed.current = true;
  setEdit(true);
  void navigateForCreation({ hash: "", replace: true });
 }, [creationRoute.pathname, creationRoute.hash, creationRoute.status, creationRoute.kind, embedded, data.loading, kind, navigateForCreation]);
	const allLiveAssets = [...liveAssets(data), ...accountExtras];
	const liveIds = new Set(allLiveAssets.map((asset) => asset.id));
	const allKindAssets = allLiveAssets.filter((asset) => asset.kind === kind);
	const availableTags = kind === "account" ? [] : [...new Set(allKindAssets.flatMap((asset) => asset.tags))].sort(
		(a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
	);
	const normalizedSearch = `${search} ${accountQuery}`.trim().toLocaleLowerCase();
	const matchingAssets = allKindAssets.filter(
		(a) =>
            (!filterAccountId || a.id === filterAccountId) &&
			(!category || a.category === category || kind === "account" && category === "other" && !a.category || !!pendingCategory && [pendingCategory.beforeName, pendingCategory.afterName].includes(a.category)) &&
			(!tag || a.tags.includes(tag)) &&
			[search, accountQuery].every((query) => matchesAssetSearch(a, query) || !!accountSearchExtras?.get(a.id)?.includes(query.trim().toLocaleLowerCase())),
	);
 const seenAccountGroups = new Set<string>();
 // Search results represent individual matching accounts, not platform summaries.
 const expandAccountSearch = kind === "account" && [search, accountQuery].some(query => query.trim());
 const assets = matchingAssets.filter(asset => {
  if (expandAccountSearch) return true;
  const group = kind === "account" ? accountCardGroupIds?.get(asset.id) : undefined;
  if (!group) return true;
  if (seenAccountGroups.has(group)) return false;
  seenAccountGroups.add(group); return true;
 });
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
				if (saved.category !== category || (saved.tag || "") !== tag || saved.search !== listSearch) {
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
	}, [kind, category, tag, listSearch, data.loading, assets.length]);
	const tagFilter = (availableTags.length > 0 || tag) ? <div className="list-filters">
		<Select id={`asset-tag-filter-${kind}`} aria-label={t("filterTag")} value={tag} onValueChange={chooseTag}>
			<SelectOption value="">{t("allTags")}</SelectOption>
			{tag && !availableTags.includes(tag) && <SelectOption value={tag}>{tag}</SelectOption>}
			{availableTags.map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}
		</Select>
	</div> : null;
	const connectionCount = (asset: Asset) => new Set(data.relations.filter((relation) => !relation.deleted && liveIds.has(relation.from) && liveIds.has(relation.to) && relation.from !== relation.to && (relation.from === asset.id || relation.to === asset.id)).map((relation) => relation.from === asset.id ? relation.to : relation.from)).size;
	return (
		<Container className={embedded ? "unified-account-list" : "page"}>
			{!hideTitle && <PageTitle
				title={t(kind === "account" ? "accountsWorkspace" : kind)}
				subtitle={t(kind === "project" ? "projectListSubtitle" : kind === "account" ? "workspaceAccountSubtitle" : kind === "item" ? "itemListSubtitle" : "summary")}
				action={
					<>

						<Button variant="primary" disabled={data.pendingCategoryEdits.some((pending) => pending.kind === kind)} onClick={() => setEdit(true)}>
							<Plus size={17} />
							{t("add")}
						</Button>
					</>
				}
			/>}
			{beforeList}
			{<>
			<CategoryStrip key={kind} kind={kind} chosen={category} choose={choose} searchControl={kind === "account" ? <div className="asset-account-search">
				<Search size={18} aria-hidden="true" />
				<Input
					id={renderAccountDetails || renderAccountCard ? "password-vault-search-input" : undefined}
					ref={accountSearchRef}
					type="search"
					aria-label={t("accountListSearch")}
					placeholder={t("accountListSearchHint")}
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="none"
					spellCheck={false}
					value={accountSearch}
					onChange={(event) => changeAccountSearch(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape" && accountSearch) {
							event.stopPropagation();
							changeAccountSearch("");
						}
					}}
				/>
				{accountSearch && <Button variant="ghost" size="icon" aria-label={t("accountListClearSearch")} onClick={() => { changeAccountSearch(""); accountSearchRef.current?.focus(); }}><X size={18} /></Button>}
			</div> : undefined} toolbarActions={toolbarActions} wrapToolbar={kind === "account" && renderAccountCard ? (toolbar) => {
				const content = <div className="account-list-toolbar">{toolbar}{accountToolbarExtras?.(assets)}</div>;
				return accountToolbarTarget ? createPortal(content, accountToolbarTarget) : content;
			} : undefined} />
			{kind !== "account" && kind !== "vault" ? <div className="asset-list-toolbar">
				{tagFilter}
				<AssetViewToggle value={assetView} onChange={setAssetView} />
			</div> : kind === "vault" && !renderAccountCard && tagFilter}
<section className={`asset-list-content ${assetView === "list" && kind !== "account" ? "asset-dense-list" : ""} ${kind === "project" ? "asset-project-grid" : kind === "account" ? "asset-account-grid" : "asset-library-grid"}`}>
				{assets.length ? (
						assets.map((a) => kind === "project" ? <ProjectCard asset={a} search={listSearch} summary={workspace.summaries.get(a.id)} key={a.id} /> : kind === "account" ? renderAccountCard ? <div className="compact-account-slot" key={a.id}>{renderAccountCard(a, { connectionCount: connectionCount(a), queries: [search, accountQuery], onOpen: () => rememberAssetList(a, listSearch) })}</div> : <article className={renderAccountDetails ? "unified-account" : "account-list-entry"} key={a.id}><AccountCard asset={a} search={listSearch} passwordCount={passwordCounts?.get(a.id)} connectionCount={connectionCount(a)} />{renderAccountDetails?.(a)}</article> : <LibraryCard asset={a} search={listSearch} summary={workspace.summaries.get(a.id)} key={a.id} />)
				) : (
					afterList ? null : category || tag || normalizedSearch ? (
						<div className="empty"><strong>{t("noMatches")}</strong></div>
					) : (
						<Empty />
					)
				)}
			</section>
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
                        key={kind}
						kind={kind}
						categories={data.categories}
						onClose={() => setEdit(false)}
					/>
				</Suspense>
			)}
		</Container>
	);
}
