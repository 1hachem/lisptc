import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import {
	createFileRoute,
	Navigate,
	Outlet,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { AppShell } from "../components/app-shell.tsx";
import { authClient } from "../lib/auth-client.ts";
import { UIProvider } from "../lib/ui.tsx";
import { WorkspaceProvider } from "../lib/workspace.tsx";

export const Route = createFileRoute("/_authed")({
	beforeLoad: ({ context }) => {
		if (context.auth.source === "server" && context.auth.token === null) {
			throw redirect({ to: "/login" });
		}
	},
	loader: async ({ context }) => {
		if (context.auth.source === "browser") return;
		await Promise.all([
			context.queryClient.ensureQueryData(convexQuery(api.users.me, {})),
			context.queryClient.ensureQueryData(convexQuery(api.workspaces.list, {})),
		]);
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const navigate = useNavigate();

	if (!isAuthenticated && !isLoading) return <Navigate to="/login" replace />;

	return (
		<WorkspaceProvider>
			<UIProvider>
				<AppShell
					onSignOut={async () => {
						await authClient.signOut();
						await navigate({ to: "/login", replace: true });
					}}
				>
					<Outlet />
				</AppShell>
			</UIProvider>
		</WorkspaceProvider>
	);
}
