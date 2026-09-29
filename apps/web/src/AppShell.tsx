import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	ArrowLeft,
	Bell,
	ChevronDown,
	LayoutDashboard,
	Menu,
	Plus,
	Search,
	Settings,
	Sparkles,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import { save } from "../../../packages/local-db/src";
import { COLLECTIONS_PREFERENCE_ID, readCollections } from "./collection-model";
import { useData } from "./data";
import { Button } from "./components/ui/button";
import {
	SortableNav,
	type SortableNavItem,
} from "./components/navigation/SortableNav";
import { AppContext, icons, kinds, liveAssets } from "./view-shared";
import { McpRuntimeProvider } from "./mcp-runtime";
import "./shell-restoration.css";
const AiDialog = lazy(() =>
	import("./workflows").then((module) => ({ default: module.AiDialog })),
);
const SIDEBAR_IDS = ["overview", "tasks", ...kinds];

function normalizeHiddenNavIds(value: unknown, ids: string[]): string[] {
	if (!Array.isArray(value)) return [];
	const hidden = [...new Set(value.filter((id): id is string => typeof id === "string" && id !== "overview" && ids.includes(id)))];
	if (kinds.every((kind) => hidden.includes(kind))) return hidden.filter((id) => id !== "project");
	return hidden;
}

