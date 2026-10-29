import type { AnyRouter } from "@tanstack/react-router";

const APP_ROUTE_IDS = [
	"/_authed",
	"/_authed/",
	"/_authed/$workspaceId",
	"/_authed/$workspaceId/",
] as const;

export function landInApp(location: Pick<Location, "replace">): void {
	location.replace("/");
}

function loadAppChunks(router: AnyRouter): void {
	for (const id of APP_ROUTE_IDS) {
		const route = router.routesById[id];
		if (route !== undefined) void router.loadRouteChunk(route)?.catch(() => {});
	}
}

export function preloadAppChunks(
	router: AnyRouter,
	when: "now" | "idle",
): void {
	if (when === "now" || typeof requestIdleCallback !== "function") {
		loadAppChunks(router);
		return;
	}
	requestIdleCallback(() => loadAppChunks(router), { timeout: 3000 });
}
