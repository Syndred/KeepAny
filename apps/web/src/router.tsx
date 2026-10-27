import {
	createRootRoute,
	createRoute,
	createRouter,
	lazyRouteComponent,
} from "@tanstack/react-router";
import { AppShell } from "./AppShell";

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: lazyRouteComponent(() => import("./page-overview"), "Overview"),
});
const taskRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tasks",
	component: lazyRouteComponent(() => import("./page-tasks"), "TaskPage"),
});
export const listRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets/$kind",
	component: lazyRouteComponent(() => import("./page-workspaces"), "WorkspaceLegacyRoute"),
});
const assetsWorkspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets",
	component: lazyRouteComponent(() => import("./page-workspaces"), "AssetsWorkspace"),
});
const accountsWorkspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/accounts",
	component: lazyRouteComponent(() => import("./page-workspaces"), "AccountsWorkspace"),
});
export const detailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets/$kind/$id",
	component: lazyRouteComponent(
		() => import("./page-asset-detail"),
		"AssetDetail",
	),
});
const projectWorkflowRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets/project/$id/workflow/$flow",
	component: lazyRouteComponent(() => import("./page-project-workflow"), "ProjectWorkflowPage"),
});
const changeImpactRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/change-impact",
	component: lazyRouteComponent(() => import("./page-change-impact"), "ChangeImpactPage"),
});
const assistantAccessRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assistant-access",
	component: lazyRouteComponent(() => import("./page-assistant-access"), "AssistantAccessPage"),
});
const collectionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/collections",
	component: lazyRouteComponent(() => import("./page-collections"), "CollectionsPage"),
});
const collectionDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/collections/$id",
	component: lazyRouteComponent(() => import("./page-collections"), "CollectionsPage"),
});
const financeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/finance",
	component: lazyRouteComponent(() => import("./page-workspaces"), "FinanceWorkspaceRoute"),
});
const intakeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/intake",
	component: lazyRouteComponent(() => import("./page-intake"), "IntakePage"),
});
const trashRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/trash",
	component: lazyRouteComponent(() => import("./page-trash"), "TrashPage"),
});
const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: lazyRouteComponent(
		() => import("./page-settings"),
		"SettingsPage",
	),
});
const moreRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/more",
	component: lazyRouteComponent(() => import("./MobileMorePage"), "MobileMorePage"),
});
const routeTree = rootRoute.addChildren([
	indexRoute,
	taskRoute,
	listRoute,
	assetsWorkspaceRoute,
	accountsWorkspaceRoute,
	detailRoute,
	projectWorkflowRoute,
	changeImpactRoute,
	assistantAccessRoute,
	collectionsRoute,
	collectionDetailRoute,
	financeRoute,
	intakeRoute,
	trashRoute,
	settingsRoute,
	moreRoute,
]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
