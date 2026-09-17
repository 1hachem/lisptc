import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { createContext, useContext, useEffect } from "react";

const PICKED_KEY = "lisptc.workspace";

interface Workspace {
	_id: Id<"workspaces">;
	name: string;
	slug: string;
}

interface WorkspaceSelection {
	workspaces: Workspace[];
	workspace: Workspace | null;
	loading: boolean;
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

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
	const { data, error } = useQuery(convexQuery(api.workspaces.list, {}));
	if (error) throw error;
	const workspaces = (data ?? []) as Workspace[];
	const inRoute = useParams({ strict: false }).workspaceId;

	const workspace =
		workspaces.find((candidate) => candidate._id === inRoute) ??
		workspaces.find((candidate) => candidate._id === remembered()) ??
		workspaces[0] ??
		null;

	useEffect(() => {
		if (!workspace) return;
		try {
			localStorage.setItem(PICKED_KEY, workspace._id);
		} catch {}
	}, [workspace]);

	return (
		<WorkspaceContext.Provider
			value={{ workspaces, workspace, loading: data === undefined }}
		>
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
