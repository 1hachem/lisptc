import type { Id } from "@repo/backend/dataModel";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { PanelContent } from "./panel-ops.ts";

export interface PageHost {
	show: (content: PanelContent) => void;
}

const PageHostContext = createContext<PageHost | null>(null);

export function PageHostProvider({
	host,
	children,
}: {
	host: PageHost;
	children: ReactNode;
}) {
	return (
		<PageHostContext.Provider value={host}>{children}</PageHostContext.Provider>
	);
}

function useRouteHost(): PageHost {
	const navigate = useNavigate();
	const workspaceId = useParams({ strict: false }).workspaceId as
		| Id<"workspaces">
		| undefined;
	return useMemo(
		() => ({
			show: (content: PanelContent) => {
				if (workspaceId === undefined) return;
				const at = { workspaceId };
				switch (content.kind) {
					case "file":
						void navigate(
							content.folder === "knowledge"
								? {
										to: "/$workspaceId/knowledge/$name",
										params: { ...at, name: content.name },
										replace: true,
									}
								: {
										to: "/$workspaceId/attachments/$name",
										params: { ...at, name: content.name },
										replace: true,
									},
						);
						return;
					case "chat":
						void navigate(
							content.chatId === null
								? { to: "/$workspaceId", params: at }
								: {
										to: "/$workspaceId/chat/$chatId",
										params: { ...at, chatId: content.chatId as Id<"chats"> },
									},
						);
						return;
					default:
						return;
				}
			},
		}),
		[navigate, workspaceId],
	);
}

export function usePageHost(): PageHost {
	const routed = useRouteHost();
	return useContext(PageHostContext) ?? routed;
}
