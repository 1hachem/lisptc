import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useWorkspace } from "../../lib/workspace.tsx";

export const Route = createFileRoute("/_authed/")({
	component: OpenWorkspace,
});

function OpenWorkspace() {
	const navigate = useNavigate();
	const { workspace } = useWorkspace();

	useEffect(() => {
		if (!workspace) return;
		void navigate({
			to: "/$workspaceId",
			params: { workspaceId: workspace._id },
			replace: true,
		});
	}, [workspace, navigate]);

	return null;
}
