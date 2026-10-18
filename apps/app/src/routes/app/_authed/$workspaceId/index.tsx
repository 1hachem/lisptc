import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "../../../../components/chat.tsx";

export const Route = createFileRoute("/app/_authed/$workspaceId/")({
	component: Chat,
});
