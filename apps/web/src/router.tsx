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
	component: lazyRouteComponent(() => import("./page-asset-list"), "AssetList"),
});
export const detailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets/$kind/$id",
	component: lazyRouteComponent(
		() => import("./page-asset-detail"),
		"AssetDetail",
	),
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
const routeTree = rootRoute.addChildren([
	indexRoute,
	taskRoute,
	listRoute,
	detailRoute,
	intakeRoute,
	trashRoute,
	settingsRoute,
]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
