import {
	createRootRoute,
	createRoute,
	createRouter,
} from "@tanstack/react-router";
import {
	AppShell,
	Overview,
	TaskPage,
	AssetList,
	AssetDetail,
	IntakePage,
	TrashPage,
	SettingsPage,
} from "./views";

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: Overview,
});
const taskRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tasks",
	component: TaskPage,
});
export const listRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets/$kind",
	component: AssetList,
});
export const detailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets/$kind/$id",
	component: AssetDetail,
});
const intakeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/intake",
	component: IntakePage,
});
const trashRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/trash",
	component: TrashPage,
});
const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
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
