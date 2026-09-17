import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Navigate,
	Outlet,
	useNavigate,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { AppShell } from "../components/app-shell.tsx";
import { authClient } from "../lib/auth-client.ts";
import { UIProvider } from "../lib/ui.tsx";
import { WorkspaceProvider } from "../lib/workspace.tsx";

export const Route = createFileRoute("/_authed")({
	loader: async ({ context }) => {
		if (!context.token) return;
		await context.queryClient.ensureQueryData(convexQuery(api.users.me, {}));
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const { data: user } = useQuery(
		convexQuery(api.users.me, isAuthenticated ? {} : "skip"),
	);
	const navigate = useNavigate();

	if (isLoading) return <Waiting />;
	if (!isAuthenticated) return <Navigate to="/login" replace />;
	if (!user) return <Waiting />;

	return (
		<WorkspaceProvider>
			<UIProvider>
				<AppShell
					onSignOut={async () => {
						await authClient.signOut();
						await navigate({ to: "/login", replace: true });
					}}
					user={{ name: user.name, email: user.email }}
				>
					<Outlet />
				</AppShell>
			</UIProvider>
		</WorkspaceProvider>
	);
}

function Waiting() {
	return (
		<div className="flex h-full items-center justify-center bg-bg font-mono text-[13px] text-dim">
			…
		</div>
	);
}
