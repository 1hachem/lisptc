import type { Id } from "@repo/backend/dataModel";
import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "../../../components/chat.tsx";

export const Route = createFileRoute("/_authed/$workspaceId/$chatId")({
	params: {
		parse: ({ chatId }: { chatId: string }) => ({
			chatId: chatId as Id<"chats">,
		}),
		stringify: ({ chatId }: { chatId: Id<"chats"> }) => ({ chatId }),
	},
	component: Chat,
});
