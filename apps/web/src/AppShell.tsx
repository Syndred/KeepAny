import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	ArrowRight,
	Bell,
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
import { useData } from "./data";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
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
export function AppShell() {
	const data = useData();
	const { t } = useTranslation();
	const [search, setSearch] = useState(
		() => sessionStorage.getItem("keepany-search") || "",
	);
	const [searchOpen, setSearchOpen] = useState(false);
	const topSearchRef = useRef<HTMLDivElement>(null);
	const topSearchInputRef = useRef<HTMLInputElement>(null);
	const [toast, setToast] = useState("");
	const [ai, setAi] = useState(false);
	const [aiMenu, setAiMenu] = useState(false);
	const aiMenuRef = useRef<HTMLDivElement>(null);
	const [impactPicker, setImpactPicker] = useState(false);
	const [manageNav, setManageNav] = useState(false);
	const [mobile, setMobile] = useState(false);
	const [pendingNavOrder, setPendingNavOrder] = useState<string[] | null>(null);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const navigate = useNavigate();
	useEffect(() => {
		if (pathname) { setSearchOpen(false); setAiMenu(false); setMobile(false); }
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
				topSearchInputRef.current?.focus();
				setSearchOpen(true);
			} else if (event.key === "Escape") {
				setSearchOpen(false);
				setAiMenu(false);
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
			to: `/assets/${kind}`,
			label: t(kind),
			icon: icons[kind],
		})),
	];
	const customCategories = data.categories.filter((category) => !category.deleted);
	const accounts = liveAssets(data).filter((asset) => asset.kind === "account");
	const currentKind = kinds.find((kind) => pathname.startsWith(`/assets/${kind}`));
	const currentHeading = pathname === "/" ? t("overview") : currentKind ? t(currentKind) :
		pathname === "/tasks" ? t("tasks") : pathname === "/intake" ? t("intake") :
		pathname === "/trash" ? t("trash") : t("settings");
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
	useEffect(() => {
		if (
			pendingNavOrder &&
			Array.isArray(savedNavOrder) &&
			pendingNavOrder.join("\u0000") === savedNavOrder.join("\u0000")
		)
			setPendingNavOrder(null);
	}, [pendingNavOrder, savedNavOrder]);
	const orderedNavigation = [...navigation].sort((a, b) => {
		const ai = navOrder.indexOf(a.id),
			bi = navOrder.indexOf(b.id);
		return (
			(ai < 0 ? navigation.length : ai) - (bi < 0 ? navigation.length : bi)
		);
	});
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
					<div className="workspace-current"><span className="workspace-avatar"><UserRound size={15}/></span><strong>{t("personalWorkspace")}</strong></div>
					<div className="sidebar-section-label">{t("workspaceSection")}</div>
					<nav className="nav" aria-label={t("navigation")}>
						<SortableNav
							items={orderedNavigation}
							activePath={pathname}
							manageMode={manageNav}
							onOrderChange={(ids) => {
								setPendingNavOrder(ids);
								void save("preference", {
									id: "sidebarOrder",
									value: ids,
								}).catch(() => {
									setPendingNavOrder(null);
									setToast(t("error"));
								});
							}}
							onNavigate={() => setMobile(false)}
						/>
					</nav>
					<div className="sidebar-custom">
						<div className="sidebar-section-label">{t("myCategories")}</div>
						{customCategories.map((category) => <button type="button" key={category.id} className="sidebar-category" onClick={() => selectCategory(category.kind, category.name)}>{category.name}</button>)}
						<button type="button" className="sidebar-customize" aria-pressed={manageNav} onClick={() => setManageNav((value) => !value)}><Plus size={15}/>{manageNav ? t("finishNavOrder") : t("customizeSidebar")}</button>
					</div>
					<div className="side-bottom">
						<Link to="/intake" onClick={() => setMobile(false)}><Plus size={18}/>{t("intake")}</Link>
						<Link to="/trash" onClick={() => setMobile(false)}><Trash2 size={18}/>{t("trash")}</Link>
						<Link to="/settings" onClick={() => setMobile(false)}>
							<Settings size={18} />
							{t("settings")}
						</Link>
						<div className="sidebar-user"><span>{t("meInitial")}</span><div><strong>{t("myWorkspace")}</strong><small>{t("privateWorkspace")}</small></div></div>
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
						<strong className="topbar-page-label">{currentHeading}</strong>
						<div className="topbar-spacer"/>
						<div className="top-search" ref={topSearchRef} onClick={() => topSearchInputRef.current?.focus()}>
							<Search size={17} />
							<input
								ref={topSearchInputRef}
								value={search}
								onFocus={() => setSearchOpen(true)}
								onBlur={(event) => {
								if (!topSearchRef.current?.contains(event.relatedTarget)) setSearchOpen(false);
								}}
								onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
								placeholder={t("search")}
								aria-label={t("search")}
							/>
							<kbd>⌘ K</kbd>
							{search && (
								<Button
									variant="ghost"
									size="icon"
									onClick={() => setSearch("")}
									aria-label={t("close")}
								>
									<X size={15} />
								</Button>
							)}
							{searchOpen && matches.length > 0 && (
								<div className="search-results">
									{matches.map((asset) => (
										<Link
											key={asset.id}
											to="/assets/$kind/$id"
											params={{ kind: asset.kind, id: asset.id }}
											onClick={() => { setSearch(""); setSearchOpen(false); }}
										>
											<strong>{asset.name}</strong>
											<small>{t(asset.kind)}</small>
										</Link>
									))}
								</div>
							)}
						</div>
						<div className="top-actions">
							<Link to="/tasks" className="top-icon-button" aria-label={t("taskReminders")}><Bell size={17}/>{openTasks > 0 && <i aria-hidden="true"/>}</Link>
							<div className="top-ai-wrap" ref={aiMenuRef}>
								<Button className="top-icon-button" variant="ghost" aria-label={t("assistantMenu")} aria-expanded={aiMenu} onClick={() => setAiMenu((value) => !value)}><Sparkles size={17}/></Button>
								{aiMenu && <div className="top-ai-menu"><button type="button" onClick={() => { setAiMenu(false); setImpactPicker(true); }}>{t("checkChangeImpact")}</button><Link to="/settings" hash="assistant" onClick={() => setAiMenu(false)}>{t("settingsAssistantAccess")}</Link></div>}
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
			{impactPicker && <Dialog title={t("checkChangeImpact")} onClose={() => setImpactPicker(false)}>
				<p className="subtitle">{t("chooseAccountImpact")}</p>
				<div className="list">{accounts.length ? accounts.map((account) => <Link key={account.id} className="list-row" to="/assets/$kind/$id" params={{ kind: "account", id: account.id }} onClick={() => setImpactPicker(false)}><strong>{account.name}</strong><ArrowRight size={16}/></Link>) : <Link className="button" to="/assets/$kind" params={{ kind: "account" }} onClick={() => setImpactPicker(false)}>{t("add")} {t("account")}</Link>}</div>
			</Dialog>}
			</McpRuntimeProvider>
		</AppContext.Provider>
	);
}
