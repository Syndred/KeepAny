import {
	createRootRoute,
	createRoute,
	createRouter,
	lazyRouteComponent,
 redirect,
} from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { RouteLoadError } from "./RouteLoadError";

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: lazyRouteComponent(() => import("./page-overview"), "Overview"),
});
const taskRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tasks",
	beforeLoad: ({ location }) => {
  const oldHash = location.hash.replace(/^#/, "");
  let taskId = oldHash.startsWith("task-") ? oldHash.slice(5) : "";
  try { taskId = decodeURIComponent(taskId); } catch { taskId = ""; }
  throw redirect({ to: "/", hash: taskId ? `reminder-task-${encodeURIComponent(taskId)}` : "reminders", replace: true });
 },
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
const categoryWorkspaceRoute=createRoute({getParentRoute:()=>rootRoute,path:'/assets/category/$categoryId',component:lazyRouteComponent(()=>import('./page-workspaces'),'CategoryWorkspaceRoute')});
const catalogRecordRoute=createRoute({getParentRoute:()=>rootRoute,path:'/records/$id',component:lazyRouteComponent(()=>import('./page-catalog-record'),'CatalogRecordPage')});
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
	beforeLoad: () => { throw redirect({ to: "/accounts", replace: true }); },
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
const cardsWorkspaceRoute = createRoute({getParentRoute:()=>rootRoute,path:'/cards',component:lazyRouteComponent(()=>import('./page-workspaces'),'CardsWorkspaceRoute')});
const financeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/finance",
 beforeLoad: () => { throw redirect({to:'/assets',replace:true}); },
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
const backupRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/backup",
	component: lazyRouteComponent(() => import("./page-intake"), "BackupPage"),
});
const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: lazyRouteComponent(
		() => import("./page-settings"),
		"SettingsPage",
	),
});
const routeTree = rootRoute.addChildren([
	indexRoute,
	taskRoute,
	listRoute,
	assetsWorkspaceRoute,
	accountsWorkspaceRoute,
 categoryWorkspaceRoute,
 catalogRecordRoute,
	detailRoute,
	projectWorkflowRoute,
	changeImpactRoute,
	assistantAccessRoute,
	collectionsRoute,
	collectionDetailRoute,
	financeRoute,
 cardsWorkspaceRoute,
	intakeRoute,
	backupRoute,
	trashRoute,
	settingsRoute,
]);
export const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	defaultErrorComponent: RouteLoadError,
});
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
