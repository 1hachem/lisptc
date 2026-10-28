import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { type ConvexQueryClient, convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { fontLinks } from "@repo/ui";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
	useMatches,
	useParams,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import { rejectsSession } from "../components/route-error.tsx";
import { Analytics } from "../lib/analytics.tsx";
import { providerClient } from "../lib/auth-client.ts";
import { forgetSession, ssrAuth } from "../lib/auth-server.ts";
import { preferencesQuery, useCachedPreferences } from "../lib/preferences.ts";
import { fontOf, themeOf } from "../lib/resolved-preferences.ts";
import { useCachedWorkspace } from "../lib/workspace.tsx";
import appCss from "../styles/app.css?url";

interface RouterContext {
	queryClient: QueryClient;
	convexQueryClient: ConvexQueryClient;
}

async function accountExists(queryClient: QueryClient): Promise<boolean> {
	try {
		await queryClient.ensureQueryData(convexQuery(api.users.me, {}));
		return true;
	} catch (error) {
		if (rejectsSession(error)) return false;
		throw error;
	}
}

export const Route = createRootRouteWithContext<RouterContext>()({
	beforeLoad: async ({ context }) => {
		const auth = await ssrAuth();
		if (auth.source === "server" && auth.token !== null) {
			context.convexQueryClient.serverHttpClient?.setAuth(auth.token);
			if (!(await accountExists(context.queryClient))) {
				context.convexQueryClient.serverHttpClient?.clearAuth();
				forgetSession();
				return { auth: { source: "server" as const, token: null } };
			}
		}
		return { auth };
	},
	loader: async ({ context }) => {
		if (context.auth.source !== "server" || context.auth.token === null) return;
		await context.queryClient.ensureQueryData(preferencesQuery);
	},
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "salsal" },
			{ name: "description", content: "malleable AI agents workspaces" },
		],
		links: [
			{ rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "stylesheet", href: appCss },
			...fontLinks,
		],
	}),
	shellComponent: RootDocument,
	component: RootComponent,
});

function RootComponent() {
	const { queryClient, convexQueryClient, auth } = useRouteContext({
		from: Route.id,
	});

	return (
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
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const { queryClient } = useRouter().options.context;
	const themed = useMatches({
		select: (matches) => matches.some((match) => match.staticData.themed),
	});
	const inRoute = useParams({ strict: false }).workspaceId;
	const cached = useCachedPreferences(queryClient);
	const workspace = useCachedWorkspace(queryClient, inRoute);
	const theme = themeOf(themed ? (workspace ?? undefined) : undefined);
	const font = fontOf(themed ? cached : undefined);

	return (
		<html
			lang="en"
			data-theme={theme}
			data-font={font}
			suppressHydrationWarning
		>
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
