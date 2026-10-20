import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useChatSession } from "../lib/chat.tsx";
import { useCommandRunner } from "../lib/commands.ts";
import { sentHistory } from "../lib/message-history.ts";
import { useSymbols } from "../lib/symbols.ts";
import { useUI } from "../lib/ui.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ChatInput } from "./chat-input.tsx";
import { ChatView } from "./chat-view.tsx";
import { Greeting } from "./greeting.tsx";

export function Chat() {
	const runCommand = useCommandRunner();
	const { inputOn } = useUI();
	const { workspaceId, chatId, send, stop, isLoading, fresh } = useChatSession(
		(state) => ({
			workspaceId: state.workspaceId,
			chatId: state.chatId,
			send: state.send,
			stop: state.stop,
			isLoading: state.isLoading,
			fresh: state.fresh,
		}),
	);
	const { data: sent } = useQuery(
		convexQuery(api.messages.sent, { workspaceId }),
	);
	const history = useMemo(() => sentHistory(sent ?? []), [sent]);
	const symbols = useSymbols(workspaceId, chatId, isLoading);

	return (
		<>
			{fresh ? null : <ChatView />}
			<div
				className={
					fresh
						? "flex min-h-0 flex-1 flex-col justify-center px-8 pb-7"
						: "px-8 pb-7"
				}
			>
				<div
					className={
						fresh
							? "mx-auto mb-5 flex w-full max-w-[680px] items-center justify-center gap-2.5"
							: "hidden"
					}
				>
					{fresh ? (
						<>
							<AgentAvatar />
							<Greeting />
						</>
					) : null}
				</div>
				<ChatInput
					placeholder="type a message"
					onSubmit={send}
					history={history}
					onCommand={runCommand}
					isStreaming={isLoading}
					onStop={stop}
					symbols={symbols}
					lisp={inputOn.lisp}
				/>
			</div>
		</>
	);
}
