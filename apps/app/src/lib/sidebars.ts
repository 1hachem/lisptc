import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { reportIssue } from "./analytics.tsx";
import type { SidebarSide } from "./sidebar-order.ts";
import type { OpenSidebars } from "./ui.tsx";
import { useWorkspace } from "./workspace.tsx";

export function useStoredSidebars(): OpenSidebars {
	const workspaceId = useWorkspace().workspace?._id;
	const { data: shown } = useQuery(
		convexQuery(
			api.layouts.sidebarsShown,
			workspaceId ? { workspaceId } : "skip",
		),
	);
	const mutation = useConvexMutation(api.layouts.sidebar);
	const put = useCallback(
		(side: SidebarSide, open: boolean) => {
			if (!workspaceId) return;
			mutation({ workspaceId, side, open }).catch((error) =>
				reportIssue(error, { $exception_source: "sidebar" }),
			);
		},
		[mutation, workspaceId],
	);
	return useMemo(() => ({ shown, put }), [shown, put]);
}
