import type { Id } from "@repo/backend/dataModel";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/$workspaceId/$chatId")({
	params: {
		parse: ({ chatId }: { chatId: string }) => ({
			chatId: chatId as Id<"chats">,
		}),
		stringify: ({ chatId }: { chatId: Id<"chats"> }) => ({ chatId }),
	},
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/$workspaceId/chat/$chatId",
			params,
			replace: true,
		});
	},
});
