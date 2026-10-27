import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { type ChatMessage, sequenced } from "./chat.tsx";
import { timelineOf } from "./timeline.ts";
import { shownMessages, useWatch } from "./watch.ts";

export type TraceSource = (chatId: Id<"chats">) => readonly ChatMessage[];

function useLiveTrace(chatId: Id<"chats">): readonly ChatMessage[] {
	const { data } = useQuery(convexQuery(api.messages.transcript, { chatId }));
	const watched = useWatch(chatId);
	const stored = useMemo(() => sequenced(data ?? []), [data]);
	return useMemo(
		() =>
			timelineOf(
				stored,
				shownMessages(
					watched,
					stored.map(({ message }) => message),
				),
				false,
			),
		[stored, watched],
	);
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
