import type { Id } from "@repo/backend/dataModel";
import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { AnimatedFavicon } from "../../../components/animated-favicon.tsx";
import { PanelSplit } from "../../../components/panel-split.tsx";
import { AgentProvider } from "../../../lib/agent.tsx";
import { ChatProvider } from "../../../lib/chat.tsx";
import { ForkPickerProvider } from "../../../lib/fork-picker.tsx";
import { PanelsProvider } from "../../../lib/panels.tsx";

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
			<ForkPickerProvider>
				<AgentProvider>
					<PanelsProvider workspaceId={workspaceId}>
						<AnimatedFavicon />
						<PanelSplit>
							<Outlet />
						</PanelSplit>
					</PanelsProvider>
				</AgentProvider>
			</ForkPickerProvider>
		</ChatProvider>
	);
}
