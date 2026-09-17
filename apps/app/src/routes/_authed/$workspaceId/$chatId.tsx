import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
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
	loader: async ({ context, params }) => {
		if (context.auth.source === "browser") return;
		await context.queryClient.ensureQueryData(
			convexQuery(api.messages.transcript, { chatId: params.chatId }),
		);
	},
	component: Chat,
});
