import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
	Bell,
	CloudOff,
	LayoutDashboard,
	Menu,
	Plus,
	Search,
	Settings,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { save } from "../../../packages/local-db/src";
import { useData } from "./data";
import { Button } from "./components/ui/button";
import {
	SortableNav,
	type SortableNavItem,
} from "./components/navigation/SortableNav";
import { AppContext, icons, kinds, liveAssets } from "./view-shared";
import { McpRuntimeProvider } from "./mcp-runtime";
const AiDialog = lazy(() =>
	import("./workflows").then((module) => ({ default: module.AiDialog })),
);
export function AppShell() {
	const data = useData();
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const [toast, setToast] = useState("");
	const [ai, setAi] = useState(false);
	const [mobile, setMobile] = useState(false);
	const [narrow, setNarrow] = useState(
		() => window.matchMedia("(max-width: 760px)").matches,
	);
	const [pendingNavOrder, setPendingNavOrder] = useState<string[] | null>(null);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	useEffect(() => {
		const query = window.matchMedia("(max-width: 760px)");
		const update = () => setNarrow(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
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
		{ id: "intake", to: "/intake", label: t("intake"), icon: Plus },
		{ id: "trash", to: "/trash", label: t("trash"), icon: Trash2 },
	];
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
					inert={narrow && !mobile}
					aria-hidden={narrow && !mobile}
				>
					<div className="brand">
						<span className="brand-mark">K</span>
						<div>
							<strong>KeepAny</strong>
							<small>{t("offline")}</small>
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
					<nav className="nav" aria-label={t("navigation")}>
						<SortableNav
							items={orderedNavigation}
							activePath={pathname}
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
					<div className="side-bottom">
						<Link to="/settings" onClick={() => setMobile(false)}>
							<Settings size={18} />
							{t("settings")}
						</Link>
						<div className="side-status">
							<CloudOff size={15} />
							{t("local")}
						</div>
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
						<div className="top-search">
							<Search size={17} />
							<input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder={t("search")}
								aria-label={t("search")}
							/>
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
							{matches.length > 0 && (
								<div className="search-results">
									{matches.map((asset) => (
										<Link
											key={asset.id}
											to="/assets/$kind/$id"
											params={{ kind: asset.kind, id: asset.id }}
											onClick={() => setSearch("")}
										>
											<strong>{asset.name}</strong>
											<small>{t(asset.kind)}</small>
										</Link>
									))}
								</div>
							)}
						</div>
						<div className="top-actions">
							<Button variant="ghost" onClick={() => setAi(true)}>
								<Sparkles size={17} />
								<span>{t("assistant")}</span>
							</Button>
							<Link
								to="/intake"
								className="button primary"
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
			</McpRuntimeProvider>
		</AppContext.Provider>
	);
}
