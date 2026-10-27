import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { type ChatMessage, toChatMessages } from "./chat.tsx";
import { shownMessages, useWatch } from "./watch.ts";

export type TraceSource = (chatId: Id<"chats">) => readonly ChatMessage[];

function useLiveTrace(chatId: Id<"chats">): readonly ChatMessage[] {
	const { data } = useQuery(convexQuery(api.messages.transcript, { chatId }));
	const watched = useWatch(chatId);
	const stored = useMemo(() => toChatMessages(data ?? []), [data]);
	return useMemo(
		() => withUnstored(stored, shownMessages(watched, stored)),
		[stored, watched],
	);
}

function withUnstored(
	stored: readonly ChatMessage[],
	streamed: readonly ChatMessage[],
): readonly ChatMessage[] {
	const known = new Set(stored.map((message) => message.id));
	const unstored = streamed.filter((message) => !known.has(message.id));
	return unstored.length === 0 ? stored : [...stored, ...unstored];
}

const TraceSourceContext = createContext<TraceSource>(useLiveTrace);

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
