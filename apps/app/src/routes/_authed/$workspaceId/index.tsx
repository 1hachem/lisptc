import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "../../../components/chat.tsx";
import { RemoteSetup } from "../../../components/remote-setup.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/")({
	component: WorkspaceHome,
});

function WorkspaceHome() {
	const { workspaceId } = Route.useParams();
	const {
		data: remote,
		isPending,
		error,
	} = useQuery(convexQuery(api.remotes.get, { workspaceId }));
	if (error) throw error;
	if (isPending) return null;
	if (remote === null) return <RemoteSetup workspaceId={workspaceId} />;
	return <Chat />;
}
