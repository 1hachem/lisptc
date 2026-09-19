import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { defaultThemeId, fontLinks } from "@repo/ui";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
	useRouteContext,
} from "@tanstack/react-router";
import { Analytics } from "../lib/analytics.tsx";
import { providerClient } from "../lib/auth-client.ts";
import { ssrAuth } from "../lib/auth-server.ts";
import appCss from "../styles/app.css?url";

export interface RouterContext {
	queryClient: QueryClient;
	convexQueryClient: ConvexQueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async ({ context }) => {
		const auth = await ssrAuth();
		if (auth.source === "server" && auth.token !== null) {
			context.convexQueryClient.serverHttpClient?.setAuth(auth.token);
		}
		return { auth };
	},
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "ptc agent" },
		],
		links: [
			{ rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "stylesheet", href: appCss },
			...fontLinks,
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	const { queryClient, convexQueryClient, auth } = useRouteContext({
		from: Route.id,
	});

	return (
		<RootDocument>
			<ConvexBetterAuthProvider
				client={convexQueryClient.convexClient}
				authClient={providerClient}
				initialToken={
					auth.source === "server" ? (auth.token ?? undefined) : undefined
				}
			>
				<QueryClientProvider client={queryClient}>
					<Analytics>
						<Outlet />
					</Analytics>
				</QueryClientProvider>
			</ConvexBetterAuthProvider>
		</RootDocument>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme={defaultThemeId} suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
