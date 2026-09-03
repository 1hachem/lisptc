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
			/*
			 * The bot's face, drawn from the same engine as the avatar at the foot of
			 * the transcript: `scripts/favicon.ts` writes both files, and is the thing
			 * to run when the shape or the resting expression changes.
			 *
			 * Both formats: Safari still won't take an SVG icon, and `/favicon.ico` is
			 * fetched by convention whether or not it is declared. Where the SVG is
			 * taken it wins on merit — a browser that prefers it is one that rasterises
			 * it at exactly the size it needs.
			 *
			 * These two are the icon the page LOADS with, and the one it falls back to:
			 * `<AnimatedFavicon/>` takes the links over once it is mounted, and puts
			 * them back if anything about that fails.
			 */
			{ rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "stylesheet", href: appCss },
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300..700;1,400&display=swap",
			},
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
						{/*
						 * Inside the chat session, because what the agent is DOING is derived
						 * from the run; everything that reads the agent — the avatar, the tab
						 * icon — is inside this.
						 */}
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
		<html lang="en" data-theme="gruvbox" suppressHydrationWarning>
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
