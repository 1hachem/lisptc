import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppLoading } from "../../components/app-loading.tsx";
import { useWorkspace } from "../../lib/workspace.tsx";

export const Route = createFileRoute("/app/")({
	component: OpenWorkspace,
});

function OpenWorkspace() {
	const navigate = useNavigate();
	const { workspace } = useWorkspace();

	useEffect(() => {
		if (!workspace) return;
		void navigate({
			to: "/app/$workspaceId",
			params: { workspaceId: workspace._id },
			replace: true,
		});
	}, [workspace, navigate]);

	return <AppLoading />;
}
