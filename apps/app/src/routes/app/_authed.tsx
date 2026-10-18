import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Navigate,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { AppShell } from "../../components/app-shell.tsx";
import { useIdentify } from "../../lib/analytics.tsx";
import { AppearanceProvider } from "../../lib/appearance.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { LeaveProvider, useLeaveState } from "../../lib/leave.tsx";
import { ModelPickerProvider } from "../../lib/model-picker.tsx";
import { UIProvider } from "../../lib/ui.tsx";
import { WorkspaceProvider } from "../../lib/workspace.tsx";

export const Route = createFileRoute("/app/_authed")({
	staticData: { themed: true },
	beforeLoad: ({ context }) => {
		if (context.auth.source === "server" && context.auth.token === null) {
			throw redirect({ to: "/app/login" });
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

function Identify() {
	const { data } = useQuery(convexQuery(api.users.me, {}));
	useIdentify(data);
	return null;
}

function AuthedLayout() {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const departure = useLeaveState();

	if (isLoading) return null;
	if (!isAuthenticated) return <Navigate to="/app/login" replace />;
	if (departure.leaving) return null;

	return (
		<LeaveProvider value={departure}>
			<WorkspaceProvider>
				<ModelPickerProvider>
					<AppearanceProvider>
						<UIProvider>
							<AppShell
								onSignOut={() =>
									void departure.leave(async () => {
										await authClient.signOut();
									})
								}
							>
								<Identify />
								<Outlet />
							</AppShell>
						</UIProvider>
					</AppearanceProvider>
				</ModelPickerProvider>
			</WorkspaceProvider>
		</LeaveProvider>
	);
}
