import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useWorkspace } from "./workspace.tsx";

export function useNewChat(): () => Promise<void> {
	const navigate = useNavigate();
	const { workspace } = useWorkspace();

	return useCallback(async () => {
		if (!workspace) return;
		await navigate({
			to: "/$workspaceId",
			params: { workspaceId: workspace._id },
		});
	}, [workspace, navigate]);
}
