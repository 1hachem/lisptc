import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Navigate,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { AppShell } from "../components/app-shell.tsx";
import { AppearanceProvider } from "../lib/appearance.tsx";
import { authClient } from "../lib/auth-client.ts";
import { ModelPickerProvider } from "../lib/model-picker.tsx";
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
	const [leaving, setLeaving] = useState(false);
	const queryClient = useQueryClient();

	if (isLoading) return null;
	if (!isAuthenticated) return <Navigate to="/login" replace />;
	if (leaving) return null;

	return (
		<WorkspaceProvider>
			<ModelPickerProvider>
				<AppearanceProvider>
					<UIProvider>
						<AppShell
							onSignOut={async () => {
								flushSync(() => setLeaving(true));
								queryClient.removeQueries();
								try {
									await authClient.signOut();
								} catch (failure) {
									setLeaving(false);
									throw failure;
								}
							}}
						>
							<Outlet />
						</AppShell>
					</UIProvider>
				</AppearanceProvider>
			</ModelPickerProvider>
		</WorkspaceProvider>
	);
}
