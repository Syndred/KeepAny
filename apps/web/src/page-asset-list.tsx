import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { ArrowRight, Code2, CreditCard, GripVertical, Mail, Package, Plus, Shield, Smartphone, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeCategoryName, type Asset, type AssetKind } from "../../../packages/domain/src";
import { createCategory, fileUrl, save, saveAssetIfCurrent } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
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
const AssetEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.AssetEditor })),
);
function SortablePill({
	id,
	label,
	active,
	reorder = false,
	onClick,
}: {
	id: string;
	label: string;
	active: boolean;
	reorder?: boolean;
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
	choose: (x: string) => void;
}) {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
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
	const memberAssets = liveAssets(data).filter((asset) => asset.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
	const membersChanged = memberCategory !== "" && memberAssets.some((asset) => memberIds.includes(asset.id) !== (asset.category === memberCategory));
	function selectManagedCategory(category: string) {
		setMemberCategory(category);
		setMemberIds(memberAssets.filter((asset) => asset.category === category).map((asset) => asset.id));
		choose(category);
	}
	function openManager() {
		setCategoryError("");
		const initial = chosen || ordered[0] || "";
		setMemberCategory(initial);
		setMemberIds(memberAssets.filter((asset) => asset.category === initial).map((asset) => asset.id));
		setManage(true);
	}
	async function saveMembers() {
		if (!memberCategory || categoryBusy || !membersChanged) return;
		setCategoryBusy(true);
		setCategoryError("");
		try {
			for (const asset of memberAssets) {
				const selected = memberIds.includes(asset.id);
				if (selected === (asset.category === memberCategory)) continue;
				await saveAssetIfCurrent(asset, { ...asset, category: selected ? memberCategory : "", updatedAt: new Date().toISOString() });
			}
			notify(t("saved"));
		} catch (error) {
			setCategoryError(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally { setCategoryBusy(false); }
	}
	async function removeCategory(category: (typeof data.categories)[number]) {
		if (categoryBusy) return;
		setCategoryBusy(true);
		setCategoryError("");
		try {
			for (const asset of memberAssets.filter((item) => item.category === category.name)) {
				await saveAssetIfCurrent(asset, { ...asset, category: "", updatedAt: new Date().toISOString() });
			}
			await save("category", { ...category, deleted: true });
			if (chosen === category.name) choose("");
			if (memberCategory === category.name) selectManagedCategory(ordered.find((item) => item !== category.name) || "");
			notify(t("saved"));
		} catch (error) {
			setCategoryError(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "error"));
		} finally { setCategoryBusy(false); }
	}
	async function onDragEnd(e: DragEndEvent) {
		if (!e.over || e.active.id === e.over.id) return;
		const from = ordered.indexOf(String(e.active.id)),
			to = ordered.indexOf(String(e.over.id));
		const next = [...ordered];
		next.splice(to, 0, next.splice(from, 1)[0]);
		await save("preference", { id: `categoryOrder-${kind}`, value: next });
	}
	async function addCategory() {
		if (addingCategory.current) return;
		const trimmed = name.trim();
		if (!trimmed) return;
		const normalized = normalizeCategoryName(trimmed);
		if (
			categoryNames.some((category) =>
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
			const created = await createCategory(kind, trimmed, categoryNames.length);
			setName("");
			setCategoryError("");
			setManage(false);
			choose(created.name);
			notify(t("saved"));
		} catch (error) {
			setCategoryError(
				error instanceof Error && error.message === "category-duplicate"
					? t("categoryDuplicate")
					: t("error"),
			);
		} finally {
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
				<button type="button" className="asset-category-add" aria-label={t("newCategory")} title={t("newCategory")}
						onClick={openManager}
				>
					<Plus size={14} />
				</button>
			</div>
			<Button variant="ghost" size="small" className="asset-category-manage" onClick={openManager}>{t("manage")}</Button>
			</div>
			{manage && (
				<Dialog
					title={t("category")}
					onClose={() => {
						if (categoryBusy) return;
						setCategoryError("");
						setManage(false);
					}}
				>
					<div className="field">
						<label htmlFor="category-name">{t("categoryName")}</label>
						<input
							id="category-name"
							value={name}
							maxLength={60}
							disabled={categoryBusy}
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
					</div>
					<div className="actions">
						<Button onClick={addCategory} disabled={!name.trim() || categoryBusy}>
							{t("save")}
						</Button>
					</div>
					<div className="list">
						<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
							<SortableContext items={ordered} strategy={horizontalListSortingStrategy}>
								<fieldset className="asset-category-order" aria-label={t("category")}>
									{ordered.map((id) => <SortablePill key={id} id={id} label={niceCategory(id, t)} active={memberCategory === id} reorder onClick={() => selectManagedCategory(id)} />)}
								</fieldset>
							</SortableContext>
						</DndContext>
						{memberCategory && <div className="asset-category-members">
							<div className="card-header"><h3>{t("categoryMembers")} · {niceCategory(memberCategory, t)}</h3><Button size="small" disabled={categoryBusy || !membersChanged} onClick={() => void saveMembers()}>{t("saveMembers")}</Button></div>
							<p className="subtitle">{t("categoryMembersHint")}</p>
							<div className="asset-category-member-list">{memberAssets.length ? memberAssets.map((asset) => <label key={asset.id}><input type="checkbox" disabled={categoryBusy} checked={memberIds.includes(asset.id)} onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><span><strong>{asset.name}</strong>{asset.category && asset.category !== memberCategory && <small>{niceCategory(asset.category, t)}</small>}</span></label>) : <p>{t("none")}</p>}</div>
						</div>}
						{data.categories
							.filter((c) => c.kind === kind && !c.deleted)
							.map((c) => (
								<div className="list-row" key={c.id}>
									<strong>{c.name}</strong>
									<Button
										variant="danger"
										size="small"
										disabled={categoryBusy}
										onClick={() => void removeCategory(c)}
									>
										{t("remove")}
									</Button>
								</div>
							))}
					</div>
					<p className="subtitle">{t("categoryHelp")}</p>
				</Dialog>
			)}
		</>
	);
}

function AssetCover({ asset }: { asset: Asset }) {
	const [src, setSrc] = useState("");
	const imageId = asset.attachments[0];
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
	if (repository) return <div className="asset-repository-cover"><Code2 size={36} strokeWidth={1.8} /><strong>{asset.name}</strong><small>{domain || t("projectRepoCover")}</small></div>;
	return <div className={`asset-editorial-preview asset-editorial-${asset.category}`}>
		<div className="asset-browser-bar"><span /><span /><span /><small>{domain || asset.name}</small></div>
		<div className={`asset-browser-body${asset.attachments.length ? " has-image" : ""}`}><AssetCover asset={asset} />{!asset.attachments.length && <div className="asset-editorial-copy"><span className="asset-editorial-kicker">{domain || niceCategory(asset.category, t)}</span><strong>{asset.name}</strong>{asset.description && <p>{asset.description}</p>}</div>}</div>
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

function ProjectCard({ asset, search }: { asset: Asset; search: string }) {
	const { t } = useTranslation();
	const repository = asset.category === "repository";
	const domain = assetDomain(asset.url);
	return <Link className={`asset-project-card list-row ${repository ? "is-repository" : ""}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<div className="asset-project-cover">
			<ProjectPreview asset={asset} />
		</div>
		<div className="asset-project-info"><div className="asset-project-heading"><span className="asset-project-avatar">{Array.from(asset.name)[0]?.toLocaleUpperCase() || "•"}</span><strong>{asset.name}</strong>{asset.status && <span className="chip">{t(asset.status)}</span>}</div>
			<p>{asset.description || niceCategory(asset.category, t)}</p>
			<div className="asset-project-foot"><span>{domain || niceCategory(asset.category, t)}</span><ArrowRight size={14} aria-hidden="true" /></div>
		</div>
	</Link>;
}

function AccountCard({ asset, search, connectionCount }: { asset: Asset; search: string; connectionCount: number }) {
	const { t } = useTranslation();
	const Icon = asset.category === "email" ? Mail : asset.category === "phone" ? Smartphone : UserRound;
	return <Link className={`asset-account-card list-row asset-account-${asset.category}`} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<span className="asset-account-avatar"><Icon size={20} /></span><span className="asset-account-summary"><strong>{asset.name}</strong><small>{asset.username || asset.contact || asset.description || niceCategory(asset.category, t)}</small><span className="asset-account-tags"><span className="chip">{niceCategory(asset.category, t)}</span><span className="chip">{connectionCount} {t("relations")}</span></span></span>
	</Link>;
}

function LibraryCard({ asset, search }: { asset: Asset; search: string }) {
	const { t, i18n } = useTranslation();
	const Icon = asset.kind === "subscription" ? CreditCard : asset.kind === "vault" ? Shield : Package;
	return <Link className="asset-library-card list-row" to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => rememberAssetList(asset, search)}>
		<div className="asset-library-cover"><AssetCover asset={asset} />{!asset.attachments.length && <><Icon size={40} strokeWidth={1.7} /><span>{niceCategory(asset.category, t)}</span></>}</div>
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
	const { data, search } = useAppContext();
	const { t } = useTranslation();
	const [categories, setCategories] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			kinds.map((k) => [
				k,
				sessionStorage.getItem(`keepany-category-${k}`) || "",
			]),
		),
	);
	const category = categories[kind] || "";
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
	const choose = (value: string) => {
		sessionStorage.setItem(`keepany-category-${kind}`, value);
		setCategories((prev) => ({ ...prev, [kind]: value }));
	};
	useEffect(() => {
		function selectCategory(event: Event) {
			const selection = (event as CustomEvent<{ kind: AssetKind; category: string }>).detail;
			if (!selection || !kinds.includes(selection.kind)) return;
			sessionStorage.setItem(`keepany-category-${selection.kind}`, selection.category);
			setCategories((prev) => ({ ...prev, [selection.kind]: selection.category }));
		}
		window.addEventListener("keepany-category-select", selectCategory);
		return () => window.removeEventListener("keepany-category-select", selectCategory);
	}, []);
	useEffect(() => {
		setCategories((prev) => ({ ...prev, [kind]: sessionStorage.getItem(`keepany-category-${kind}`) || "" }));
	}, [kind]);
	const [edit, setEdit] = useState(false);
	const allLiveAssets = liveAssets(data);
	const liveIds = new Set(allLiveAssets.map((asset) => asset.id));
	const allKindAssets = allLiveAssets.filter((asset) => asset.kind === kind);
	const availableTags = [...new Set(allKindAssets.flatMap((asset) => asset.tags))].sort(
		(a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
	);
	const normalizedSearch = search.trim().toLocaleLowerCase();
	const assets = allKindAssets.filter(
		(a) =>
			(!category || a.category === category) &&
			(!tag || a.tags.includes(tag)) &&
			(!normalizedSearch ||
				`${a.name} ${a.tags.join(" ")} ${a.url} ${a.username}`
					.toLocaleLowerCase()
					.includes(normalizedSearch)),
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
					restored.current = kind;
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
		<main className="page">
			<PageTitle
				eyebrow={kind === "project" ? "PROJECT LIBRARY" : kind === "account" ? "MY ACCOUNTS" : "KeepAny"}
				title={t(kind === "project" ? "projectListTitle" : kind === "account" ? "accountListTitle" : kind === "subscription" ? "subscriptionListTitle" : kind === "vault" ? "vault" : "itemListTitle")}
				subtitle={t(kind === "project" ? "projectListSubtitle" : kind === "account" ? "accountListSubtitle" : kind === "item" ? "itemListSubtitle" : kind === "vault" ? "vaultHint" : "summary")}
				action={
					<>
						{kind === "subscription" && <Button asChild><Link to="/finance">{t("financeViewLedger")}</Link></Button>}
						<Button variant="primary" onClick={() => setEdit(true)}>
							<Plus size={17} />
							{t("add")}
						</Button>
					</>
				}
			/>
			<CategoryStrip kind={kind} chosen={category} choose={choose} />
			{(availableTags.length > 0 || tag) && (
				<div className="list-filters">
					<label htmlFor="asset-tag-filter">{t("filterTag")}</label>
					<select id="asset-tag-filter" value={tag} onChange={(e) => chooseTag(e.target.value)}>
						<option value="">{t("allTags")}</option>
						{tag && !availableTags.includes(tag) && <option value={tag}>{tag}</option>}
						{availableTags.map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
				</div>
			)}
			<section className={`asset-list-content ${kind === "project" ? "asset-project-grid" : kind === "account" ? "asset-account-grid" : "asset-library-grid"}`}>
				{assets.length ? (
					assets.map((a) => kind === "project" ? <ProjectCard asset={a} search={search} key={a.id} /> : kind === "account" ? <AccountCard asset={a} search={search} connectionCount={data.relations.filter((relation) => !relation.deleted && liveIds.has(relation.from) && liveIds.has(relation.to) && (relation.from === a.id || relation.to === a.id)).length} key={a.id} /> : <LibraryCard asset={a} search={search} key={a.id} />)
				) : (
					category || tag || normalizedSearch ? (
						<div className="empty"><strong>{t("noMatches")}</strong></div>
					) : (
						<Empty />
					)
				)}
			</section>
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
