import {
	createFileRoute,
	Navigate,
	Outlet,
	useNavigate,
} from "@tanstack/react-router";
import { AppShell } from "../components/app-shell.tsx";
import { authClient } from "../lib/auth-client.ts";
import { UIProvider } from "../lib/ui.tsx";
import { WorkspaceProvider } from "../lib/workspace.tsx";

export const Route = createFileRoute("/_authed")({
	component: AuthedLayout,
});

function AuthedLayout() {
	const { data: session, isPending } = authClient.useSession();
	const navigate = useNavigate();

	if (isPending) return <Waiting />;
	if (!session) return <Navigate to="/login" replace />;

	return (
		<WorkspaceProvider>
			<UIProvider>
				<AppShell
					onSignOut={async () => {
						await authClient.signOut();
						await navigate({ to: "/login", replace: true });
					}}
					user={{ name: session.user.name, email: session.user.email }}
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
