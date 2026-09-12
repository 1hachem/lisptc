import { defaultThemeId, fontLinks } from "@repo/ui";
import appCss from "@repo/ui/styles/app.css?url";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { AnimatedFavicon } from "../components/animated-favicon.tsx";
import { AppShell } from "../components/app-shell.tsx";
import { AgentProvider } from "../lib/agent.tsx";
import { Analytics } from "../lib/analytics.tsx";
import { ChatProvider } from "../lib/chat.tsx";
import { UIProvider } from "../lib/ui.tsx";

export interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
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
	return (
		<RootDocument>
			<Analytics>
				<UIProvider>
					<ChatProvider>
						<AgentProvider>
							<AnimatedFavicon />
							<AppShell>
								<Outlet />
							</AppShell>
						</AgentProvider>
					</ChatProvider>
				</UIProvider>
			</Analytics>
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
