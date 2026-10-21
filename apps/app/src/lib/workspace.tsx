import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Doc } from "@repo/backend/dataModel";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
	createContext,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";

const PICKED_KEY = "lisptc.workspace";

type Workspace = Doc<"workspaces">;

interface WorkspaceSelection {
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

function picked(
	workspaces: Workspace[],
	inRoute: string | undefined,
): Workspace | null {
	return (
		workspaces.find((candidate) => candidate._id === inRoute) ??
		workspaces.find((candidate) => candidate._id === remembered()) ??
		workspaces[0] ??
		null
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

	useEffect(() => {
		if (!workspace) return;
		try {
			localStorage.setItem(PICKED_KEY, workspace._id);
		} catch {}
	}, [workspace]);

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
