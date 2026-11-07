import { ReminderCenter } from "./ReminderCenter";
import { openReminderCenter } from "./reminder-navigation";
import "./reminder-entry.css";
import { Input } from "./components/ui/input";
import { catalogCategories, catalogCategoryLabel } from './catalog-records';
import { readCatalogRecordReturn } from './workspace-return';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef } from "react";
import { createPortal } from "react-dom";
import { createLink, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	ArrowLeft,
	Bell,
	LayoutDashboard,
	Layers,
	Ellipsis,
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./components/ui/dropdown-menu";
import {
	SortableNav,
	type SortableNavItem,
} from "./components/navigation/SortableNav";
import { AppContext, kinds, liveAssets } from "./view-shared";
import { McpRuntimeProvider } from "./mcp-runtime";
import { PasswordVaultProvider } from "./components/PasswordVaultProvider";
import { buildGlobalSearchIndex, searchGlobalIndex, type GlobalSearchLabels } from "./global-search";
import { requestSearchLocation } from "./search-location";
import "./shell-restoration.css";
import "./components/ui/text-link.css";
import { ReminderRuntime } from "./ReminderRuntime";
import { Dialog } from "./components/ui/dialog";
const AiDialog = lazy(() =>
	import("./workflow-ai-dialog").then((module) => ({ default: module.AiDialog })),
);
import { workspaceGroupIds, workspaceNavHidden, workspaceNavIds, workspaceNavOrder, workspacePathGroup } from "./workspace-navigation";
import { readWorkspaceReturn } from "./workspace-return";
const SIDEBAR_IDS = workspaceNavIds;

const normalizeHiddenNavIds = workspaceNavHidden;

const TopbarBackLink = createLink(function TopbarBackAnchor({ children, ...anchorProps }: ComponentPropsWithRef<"a">) {
	return (
		<Button asChild variant="primary" className="topbar-back-link">
			<a {...anchorProps}>
				<ArrowLeft size={16} aria-hidden="true" />
				{children}
			</a>
		</Button>
	);
});

export function AppShell() {
	const data = useData();
	const { t, i18n } = useTranslation();
	const [search, setSearch] = useState(
		() => sessionStorage.getItem("keepany-search") || "",
	);
	const [pendingAccountName, setPendingAccountName] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const topSearchTriggerRef = useRef<HTMLButtonElement>(null);
	const topSearchPanelRef = useRef<HTMLDivElement>(null);
	const topSearchInputRef = useRef<HTMLInputElement>(null);
	const [toast, setToast] = useState("");
	const [remindersOpen, setRemindersOpen] = useState(false);
	const [feedbackTarget, setFeedbackTarget] = useState<HTMLElement | null>(null);
	const [accountToolbarTarget, setAccountToolbarTarget] = useState<HTMLDivElement | null>(null);
	const [ai, setAi] = useState(false);
	const [mobile, setMobile] = useState(false);
	const [pendingNavOrder, setPendingNavOrder] = useState<string[] | null>(null);
	const [pendingHiddenIds, setPendingHiddenIds] = useState<string[] | null>(null);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const hash = useRouterState({ select: (s) => s.location.hash });
	const privateAccountDetail = ["/accounts", "/assets/account", "/assets/vault"].includes(pathname) && hash.startsWith("login-detail-");
	const navigate = useNavigate();
	useEffect(() => {
		const toolbar = accountToolbarTarget?.parentElement;
		const header = toolbar?.querySelector<HTMLElement>(".topbar");
		if (!toolbar || !header) return;
		const root = document.documentElement;
		const update = () => {
			const inset = Number.parseFloat(getComputedStyle(toolbar).top) || 0;
			root.style.setProperty("--account-toolbar-offset", `${toolbar.offsetHeight + inset + 8}px`);
			toolbar.style.setProperty("--account-nav-height", `${header.offsetHeight}px`);
		};
		const observer = new ResizeObserver(update);
		observer.observe(toolbar);
		observer.observe(header);
		update();
		return () => {
			observer.disconnect();
			root.style.removeProperty("--account-toolbar-offset");
			toolbar.style.removeProperty("--account-nav-height");
		};
	}, [accountToolbarTarget]);
	useEffect(() => {
		if (pathname !== "/accounts") setPendingAccountName("");
		if (pathname) { setSearchOpen(false); setSearch(""); setMobile(false); }
	}, [pathname]);

    useEffect(() => {
        const onBack = (event: Event) => {
            if (event.defaultPrevented) return;
            if (mobile) { event.preventDefault(); setMobile(false); }
            else if (searchOpen) { event.preventDefault(); setSearchOpen(false); setSearch(""); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".top-search-trigger")?.focus()); }
        };
        window.addEventListener("keepany-native-back", onBack);
        return () => window.removeEventListener("keepany-native-back", onBack);
    }, [mobile, searchOpen]);
    useEffect(() => {
        const wide = window.matchMedia("(min-width: 761px)");
        const close = () => { if (wide.matches) setMobile(false); };
        wide.addEventListener("change", close);
        return () => wide.removeEventListener("change", close);
    }, []);

	useEffect(() => {
		const open = () => setAi(true);
		window.addEventListener("keepany-open-ai-dialog", open);
		return () => window.removeEventListener("keepany-open-ai-dialog", open);
	}, []);
	useEffect(() => {
		const keys = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setMobile(false);
				setSearchOpen(true);
				window.requestAnimationFrame(() => topSearchInputRef.current?.focus());
			} else if (event.key === "Escape") {
				if (topSearchPanelRef.current?.contains(document.activeElement)) {
					topSearchTriggerRef.current?.focus({ preventScroll: true });
				}
				setSearchOpen(false);
				setSearch("");
			}
		};
		window.addEventListener("keydown", keys);
		return () => window.removeEventListener("keydown", keys);
	}, []);
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
	const searchLabels = useMemo((): GlobalSearchLabels => ({
		walletKind: t('wallet'),
		assetKinds: { project: t("project"), account: t("account"), item: t("item"), subscription: t("subscription"), vault: t("vault") },
		financeActions: { expense: t("financeActionExpense"), topup: t("financeActionTopup"), refund: t("financeActionRefund"), balance: t("financeActionBalance"), renew: t("financeRenewalRecorded") },
		sources: { asset: t("globalSearchAsset"), finance: t("globalSearchFinance"), intake: t("globalSearchIntake"), task: t("globalSearchTask") },
		taskStates: { pending: t("pending"), done: t("done") }, intakeAccepted: t("reviewStatusAccepted"),
	}), [t]);
	const searchIndex = useMemo(() => buildGlobalSearchIndex({
		assets: data.assets, history: [], tasks: data.tasks,
		reviewedCandidates: data.reviewedCandidates, reviewedCandidatesLoaded: data.reviewedCandidatesLoaded,
		locale: i18n.language, labels: searchLabels,
	}), [data.assets, data.history, data.tasks, data.reviewedCandidates, data.reviewedCandidatesLoaded, i18n.language, searchLabels]);
	const matches = useMemo(() => searchGlobalIndex(searchIndex, search), [searchIndex, search]);
	function closeSearch(hash?: string) {
		setSearch(""); setSearchOpen(false);
		if (hash) requestSearchLocation(hash);
	}
	const context = useMemo(
		() => ({ data, search, setSearch, notify: setToast, registerFeedbackTarget: setFeedbackTarget, accountToolbarTarget, pendingAccountName, setPendingAccountName }),
		[data, search, accountToolbarTarget, pendingAccountName],
	);
	const navigation: SortableNavItem[] = [
		{ id: "overview", to: "/", label: t("overview"), icon: LayoutDashboard },
		{ id: "assets", to: "/assets", label: t("assetsWorkspace"), icon: Layers, active: workspacePathGroup(pathname) === "assets" },
		{ id: "accounts", to: "/accounts", label: t("accountsWorkspace"), icon: UserRound, active: workspacePathGroup(pathname) === "accounts" },
	];
	const customCategories = data.categories.filter((category) => !category.deleted && !category.hidden);
	const collections = readCollections(data.preferences.find((preference) => preference.id === COLLECTIONS_PREFERENCE_ID)?.value);
	const currentKind = kinds.find((kind) => pathname.startsWith(`/assets/${kind}`));
	const currentHeading = pathname === "/" ? t("overview") : currentKind ? t(currentKind) :
		pathname === "/intake" ? t("intake") :
		pathname === "/trash" ? t("trash") : t("settings");
	const detailMatch = /^\/assets\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
	const detailKind = detailMatch && kinds.includes(detailMatch[1] as (typeof kinds)[number]) ? detailMatch[1] : null;
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
	const hasRelationReturn = Boolean(detailKind && relationReturnId === detailMatch?.[2] && relationReturnKind && kinds.includes(relationReturnKind as (typeof kinds)[number]));
	const detailReturnKind = hasRelationReturn ? relationReturnKind as (typeof kinds)[number] : detailKind;
	let detailAssetId: string | undefined;
	try { detailAssetId = detailMatch ? decodeURIComponent(detailMatch[2]) : undefined; } catch { /* Malformed links have no saved return target. */ }
 let unifiedDetailReturn: {to: "/records/$id"; params: {id: string}} | {to: "/assets/$kind/$id"; params: {kind: "item" | "subscription" | "project"; id: string}} | null = null;
 try {
  const saved = JSON.parse(sessionStorage.getItem("keepany-detail-account-return") ?? "null");
  if (detailKind === "account" && saved?.accountId === detailAssetId && typeof saved.path === "string" && /^\/(?:records\/[^/]+|assets\/(?:item|subscription|project)\/[^/]+)$/.test(saved.path)) {
   const record = /^\/records\/([^/]+)$/.exec(saved.path), detail = /^\/assets\/(item|subscription|project)\/([^/]+)$/.exec(saved.path);
   if (record) unifiedDetailReturn = {to: "/records/$id", params: {id: decodeURIComponent(record[1])}};
   else if (detail) unifiedDetailReturn = {to: "/assets/$kind/$id", params: {kind: detail[1] as "item" | "subscription" | "project", id: decodeURIComponent(detail[2])}};
  }
 } catch { /* Ignore an invalid local return hint. */ }
	useEffect(() => {
  try { const saved = JSON.parse(sessionStorage.getItem("keepany-detail-account-return") ?? "null");
   if (saved && (pathname === saved.path || pathname === "/accounts")) sessionStorage.removeItem("keepany-detail-account-return");
  } catch { sessionStorage.removeItem("keepany-detail-account-return"); }
 }, [pathname]);
 const workspaceReturn = detailAssetId && !hasRelationReturn ? readWorkspaceReturn(detailAssetId) : null;
 let catalogRecordId = '';
 try {catalogRecordId = /^\/records\/([^/]+)\/?$/.exec(pathname)?.[1] ?? '';catalogRecordId=decodeURIComponent(catalogRecordId);}catch{/* Invalid record routes fall back to Assets. */}
 if(!catalogRecordId && detailKind === 'project' && data.assets.some(a=>a.id===detailAssetId && !!a.walletCard))catalogRecordId=`asset:${detailAssetId}`;
 const catalogReturn = catalogRecordId ? readCatalogRecordReturn(catalogRecordId,catalogCategories(data.categories),!!data.assets.find(a=>`asset:${a.id}`===catalogRecordId)?.walletCard) : null;
	function selectCategory(kind: string, category: string, categoryId: string) {
		sessionStorage.setItem(`keepany-category-${kind}`, category);
		sessionStorage.setItem(`keepany-category-id-${kind}`, categoryId);
		setMobile(false);
		void navigate({ to: "/assets/$kind", params: { kind } }).then(() => {
			window.dispatchEvent(new CustomEvent("keepany-category-select", { detail: { kind, category, categoryId } }));
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
	const hiddenIds = normalizeHiddenNavIds(pendingHiddenIds ?? savedHiddenIds);
	const visibleAssetKindCount = workspaceGroupIds.filter((kind) => !hiddenIds.includes(kind)).length;
	useEffect(() => {
		if (
			pendingNavOrder &&
			Array.isArray(savedNavOrder) &&
			pendingNavOrder.join("\u0000") === savedNavOrder.join("\u0000")
		)
			setPendingNavOrder(null);
	}, [pendingNavOrder, savedNavOrder]);
	useEffect(() => {
		if (pendingHiddenIds && JSON.stringify(pendingHiddenIds) === JSON.stringify(normalizeHiddenNavIds(savedHiddenIds))) {
			setPendingHiddenIds(null);
		}
	}, [pendingHiddenIds, savedHiddenIds]);
	const orderedNavigation = [...navigation].sort((a, b) => {
		const ai = workspaceNavOrder(navOrder).indexOf(a.id),
			bi = workspaceNavOrder(navOrder).indexOf(b.id);
		return (
			(ai < 0 ? navigation.length : ai) - (bi < 0 ? navigation.length : bi)
		);
	}).map((item) => {
		const visible = !hiddenIds.includes(item.id);
		const mustKeepAsset = workspaceGroupIds.includes(item.id) && visible && visibleAssetKindCount === 1;
		return {
			...item,
			visible,
			visibilityLocked: item.id === "overview" || mustKeepAsset,
			visibilityLockReason: item.id === "overview" ? t("navAlwaysVisible") : mustKeepAsset ? t("navAtLeastOneAsset") : undefined,
		};
	});
	function changeVisibility(id: string, visible: boolean) {
		if (id === "overview" || !SIDEBAR_IDS.includes(id)) return;
		const next = normalizeHiddenNavIds(visible ? hiddenIds.filter((item) => item !== id) : [...hiddenIds, id]);
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
	const additionalNavigation = <>
					<div className="sidebar-custom">
						<div className="sidebar-section-label">{t("collectionsTitle")}</div>
						{collections.map((collection) => <Link key={collection.id} to="/collections/$id" params={{ id: collection.id }} className="sidebar-category sidebar-collection" aria-current={collectionDetailId === collection.id ? "page" : undefined} onClick={() => setMobile(false)} title={collection.name}><span>{collection.name}</span></Link>)}
						{customCategories.map((category) => <button type="button" key={category.id} className="sidebar-category" onClick={() => { if(category.scope === 'catalog'||category.kind==='project'){setMobile(false);void navigate({to:'/assets/category/$categoryId',params:{categoryId:category.id}});}else selectCategory(category.kind, category.name, category.id); }} title={catalogCategoryLabel(category,t)}><span>{catalogCategoryLabel(category,t)}</span></button>)}
						<Link to="/collections" className="sidebar-customize" aria-current={/^\/collections\/?$/.test(pathname) ? "page" : undefined} onClick={() => setMobile(false)}><Plus size={15}/>{t("customizeSidebar")}</Link>
					</div>
					<div className="side-bottom">
						<Link to="/trash" className="sidebar-trash sidebar-customize" aria-current={pathname === "/trash" ? "page" : undefined} onClick={() => setMobile(false)}><Trash2 size={15}/>{t("trash")}</Link>
                      <Link to="/backup" className="sidebar-customize" onClick={() => setMobile(false)}><Plus size={15}/>{t("backupAndRestore")}</Link>
                      <Link to="/settings" className="sidebar-customize" onClick={() => setMobile(false)}><Settings size={15}/>{t("settings")}</Link>
					</div>
	</>;
	return (
		<AppContext.Provider value={context}>
			<PasswordVaultProvider>
			<McpRuntimeProvider assets={liveAssets(data)}>
			<div className="shell">
				<aside
					className="sidebar"
				>
					<div className="brand">
						<span className="brand-mark" aria-hidden="true">K</span>
						<div>
							<strong>{t("brandName")}</strong>
							<small>{t("workspaceTagline")}</small>
						</div>
					</div>

					<div className="sidebar-section-label">{t("workspaceSection")}</div>
					<nav className="nav" aria-label={t("navigation")}>
						<SortableNav
							items={orderedNavigation.filter((item) => item.visible && item.id !== "tasks")}
							activePath={pathname}
							manageMode={false}
							onOrderChange={changeOrder}
							onVisibilityChange={changeVisibility}
							onNavigate={() => setMobile(false)}
						/>
					</nav>
					{additionalNavigation}
				</aside>
				<div className="main">
					<div className="shell-toolbar">
						<header className="topbar">
							{unifiedDetailReturn ? (
								<TopbarBackLink {...unifiedDetailReturn} onClick={() => sessionStorage.removeItem("keepany-detail-account-return")}>{t("back")}</TopbarBackLink>
							) : catalogReturn ? (
								<TopbarBackLink
									to={catalogReturn.categoryId ? "/assets/category/$categoryId" : catalogReturn.wallet ? "/cards" : "/assets"}
									params={catalogReturn.categoryId ? { categoryId: catalogReturn.categoryId } : {}}
								>{t("back")}</TopbarBackLink>
							) : privateAccountDetail || (detailKind === "account" && !hasRelationReturn && !workspaceReturn) ? (
								<TopbarBackLink to="/accounts" hash="">{t("accountBack")}</TopbarBackLink>
							) : detailKind && workspaceReturn ? (
								<TopbarBackLink
									to={workspaceReturn.view === "wallet" ? "/cards" : workspaceReturn.view !== "all" ? "/assets/$kind" : "/assets"}
									params={workspaceReturn.view !== "all" && workspaceReturn.view !== "wallet" ? { kind: workspaceReturn.view } : {}}
								>{t("back")}</TopbarBackLink>
							) : detailKind ? (
								<TopbarBackLink
									to="/assets/$kind"
									params={{ kind: detailReturnKind ?? detailKind }}
									onClick={hasRelationReturn ? () => {
										sessionStorage.removeItem("keepany-relation-return-id");
										sessionStorage.removeItem("keepany-relation-return-kind");
									} : undefined}
								>{t("back")}</TopbarBackLink>
							) : workflowProjectId ? (
								<TopbarBackLink to="/assets/$kind/$id" params={{ kind: "project", id: workflowProjectId }}>{t("workflowBackToProject")}</TopbarBackLink>
							) : collectionDetailId ? (
								<TopbarBackLink to="/collections">{t("collectionBack")}</TopbarBackLink>
							) : pathname !== "/" ? (
								<TopbarBackLink to="/" className="topbar-overview-link">{t("backToOverview")}</TopbarBackLink>
							) : <strong className="topbar-page-label">{currentHeading}</strong>}
							<div className="topbar-spacer"/>
							<button ref={topSearchTriggerRef} className="top-search top-search-trigger" type="button" aria-label={t("globalSearch")} aria-expanded={searchOpen} onClick={() => { if (searchOpen) { setSearchOpen(false); setSearch(""); } else { setSearchOpen(true); window.requestAnimationFrame(() => topSearchInputRef.current?.focus()); } }}><Search size={17} /><span>{t("globalSearch")}</span>
								<kbd>⌘ K</kbd>
							</button>
							<div className="top-actions">
								<ReminderCenter feedback={toast} onOpenChange={setRemindersOpen} />
								<DropdownMenu><DropdownMenuTrigger render={<Button className="top-icon-button" aria-label={t("assistantMenu")} />}><Sparkles size={17}/></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setAi(true)}>{t("settingsAskAssistant")}</DropdownMenuItem><DropdownMenuItem render={<Link to="/intake" hash="ai" />}>{t("aiCaptureTab")}</DropdownMenuItem><DropdownMenuItem render={<Link to="/assistant-access" />}>{t("settingsAssistantAccess")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
							<DropdownMenu><DropdownMenuTrigger render={<Button className="top-icon-button" aria-label={t("globalAddRecord")} />}><Plus size={18}/></DropdownMenuTrigger><DropdownMenuContent align="end">
								<DropdownMenuItem render={<Link to="/accounts" hash="new-account" />}>{t("newAccountKind")}</DropdownMenuItem>
								{(["project", "item", "subscription"] as const).map(kind => <DropdownMenuItem key={kind} render={kind === "project" ? <Link to="/assets" hash="new" /> : <Link to="/assets/$kind" params={{ kind }} hash="new" />}>{t(({ project: "catalogRecords", item: "newItemKind", subscription: "newSubscriptionKind" })[kind])}</DropdownMenuItem>)}
								<DropdownMenuItem render={<Link to="/cards" hash="new" />}>{t('walletNew')}</DropdownMenuItem>
								<DropdownMenuItem render={<Link to="/intake" />}>{t("intake")}</DropdownMenuItem>
								<DropdownMenuItem render={<Link to="/intake" hash="ai" />}>{t("aiCaptureTab")}</DropdownMenuItem>
							</DropdownMenuContent></DropdownMenu>
							</div>
						</header>
						{pathname === "/accounts" && !privateAccountDetail && <div ref={setAccountToolbarTarget} hidden={data.loading} />}
						{searchOpen && <div className="top-search-panel" ref={topSearchPanelRef} onBlur={(event) => {
							const target = event.relatedTarget;
							if (target && !event.currentTarget.contains(target) && target !== topSearchTriggerRef.current) closeSearch();
						}}>
							<label htmlFor="top-search-query">{t("globalSearch")}</label>
							<div className="top-search-panel-input"><Input id="top-search-query" ref={topSearchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("globalSearchHint")} autoComplete="off" /><button type="button" onClick={() => closeSearch()} aria-label={t("close")}><X size={17}/></button></div>
							<div className="search-results">{matches.length ? matches.map((result) => {
								const content = <><span className="global-search-result-text"><strong>{result.title}</strong><small>{result.secondary}</small></span><small className="global-search-result-source">{searchLabels.sources[result.source]}</small></>;
								const target = result.target;
								if (target.type === "asset") {
									if(data.assets.some(a=>a.id===target.assetId && !!a.walletCard))return <Link key={result.key} to="/records/$id" params={{id:`asset:${target.assetId}`}} onClick={()=>{let categoryId:string|null=null;try{categoryId=/^\/assets\/category\/([^/]+)/.exec(pathname)?.[1] ?? null;categoryId=categoryId?decodeURIComponent(categoryId):null;}catch{/* Unknown category falls back to wallet. */}sessionStorage.setItem('keepany-catalog-record-return',JSON.stringify({recordId:`asset:${target.assetId}`,categoryId,wallet:pathname!=='/assets'&&!categoryId}));closeSearch();}}>{content}</Link>;
									return <Link key={result.key} to="/assets/$kind/$id" params={{ kind: target.kind, id: target.assetId }} onClick={() => closeSearch()}>{content}</Link>;
								}
								if (target.type === "task") return <button type="button" className="reminder-search-result" key={result.key} onClick={() => { closeSearch(); openReminderCenter({ taskId: target.taskId }); }}>{content}</button>;
								const hash = target.type === "finance" ? `finance-entry-${target.historyId}` : target.type === "intake" ? `intake-review-${target.candidateId}` : "";
								return <Link key={result.key} to={target.type === "finance" ? "/assets" : "/intake"} hash={hash} onClick={() => closeSearch(hash)}>{content}</Link>;
							}) : <p>{t("none")}</p>}</div>
							<button type="button" className="top-search-panel-close" onClick={() => { setSearchOpen(false); setSearch(""); }}>{t("close")}</button>
						</div>}
					</div>
					<ReminderRuntime hideBanner />
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

            <nav className="mobile-nav" aria-label={t("navigation")}>
                {orderedNavigation.filter(item => item.visible).map(item => {
                    const active = item.id === "overview" ? pathname === "/" : item.active;
                    const Icon = item.icon;
                    return <Link key={item.id} to={item.to} activeOptions={{ exact: true }}
                        aria-current={active ? "page" : undefined} onClick={() => setMobile(false)}>
                        <Icon size={18}/><span>{item.label}</span>
                    </Link>;
                })}
                <button type="button" id="mobile-more-trigger" aria-haspopup="dialog" aria-expanded={mobile}
                    aria-current={!workspacePathGroup(pathname) && pathname !== "/" ? "page" : undefined}
                    onClick={() => { setSearchOpen(false); setMobile(true); }}>
                    <Ellipsis size={18}/><span>{t("mobileMore")}</span>
                </button>
            </nav>
            {mobile && <Dialog title={t("mobileMore")} className="mobile-more-dialog" onClose={() => setMobile(false)}
                returnFocusTo={() => topSearchInputRef.current ?? document.getElementById("mobile-more-trigger")}>
                {additionalNavigation}
            </Dialog>}

			{data.error && !remindersOpen && (
				<div className="toast error" role="alert">
					{t("error")}
				</div>
			)}
			{toast && !remindersOpen && (feedbackTarget ? createPortal(<div className="compact-account-feedback-message" role="status">{toast}</div>, feedbackTarget) : (
				<div className="toast" role="status">
					{toast}
				</div>
			))}
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
			</PasswordVaultProvider>
		</AppContext.Provider>
	);
}

