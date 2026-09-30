import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Bell, FolderPlus, LayoutDashboard, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { normalizeCategoryName, type Asset, type AssetKind } from "../../../packages/domain/src";
import { localRepository, savePreferenceIfCurrent } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { SortableNav, type SortableNavItem } from "./components/navigation/SortableNav";
import { COLLECTIONS_PREFERENCE_ID, readCollections, type AssetCollection } from "./collection-model";
import { PageTitle, icons, kinds, liveAssets, niceCategory, useAppContext } from "./view-shared";
import "./collections.css";

type CollectionDraft = AssetCollection & { creating: boolean; original?: AssetCollection };
const sidebarIds = ["overview", "tasks", ...kinds];
const newDraft = (): CollectionDraft => ({ id: crypto.randomUUID(), name: "", assetIds: [], creating: true });

function orderedSidebarIds(value: unknown): string[] {
	const saved = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && sidebarIds.includes(id)) : [];
	return [...new Set([...saved, ...sidebarIds])];
}

function hiddenSidebarIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const hidden = [...new Set(value.filter((id): id is string => typeof id === "string" && id !== "overview" && sidebarIds.includes(id)))];
	return kinds.every((kind) => hidden.includes(kind)) ? hidden.filter((id) => id !== "project") : hidden;
}

