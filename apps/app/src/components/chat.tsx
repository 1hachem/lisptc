import { useMemo } from "react";
import { useChatSession } from "../lib/chat.tsx";
import { openQuestion } from "../lib/question.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ChatComposer } from "./chat-composer.tsx";
import { ChatView } from "./chat-view.tsx";
import { ChildThreads } from "./child-threads.tsx";
import { Greeting } from "./greeting.tsx";
import { McpServers } from "./mcp-servers.tsx";

export function Chat() {
	const fresh = useChatSession((state) => state.fresh);
	const messages = useChatSession((state) => state.messages);
	const chatId = useChatSession((state) => state.chatId);
	const question = useMemo(() => openQuestion(messages), [messages]);

	return (
		<div data-chat className="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{fresh ? null : <ChatView />}
			<ChildThreads chatId={chatId} />
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
							<AgentAvatar quiet />
							<Greeting />
						</>
					) : null}
				</div>
				<McpServers chatId={chatId} />
				<ChatComposer question={question} />
			</div>
		</div>
	);
}
