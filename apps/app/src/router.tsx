import { ConvexQueryClient } from "@convex-dev/react-query";
import { webEnv } from "@repo/env/web";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { RouteError } from "./components/route-error.tsx";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const convexQueryClient = new ConvexQueryClient(webEnv.VITE_CONVEX_URL, {
		expectAuth: true,
	});
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				queryKeyHashFn: convexQueryClient.hashFn(),
				queryFn: convexQueryClient.queryFn(),
			},
		},
	});
	convexQueryClient.connect(queryClient);

	const router = createRouter({
		routeTree,
		context: { queryClient, convexQueryClient },
		defaultPreload: "intent",
		defaultErrorComponent: RouteError,
		scrollRestoration: true,
	});
	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
}