function collectionIdFromPath(pathname: string): string | null {
	const match = /^\/collections\/([^/]+)\/?$/.exec(pathname);
	if (!match) return null;
	try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function CollectionsPage() {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
	const navigate = useNavigate();
	const pathname = useLocation({ select: (location) => location.pathname });
	const selectedId = collectionIdFromPath(pathname);
	const collections = readCollections(data.preferences.find((item) => item.id === COLLECTIONS_PREFERENCE_ID)?.value);
	const selected = collections.find((item) => item.id === selectedId);
	const assets = liveAssets(data);
	const assetById = new Map(assets.map((asset) => [asset.id, asset]));
	const [editor, setEditor] = useState<CollectionDraft | null>(() => selectedId ? null : newDraft());
	const [search, setSearch] = useState("");
	const [error, setError] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<AssetCollection | null>(null);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
	const [pendingHidden, setPendingHidden] = useState<string[] | null>(null);
	const [navError, setNavError] = useState("");
	const navInFlight = useRef(false);
	const savedOrder = data.preferences.find((item) => item.id === "sidebarOrder");
	const savedHidden = data.preferences.find((item) => item.id === "sidebarHidden");
	const sidebarOrder = orderedSidebarIds(pendingOrder ?? savedOrder?.value);
	const sidebarHidden = hiddenSidebarIds(pendingHidden ?? savedHidden?.value);
	const visibleAssetKinds = kinds.filter((kind) => !sidebarHidden.includes(kind)).length;
	const sidebarItems: SortableNavItem[] = sidebarOrder.map((id) => ({
		id,
		to: id === "overview" ? "/" : id === "tasks" ? "/tasks" : id === "subscription" ? "/finance" : `/assets/${id}`,
		label: t(id === "overview" ? "overview" : id === "tasks" ? "tasks" : id),
		icon: id === "overview" ? LayoutDashboard : id === "tasks" ? Bell : icons[id as AssetKind],
		visible: !sidebarHidden.includes(id),
		visibilityLocked: id === "overview" || (kinds.includes(id as AssetKind) && !sidebarHidden.includes(id) && visibleAssetKinds === 1),
		visibilityLockReason: id === "overview" ? t("navAlwaysVisible") : visibleAssetKinds === 1 ? t("navAtLeastOneAsset") : undefined,
	}));

	useEffect(() => {
		if (pendingOrder && JSON.stringify(orderedSidebarIds(savedOrder?.value)) === JSON.stringify(pendingOrder)) setPendingOrder(null);
	}, [pendingOrder, savedOrder?.value]);
	useEffect(() => {
		if (pendingHidden && JSON.stringify(hiddenSidebarIds(savedHidden?.value)) === JSON.stringify(pendingHidden)) setPendingHidden(null);
	}, [pendingHidden, savedHidden?.value]);

	useEffect(() => {
		setEditor(selectedId ? null : newDraft());
		setDeleteTarget(null);
		setError("");
		setSearch("");
	}, [selectedId]);

	const openNew = () => {
		setEditor(newDraft());
		setError("");
		setSearch("");
		if (selectedId) void navigate({ to: "/collections" });
	};
	const updateSidebar = async (id: "sidebarOrder" | "sidebarHidden", value: string[]) => {
		if (navInFlight.current) return;
		navInFlight.current = true;
		setNavError("");
		if (id === "sidebarOrder") setPendingOrder(value); else setPendingHidden(value);
		try {
			const expected = data.preferences.find((item) => item.id === id);
			await savePreferenceIfCurrent(expected ?? null, { id, value });
		} catch (cause) {
			if (id === "sidebarOrder") setPendingOrder(null); else setPendingHidden(null);
			setNavError(t(cause instanceof Error && cause.message === "preference-stale" ? "organizeChanged" : "error"));
		} finally { navInFlight.current = false; }
	};
	const changeVisibility = (id: string, visible: boolean) => {
		if (id === "overview" || !sidebarIds.includes(id)) return;
		if (!visible && kinds.includes(id as AssetKind) && visibleAssetKinds === 1) { setNavError(t("navAtLeastOneAsset")); return; }
		const next = hiddenSidebarIds(visible ? sidebarHidden.filter((item) => item !== id) : [...sidebarHidden, id]);
		void updateSidebar("sidebarHidden", next);
	};
	const openEdit = (collection: AssetCollection) => {
		setEditor({ ...collection, assetIds: [...collection.assetIds], creating: false, original: collection });
		setError("");
		setSearch("");
	};
	const toggleAsset = (assetId: string, checked: boolean) => {
		setEditor((current) => current && ({
			...current,
			assetIds: checked
				? [...new Set([...current.assetIds, assetId])]
				: current.assetIds.filter((id) => id !== assetId),
		}));
	};
	const saveCollection = async (event: FormEvent) => {
		event.preventDefault();
		if (!editor || inFlight.current) return;
		const name = editor.name.trim();
		if (!name) { setError(t("required")); return; }
		if (name.length > 20) { setError(t("collectionNameTooLong")); return; }
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			const repository = await localRepository();
			const current = await repository.get<{ id: string; value: unknown }>("preference", COLLECTIONS_PREFERENCE_ID);
			const latest = readCollections(current?.value);
			const existing = latest.find((item) => item.id === editor.id);
			if (!editor.creating && !existing) { setError(t("collectionMissing")); return; }
			if (!editor.creating && JSON.stringify(existing) !== JSON.stringify(editor.original)) {
				setError(t("collectionChanged"));
				return;
			}
			if (editor.creating && latest.length >= 8) { setError(t("collectionLimit")); return; }
			if (latest.some((item) => item.id !== editor.id && normalizeCategoryName(item.name) === normalizeCategoryName(name))) {
				setError(t("collectionDuplicate"));
				return;
			}
			const validIds = new Set((await repository.list<Asset>("asset")).map((asset) => asset.id));
			const retainedMissingIds = (existing?.assetIds ?? []).filter((id) => !validIds.has(id));
			const updated: AssetCollection = {
				id: editor.id,
				name,
				assetIds: [...new Set([
					...retainedMissingIds,
					...editor.assetIds.filter((id) => validIds.has(id)),
				])],
			};
			const next = editor.creating ? [...latest, updated] : latest.map((item) => item.id === editor.id ? updated : item);
			await savePreferenceIfCurrent(current, { id: COLLECTIONS_PREFERENCE_ID, value: next });
			setEditor(null);
			notify(t("saved"));
			await navigate({ to: "/collections/$id", params: { id: updated.id } });
		} catch (cause) {
			setError(t(cause instanceof Error && cause.message === "preference-stale" ? "collectionChanged" : "error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	};
	const deleteCollection = async () => {
		if (!deleteTarget || inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			const repository = await localRepository();
			const current = await repository.get<{ id: string; value: unknown }>("preference", COLLECTIONS_PREFERENCE_ID);
			const latest = readCollections(current?.value);
			const existing = latest.find((item) => item.id === deleteTarget.id);
			if (JSON.stringify(existing) !== JSON.stringify(deleteTarget)) {
				setError(t("collectionChanged"));
				return;
			}
			await savePreferenceIfCurrent(current, { id: COLLECTIONS_PREFERENCE_ID, value: latest.filter((item) => item.id !== deleteTarget.id) });
			setDeleteTarget(null);
			setEditor(selectedId ? null : newDraft());
			notify(t("saved"));
			if (selectedId === deleteTarget.id) await navigate({ to: "/collections" });
		} catch (cause) {
			setError(t(cause instanceof Error && cause.message === "preference-stale" ? "collectionChanged" : "error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	};
	const memberAssets = selected?.assetIds.map((id) => assetById.get(id)).filter((asset): asset is Asset => !!asset) ?? [];
	const normalizedSearch = search.trim().toLocaleLowerCase();
	const visibleAssets = assets.filter((asset) => !normalizedSearch || asset.name.toLocaleLowerCase().includes(normalizedSearch));
	const organizing = !selectedId || !!editor;

	return (
		<main className={`page collections-page${organizing ? " collections-organize-page" : ""}`}>
			<PageTitle
				eyebrow={organizing ? t("organizeEyebrow") : t("collectionsTitle")}
				title={organizing ? t("organizeTitle") : selected ? selected.name : t("collectionMissing")}
				subtitle={organizing ? t("organizeSubtitle") : selected ? t("collectionAssetCount", { count: memberAssets.length }) : undefined}
				action={organizing ? <Button variant="primary" onClick={openNew} disabled={collections.length >= 8}><Plus size={16} />{t("collectionCreate")}</Button> :
					selected ? <Button onClick={() => openEdit(selected)}><Pencil size={16} />{t("collectionEdit")}</Button> : undefined}
			/>
			{organizing ? (
				<section className="card collections-organize-nav" aria-label={t("organizeNavTitle")}>
					<div className="card-header"><div><h2>{t("organizeNavTitle")}</h2><p>{t("organizeNavHint")}</p></div></div>
					<div className="collections-nav"><SortableNav items={sidebarItems} activePath="/collections" manageMode onNavigate={() => {}}
						onOrderChange={(ids) => void updateSidebar("sidebarOrder", ids)} onVisibilityChange={changeVisibility} /></div>
					{navError && <p className="field-error collections-nav-error" role="alert">{navError}</p>}
				</section>
			) : selected ? (
				<section className="collections-members" aria-label={selected.name}>
					{memberAssets.length ? <div className="collections-member-grid">{memberAssets.map((asset) => {
						const Icon = icons[asset.kind];
						return <Link className="collections-member-card" key={asset.id} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }}>
							<div className={`collections-member-cover collections-member-${asset.kind}`}><Icon size={34} strokeWidth={1.7} aria-hidden="true" /><span>{niceCategory(asset.category, t)}</span></div>
							<div className="collections-member-body"><strong>{asset.name}</strong><small>{asset.description || asset.location || niceCategory(asset.category, t)}</small><div><span className="chip">{t(asset.kind)}</span><span className="chip">{t(asset.status)}</span></div></div>
						</Link>;
					})}</div> : <div className="card"><p>{t("collectionMembersEmpty")}</p></div>}
				</section>
			) : <section className="card"><p>{t("collectionMissing")}</p></section>}
			{editor && <section className="card collections-editor" aria-label={editor.creating ? t("collectionCreate") : t("collectionEdit")}>
				<form onSubmit={(event) => void saveCollection(event)}>
					<div className="card-header"><h2>{editor.creating ? t("collectionCreate") : t("collectionEdit")}</h2></div>
					<div className="field">
						<label htmlFor="collection-name">{t("collectionName")}</label>
						<input id="collection-name" value={editor.name} placeholder={t("collectionNameExample")} disabled={busy} aria-invalid={!!error} onChange={(event) => { setEditor({ ...editor, name: event.target.value }); setError(""); }} />
					</div>
					<fieldset className="collections-fieldset"><legend>{t("collectionMembers")}</legend>
						<div className="field"><label htmlFor="collection-search">{t("collectionSearchAssets")}</label><input id="collection-search" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
						<div className="collections-options">
							{kinds.map((kind: AssetKind) => {
								const group = visibleAssets.filter((asset) => asset.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
								return group.length ? <div className="collections-kind" key={kind}>
									<h3>{t(kind)}</h3>
									{group.map((asset) => <label className="collections-option" key={asset.id}>
										<input type="checkbox" checked={editor.assetIds.includes(asset.id)} disabled={busy} onChange={(event) => toggleAsset(asset.id, event.target.checked)} />
										<span>{asset.name}</span>
									</label>)}
								</div> : null;
							})}
						</div>
					</fieldset>
					{error && <p className="field-error" role="alert">{error}</p>}
					<div className="actions">
						<Button variant="primary" type="submit" disabled={busy}>{busy ? t("loading") : t("collectionSave")}</Button>
						<Button type="button" disabled={busy} onClick={() => { if (!inFlight.current) { if (selectedId) setEditor(null); else openNew(); } }}>{t("cancel")}</Button>
						{!editor.creating && <Button type="button" variant="danger" disabled={busy} onClick={() => { setError(""); setDeleteTarget(editor.original ?? editor); }}><Trash2 size={15} />{t("collectionDelete")}</Button>}
						<Button type="button" disabled={busy} onClick={openNew}>{t("collectionAddAnother")}</Button>
					</div>
				</form>
			</section>}
			{organizing && collections.length > 0 && <section className="collections-grid collections-existing" aria-label={t("collectionsTitle")}>
				{collections.map((collection) => {
					const count = collection.assetIds.filter((id) => assetById.has(id)).length;
					return <article className="card collections-tile" key={collection.id}>
						<FolderPlus size={25} aria-hidden="true" />
						<Link to="/collections/$id" params={{ id: collection.id }}><strong>{collection.name}</strong></Link>
						<small>{t("collectionAssetCount", { count })}</small>
						<div className="actions"><Button size="small" onClick={() => openEdit(collection)}>{t("edit")}</Button><Button size="small" variant="danger" onClick={() => { setError(""); setDeleteTarget(collection); }}>{t("collectionDelete")}</Button></div>
				</article>;
				})}
			</section>}
			{deleteTarget && <Dialog title={t("collectionDelete")} onClose={() => { if (!inFlight.current) setDeleteTarget(null); }}>
				<p>{t("collectionDeleteHint")}</p>
				{error && <p className="field-error" role="alert">{error}</p>}
				<div className="actions"><Button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>{t("cancel")}</Button><Button type="button" variant="danger" disabled={busy} onClick={() => void deleteCollection()}>{t("collectionDelete")}</Button></div>
			</Dialog>}
		</main>
	);
}
