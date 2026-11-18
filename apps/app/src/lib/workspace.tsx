import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Doc } from "@repo/backend/dataModel";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
	createContext,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";

const PICKED_KEY = "lisptc.workspace";

export type Workspace = Doc<"workspaces">;

export interface WorkspaceSelection {
	workspaces: Workspace[];
	workspace: Workspace | null;
}

const WorkspaceContext = createContext<WorkspaceSelection | null>(null);

function remembered(): string | null {
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage.getItem(PICKED_KEY);
	} catch {
		return null;
	}
}

const workspacesQuery = convexQuery(api.workspaces.list, {});

export function landingWorkspace(workspaces: Workspace[]): Workspace | null {
	return workspaces[0] ?? null;
}

function picked(
	workspaces: Workspace[],
	inRoute: string | undefined,
): Workspace | null {
	const wanted = inRoute ?? remembered();
	return (
		workspaces.find((candidate) => candidate._id === wanted) ??
		landingWorkspace(workspaces)
	);
}

export function useCachedWorkspace(
	queryClient: QueryClient,
	inRoute: string | undefined,
): Workspace | null {
	const workspaces = useSyncExternalStore(
		(onChange) => queryClient.getQueryCache().subscribe(onChange),
		() => queryClient.getQueryData<Workspace[]>(workspacesQuery.queryKey),
		() => queryClient.getQueryData<Workspace[]>(workspacesQuery.queryKey),
	);
	return picked(workspaces ?? [], inRoute);
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
	const { data, error } = useQuery(workspacesQuery);
	if (error) throw error;
	const workspaces = data ?? [];
	const inRoute = useParams({ strict: false }).workspaceId;

	const workspace = picked(workspaces, inRoute);
	const navigate = useNavigate();
	const misrouted =
		workspace !== null && workspace._id !== inRoute ? workspace._id : null;

	useEffect(() => {
		if (!workspace) return;
		try {
			localStorage.setItem(PICKED_KEY, workspace._id);
		} catch {}
	}, [workspace]);

	useEffect(() => {
		if (misrouted === null) return;
		void navigate({
			to: "/app/$workspaceId",
			params: { workspaceId: misrouted },
			replace: true,
		});
	}, [misrouted, navigate]);

	return (
		<WorkspaceContext.Provider value={{ workspaces, workspace }}>
			{children}
		</WorkspaceContext.Provider>
	);
}

export function useWorkspace(): WorkspaceSelection {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) {
		throw new Error("useWorkspace must be used within a WorkspaceProvider");
	}
	return ctx;
}
