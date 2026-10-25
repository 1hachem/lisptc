import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { type ChatMessage, toChatMessages } from "./chat.tsx";

export type TraceSource = (chatId: Id<"chats">) => readonly ChatMessage[];

function useStoredTrace(chatId: Id<"chats">): readonly ChatMessage[] {
	const { data } = useQuery(convexQuery(api.messages.transcript, { chatId }));
	return useMemo(() => toChatMessages(data ?? []), [data]);
}

const TraceSourceContext = createContext<TraceSource>(useStoredTrace);

export function TraceSourceProvider({
	source,
	children,
}: {
	source: TraceSource;
	children: React.ReactNode;
}) {
	return (
		<TraceSourceContext.Provider value={source}>
			{children}
		</TraceSourceContext.Provider>
	);
}

export function useTrace(chatId: Id<"chats">): readonly ChatMessage[] {
	return useContext(TraceSourceContext)(chatId);
}
