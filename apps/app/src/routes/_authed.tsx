import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { AppShell } from "../components/app-shell.tsx";
import { Landing } from "../components/landing.tsx";
import { rejectsSession } from "../components/route-error.tsx";
import { useIdentify } from "../lib/analytics.tsx";
import { AppearanceProvider } from "../lib/appearance.tsx";
import { authClient } from "../lib/auth-client.ts";
import { forgetSession } from "../lib/auth-server.ts";
import { inDesktopShell } from "../lib/desktop-shell.ts";
import { LeaveProvider, useLeaveState } from "../lib/leave.tsx";
import { ModelPickerProvider } from "../lib/model-picker.tsx";
import { signedOutPage } from "../lib/signed-out.ts";
import { UIProvider } from "../lib/ui.tsx";
import { WorkspaceProvider } from "../lib/workspace.tsx";

export const Route = createFileRoute("/_authed")({
	staticData: { themed: true },
	beforeLoad: ({ context, location }) => {
		if (
			context.auth.source === "server" &&
			context.auth.token === null &&
			signedOutPage(location.pathname, context.auth.desktop) === "login"
		) {
			throw redirect({ to: "/login" });
		}
	},
	loader: async ({ context }) => {
		if (context.auth.source === "browser" || context.auth.token === null)
			return;
		try {
			await Promise.all([
				context.queryClient.ensureQueryData(convexQuery(api.users.me, {})),
				context.queryClient.ensureQueryData(
					convexQuery(api.workspaces.list, {}),
				),
			]);
		} catch (error) {
			if (!rejectsSession(error)) throw error;
			forgetSession();
			throw redirect({ to: "/login" });
		}
	},
	component: AuthedLayout,
});

function Identify() {
	const { data } = useQuery(convexQuery(api.users.me, {}));
	useIdentify(data);
	return null;
}

function LoadLogin() {
	useEffect(() => {
		window.location.replace("/login");
	}, []);
	return null;
}

function AuthedLayout() {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const departure = useLeaveState();
	const { pathname } = useLocation();

	if (isLoading) return null;
	if (!isAuthenticated)
		return signedOutPage(pathname, inDesktopShell()) === "landing" ? (
			<Landing />
		) : (
			<LoadLogin />
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