export function AppShell() {
	const data = useData();
	const { t } = useTranslation();
	const [search, setSearch] = useState(
		() => sessionStorage.getItem("keepany-search") || "",
	);
	const [searchOpen, setSearchOpen] = useState(false);
	const topSearchPanelRef = useRef<HTMLDivElement>(null);
	const topSearchInputRef = useRef<HTMLInputElement>(null);
	const [toast, setToast] = useState("");
	const [ai, setAi] = useState(false);
	const [aiMenu, setAiMenu] = useState(false);
	const aiMenuRef = useRef<HTMLDivElement>(null);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [mobile, setMobile] = useState(false);
	const [pendingNavOrder, setPendingNavOrder] = useState<string[] | null>(null);
	const [pendingHiddenIds, setPendingHiddenIds] = useState<string[] | null>(null);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const navigate = useNavigate();
	useEffect(() => {
		if (pathname) { setSearchOpen(false); setSearch(""); setAiMenu(false); setToolsOpen(false); setMobile(false); }
	}, [pathname]);
	useEffect(() => {
		const open = () => setAi(true);
		window.addEventListener("keepany-open-ai-dialog", open);
		return () => window.removeEventListener("keepany-open-ai-dialog", open);
	}, []);
	useEffect(() => {
		const keys = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearchOpen(true);
				window.requestAnimationFrame(() => topSearchInputRef.current?.focus());
			} else if (event.key === "Escape") {
				setSearchOpen(false);
				setSearch("");
				setAiMenu(false);
				setToolsOpen(false);
			}
		};
		window.addEventListener("keydown", keys);
		return () => window.removeEventListener("keydown", keys);
	}, []);
	useEffect(() => {
		if (!aiMenu) return;
		const closeOutside = (event: PointerEvent) => {
			if (event.target instanceof Node && !aiMenuRef.current?.contains(event.target)) setAiMenu(false);
		};
		document.addEventListener("pointerdown", closeOutside);
		return () => document.removeEventListener("pointerdown", closeOutside);
	}, [aiMenu]);
	useEffect(() => {
		if (!searchOpen) return;
		const closeOutside = (event: PointerEvent) => {
			if (event.target instanceof Node && !topSearchPanelRef.current?.contains(event.target) && !(event.target as Element).closest?.(".top-search-trigger")) { setSearchOpen(false); setSearch(""); }
		};
		document.addEventListener("pointerdown", closeOutside);
		return () => document.removeEventListener("pointerdown", closeOutside);
	}, [searchOpen]);
	useEffect(() => {
		sessionStorage.setItem("keepany-search", search);
	}, [search]);
	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(""), 4500);
		return () => window.clearTimeout(timer);
	}, [toast]);
	const matches = search.trim()
		? liveAssets(data)
				.filter((a) =>
					`${a.name} ${a.tags.join(" ")} ${a.url} ${a.username}`
						.toLowerCase()
						.includes(search.toLowerCase()),
				)
				.slice(0, 6)
		: [];
	const context = useMemo(
		() => ({ data, search, setSearch, notify: setToast }),
		[data, search],
	);
	const openTasks = data.tasks.filter((x) => !x.done && !x.deleted).length;
	const navigation: SortableNavItem[] = [
		{ id: "overview", to: "/", label: t("overview"), icon: LayoutDashboard },
		{
			id: "tasks",
			to: "/tasks",
			label: t("tasks"),
			icon: Bell,
			badge: openTasks,
		},
		...kinds.map((kind) => ({
			id: kind,
			to: kind === "subscription" ? "/finance" : `/assets/${kind}`,
			label: t(kind),
			icon: icons[kind],
		})),
	];
	const customCategories = data.categories.filter((category) => !category.deleted);
	const collections = readCollections(data.preferences.find((preference) => preference.id === COLLECTIONS_PREFERENCE_ID)?.value);
	const currentKind = kinds.find((kind) => pathname.startsWith(`/assets/${kind}`));
	const currentHeading = pathname === "/" ? t("overview") : currentKind ? t(currentKind) :
		pathname === "/tasks" ? t("tasks") : pathname === "/intake" ? t("intake") :
		pathname === "/trash" ? t("trash") : t("settings");
	const detailMatch = /^\/assets\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
	const detailKind = detailMatch && kinds.includes(detailMatch[1] as (typeof kinds)[number]) ? detailMatch[1] : null;
	const projectDetailId = detailKind === "project" ? detailMatch?.[2] : null;
	const workflowMatch = /^\/assets\/project\/([^/]+)\/workflow\/(brand|close)\/?$/.exec(pathname);
	let workflowProjectId: string | null = null;
	if (workflowMatch) {
		try { workflowProjectId = decodeURIComponent(workflowMatch[1]); } catch { /* Invalid route has no project return. */ }
	}
	const collectionDetailMatch = /^\/collections\/([^/]+)\/?$/.exec(pathname);
	let collectionDetailId: string | null = null;
	if (collectionDetailMatch) {
		try { collectionDetailId = decodeURIComponent(collectionDetailMatch[1]); } catch { /* malformed route has no selected collection */ }
	}
	const relationReturnId = sessionStorage.getItem("keepany-relation-return-id");
	const relationReturnKind = sessionStorage.getItem("keepany-relation-return-kind");
	const projectReturnKind = projectDetailId && relationReturnId === projectDetailId && relationReturnKind && kinds.includes(relationReturnKind as (typeof kinds)[number]) ? relationReturnKind : "project";
	function selectCategory(kind: string, category: string) {
		sessionStorage.setItem(`keepany-category-${kind}`, category);
		setMobile(false);
		void navigate({ to: "/assets/$kind", params: { kind } }).then(() => {
			window.dispatchEvent(new CustomEvent("keepany-category-select", { detail: { kind, category } }));
		});
	}
	const savedNavOrder = data.preferences.find(
		(p) => p.id === "sidebarOrder",
	)?.value;
	const navOrder =
		pendingNavOrder ??
		(Array.isArray(savedNavOrder)
			? savedNavOrder.filter((id): id is string => typeof id === "string")
			: []);
	const savedHiddenIds = data.preferences.find((preference) => preference.id === "sidebarHidden")?.value;
	const hiddenIds = normalizeHiddenNavIds(pendingHiddenIds ?? savedHiddenIds, SIDEBAR_IDS);
	const visibleAssetKindCount = kinds.filter((kind) => !hiddenIds.includes(kind)).length;
	useEffect(() => {
		if (
			pendingNavOrder &&
			Array.isArray(savedNavOrder) &&
			pendingNavOrder.join("\u0000") === savedNavOrder.join("\u0000")
		)
			setPendingNavOrder(null);
	}, [pendingNavOrder, savedNavOrder]);
	useEffect(() => {
		if (pendingHiddenIds && JSON.stringify(pendingHiddenIds) === JSON.stringify(normalizeHiddenNavIds(savedHiddenIds, SIDEBAR_IDS))) {
			setPendingHiddenIds(null);
		}
	}, [pendingHiddenIds, savedHiddenIds]);
	const orderedNavigation = [...navigation].sort((a, b) => {
		const ai = navOrder.indexOf(a.id),
			bi = navOrder.indexOf(b.id);
		return (
			(ai < 0 ? navigation.length : ai) - (bi < 0 ? navigation.length : bi)
		);
	}).map((item) => {
		const visible = !hiddenIds.includes(item.id);
		const mustKeepAsset = kinds.includes(item.id as (typeof kinds)[number]) && visible && visibleAssetKindCount === 1;
		return {
			...item,
			visible,
			visibilityLocked: item.id === "overview" || mustKeepAsset,
			visibilityLockReason: item.id === "overview" ? t("navAlwaysVisible") : mustKeepAsset ? t("navAtLeastOneAsset") : undefined,
		};
	});
	function changeVisibility(id: string, visible: boolean) {
		if (id === "overview" || !SIDEBAR_IDS.includes(id)) return;
		const next = normalizeHiddenNavIds(visible ? hiddenIds.filter((item) => item !== id) : [...hiddenIds, id], SIDEBAR_IDS);
		if (!visible && !next.includes(id)) {
			setToast(t("navAtLeastOneAsset"));
			return;
		}
		setPendingHiddenIds(next);
		void save("preference", { id: "sidebarHidden", value: next }).catch(() => {
			setPendingHiddenIds(null);
			setToast(t("error"));
		});
	}
	function changeOrder(ids: string[]) {
		const fullIds = orderedNavigation.map((item) => item.id);
		const orderedIds = (() => {
			const visibleIds = new Set(ids);
			let position = 0;
			return fullIds.map((id) => visibleIds.has(id) ? ids[position++] : id);
		})();
		setPendingNavOrder(orderedIds);
		void save("preference", { id: "sidebarOrder", value: orderedIds }).catch(() => {
			setPendingNavOrder(null);
			setToast(t("error"));
		});
	}
	return (
		<AppContext.Provider value={context}>
			<McpRuntimeProvider assets={liveAssets(data)}>
			<div className="shell">
				<aside
					className={`sidebar ${mobile ? "open" : ""}`}
				>
					<div className="brand">
						<span className="brand-mark">K</span>
						<div>
							<strong>KeepAny</strong>
							<small>{t("workspaceTagline")}</small>
						</div>
						<Button
							className="mobile-close"
							variant="ghost"
							size="icon"
							onClick={() => setMobile(false)}
							aria-label={t("close")}
						>
							<X size={18} />
						</Button>
					</div>
					<button type="button" className="workspace-current" onClick={() => setToast(t("personalWorkspace"))}><span className="workspace-avatar"><UserRound size={15}/></span><strong>{t("personalWorkspace")}</strong><ChevronDown size={14} aria-hidden="true" /></button>
					<div className="sidebar-section-label">{t("workspaceSection")}</div>
					<nav className="nav" aria-label={t("navigation")}>
						<SortableNav
							items={orderedNavigation.filter((item) => item.visible)}
							activePath={pathname}
							manageMode={false}
							onOrderChange={changeOrder}
							onVisibilityChange={changeVisibility}
							onNavigate={() => setMobile(false)}
						/>
					</nav>
					<div className="sidebar-custom">
						<div className="sidebar-section-label">{t("collectionsTitle")}</div>
						{collections.map((collection) => <Link key={collection.id} to="/collections/$id" params={{ id: collection.id }} className="sidebar-category sidebar-collection" aria-current={collectionDetailId === collection.id ? "page" : undefined} onClick={() => setMobile(false)}>{collection.name}</Link>)}
						{customCategories.map((category) => <button type="button" key={category.id} className="sidebar-category" onClick={() => selectCategory(category.kind, category.name)}>{category.name}</button>)}
						<Link to="/collections" className="sidebar-customize" aria-current={/^\/collections\/?$/.test(pathname) ? "page" : undefined} onClick={() => setMobile(false)}><Plus size={15}/>{t("customizeSidebar")}</Link>
					</div>
					<div className="side-bottom">
						{toolsOpen && <div className="sidebar-tools-menu"><Link to="/intake" onClick={() => { setToolsOpen(false); setMobile(false); }}><Plus size={18}/>{t("intake")}</Link><Link to="/trash" onClick={() => { setToolsOpen(false); setMobile(false); }}><Trash2 size={18}/>{t("trash")}</Link><Link to="/settings" onClick={() => { setToolsOpen(false); setMobile(false); }}><Settings size={18}/>{t("settings")}</Link></div>}
						<button type="button" className="sidebar-user" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}><span>{t("meInitial")}</span><span><strong>{t("myWorkspace")}</strong><small>{t("privateWorkspace")}</small></span><ChevronDown size={14} aria-hidden="true" /></button>
					</div>
				</aside>
				{mobile && (
					<button
						type="button"
						className="mobile-scrim"
						aria-label={t("close")}
						onClick={() => setMobile(false)}
					/>
				)}
				<div className="main">
					<header className="topbar">
						<Button
							className="mobile-menu"
							variant="ghost"
							size="icon"
							onClick={() => setMobile(true)}
							aria-label={t("navigation")}
						>
							<Menu size={20} />
						</Button>
						{detailKind ? <Link className="topbar-page-label topbar-back-link" to="/assets/$kind" params={{ kind: projectDetailId ? projectReturnKind : detailKind }} onClick={projectDetailId ? () => { sessionStorage.removeItem("keepany-relation-return-id"); sessionStorage.removeItem("keepany-relation-return-kind"); } : undefined}><ArrowLeft size={15}/>{t("back")}</Link> : workflowProjectId ? <Link className="topbar-page-label topbar-back-link" to="/assets/$kind/$id" params={{ kind: "project", id: workflowProjectId }}><ArrowLeft size={15}/>{t("workflowBackToProject")}</Link> : collectionDetailId ? <Link className="topbar-page-label topbar-back-link" to="/collections"><ArrowLeft size={15}/>{t("collectionBack")}</Link> : pathname !== "/" ? <Link className="topbar-page-label topbar-back-link" to="/"><ArrowLeft size={15}/>{t("backToOverview")}</Link> : <strong className="topbar-page-label">{currentHeading}</strong>}
						<div className="topbar-spacer"/>
						<button className="top-search top-search-trigger" type="button" aria-label={t("search")} aria-expanded={searchOpen} onClick={() => { if (searchOpen) { setSearchOpen(false); setSearch(""); } else { setSearchOpen(true); window.requestAnimationFrame(() => topSearchInputRef.current?.focus()); } }}><Search size={17} /><span>{t("search")}</span>
							<kbd>⌘ K</kbd>
						</button>
						<div className="top-actions">
							<Link to="/tasks" className="top-icon-button" aria-label={t("taskReminders")}><Bell size={17}/>{openTasks > 0 && <i aria-hidden="true"/>}</Link>
							<div className="top-ai-wrap" ref={aiMenuRef}>
								<Button className="top-icon-button" variant="ghost" aria-label={t("assistantMenu")} aria-expanded={aiMenu} onClick={() => setAiMenu((value) => !value)}><Sparkles size={17}/></Button>
								{aiMenu && <div className="top-ai-menu"><Link to="/change-impact" onClick={() => setAiMenu(false)}>{t("checkChangeImpact")}</Link><Link to="/assistant-access" onClick={() => setAiMenu(false)}>{t("settingsAssistantAccess")}</Link></div>}
							</div>
							<Link
								to="/intake"
								className="top-icon-button"
								aria-label={t("intake")}
							>
							<Plus size={18} />
							</Link>
						</div>
					</header>
					{searchOpen && <div className="top-search-panel" ref={topSearchPanelRef}>
						<label htmlFor="top-search-query">{t("search")}</label>
						<div className="top-search-panel-input"><input id="top-search-query" ref={topSearchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("search")} autoComplete="off" /><button type="button" onClick={() => { setSearchOpen(false); setSearch(""); }} aria-label={t("close")}><X size={17}/></button></div>
						{search.trim() && <div className="search-results">{matches.length ? matches.map((asset) => <Link key={asset.id} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }} onClick={() => { setSearch(""); setSearchOpen(false); }}><strong>{asset.name}</strong><small>{t(asset.kind)}</small></Link>) : <p>{t("none")}</p>}</div>}
						<button type="button" className="top-search-panel-close" onClick={() => { setSearchOpen(false); setSearch(""); }}>{t("close")}</button>
					</div>}
					{data.loading ? (
						<main className="page">
							<div className="notice" role="status">
								{t("loading")}
							</div>
						</main>
					) : (
						<Outlet />
					)}
				</div>
			</div>
			{data.error && (
				<div className="toast error" role="alert">
					{t("error")}
				</div>
			)}
			{toast && (
				<div className="toast" role="status">
					{toast}
				</div>
			)}
			{ai && (
				<Suspense
					fallback={
						<div className="toast" role="status">
							{t("loading")}
						</div>
					}
				>
					<AiDialog assets={liveAssets(data)} onClose={() => setAi(false)} />
				</Suspense>
			)}
			</McpRuntimeProvider>
		</AppContext.Provider>
	);
}
