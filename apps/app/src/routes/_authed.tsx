import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Navigate,
	Outlet,
	redirect,
	useLocation,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { AppShell } from "../components/app-shell.tsx";
import { Landing } from "../components/landing.tsx";
import { useIdentify } from "../lib/analytics.tsx";
import { AppearanceProvider } from "../lib/appearance.tsx";
import { authClient } from "../lib/auth-client.ts";
import { inDesktopShell } from "../lib/desktop-shell.ts";
import { LeaveProvider, useLeaveState } from "../lib/leave.tsx";
import { ModelPickerProvider } from "../lib/model-picker.tsx";
import { UIProvider } from "../lib/ui.tsx";
import { WorkspaceProvider } from "../lib/workspace.tsx";

export const Route = createFileRoute("/_authed")({
	staticData: { themed: true },
	beforeLoad: ({ context, location }) => {
		if (
			context.auth.source === "server" &&
			context.auth.token === null &&
			!isLanding(location.pathname)
		) {
			throw redirect({ to: "/login" });
		}
	},
	loader: async ({ context }) => {
		if (context.auth.source === "browser" || context.auth.token === null)
			return;
		await Promise.all([
			context.queryClient.ensureQueryData(convexQuery(api.users.me, {})),
			context.queryClient.ensureQueryData(convexQuery(api.workspaces.list, {})),
		]);
	},
	component: AuthedLayout,
});

function isLanding(pathname: string): boolean {
	return pathname === "/";
}

function Identify() {
	const { data } = useQuery(convexQuery(api.users.me, {}));
	useIdentify(data);
	return null;
}

function AuthedLayout() {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const departure = useLeaveState();
	const { pathname } = useLocation();

	if (isLoading) return null;
	if (!isAuthenticated)
		return isLanding(pathname) && !inDesktopShell() ? (
			<Landing />
		) : (
			<Navigate to="/login" replace />
		);
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
