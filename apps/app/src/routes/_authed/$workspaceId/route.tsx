import type { Id } from "@repo/backend/dataModel";
import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { AnimatedFavicon } from "../../../components/animated-favicon.tsx";
import { AgentProvider } from "../../../lib/agent.tsx";
import { ChatProvider } from "../../../lib/chat.tsx";

export const Route = createFileRoute("/_authed/$workspaceId")({
	params: {
		parse: ({ workspaceId }: { workspaceId: string }) => ({
			workspaceId: workspaceId as Id<"workspaces">,
		}),
		stringify: ({ workspaceId }: { workspaceId: Id<"workspaces"> }) => ({
			workspaceId,
		}),
	},
	component: WorkspaceLayout,
});

function WorkspaceLayout() {
	const { workspaceId } = Route.useParams();
	const chatId = useParams({ strict: false }).chatId;

	return (
		<ChatProvider workspaceId={workspaceId} chatId={chatId ?? null}>
			<AgentProvider>
				<AnimatedFavicon />
				<Outlet />
			</AgentProvider>
		</ChatProvider>
	);
}
