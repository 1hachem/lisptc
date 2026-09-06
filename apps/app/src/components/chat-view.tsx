import {
	Conversation,
	ConversationContent,
	useStickToBottomContext,
} from "@repo/ui";
import { useEffect, useState } from "react";
import {
	type ChatMessage,
	isGreetingMessage,
	isToolMessage,
	messageReasoning,
	messageText,
	toolResult,
	useChatSession,
} from "../lib/chat.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { Greeting } from "./greeting.tsx";
import { Markdown } from "./markdown.tsx";
import { MessageFeedback } from "./message-feedback.tsx";
import { MessageMeta } from "./message-meta.tsx";

function isUser(m: ChatMessage): boolean {
	return m.type === "human" || m.type === "user";
}

const FOLD_LINES = 25;

function ToolMessage({ message }: { message: ChatMessage }) {
	const { output, error } = toolResult(message);
	const [expanded, setExpanded] = useState(false);
	const lines = output.split("\n");
	const folded = lines.length > FOLD_LINES && !expanded;
	return (
		<div
			className={`min-w-0 break-words border-l pl-3 ${
				error ? "border-red/60 text-red" : "border-dim/40 text-dim"
			}`}
		>
			<Markdown>
				{folded ? lines.slice(0, FOLD_LINES).join("\n") : output}
			</Markdown>
			{lines.length > FOLD_LINES && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="text-dim underline decoration-dim/40 hover:text-fg"
				>
					{folded
						? `show ${lines.length - FOLD_LINES} more lines`
						: "show less"}
				</button>
			)}
		</div>
	);
}

function StickOnSend({ turn }: { turn: string | undefined }) {
	const { scrollToBottom } = useStickToBottomContext();
	useEffect(() => {
		if (turn) scrollToBottom("instant");
	}, [turn, scrollToBottom]);
	return null;
}

function ScrollToLatest() {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();
	if (isAtBottom) return null;
	return (
		<button
			type="button"
			onClick={() => scrollToBottom("instant")}
			className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-[7px] rounded-none bg-bg2 px-[9px] py-px text-[11.5px] text-fg hover:brightness-125"
		>
			<span>latest</span>
			<span className="text-dim">▼</span>
		</button>
	);
}

export function ChatView() {
	const { messages, meta, error } = useChatSession();
	const lastSent = messages.filter(isUser).at(-1)?.id;

	return (
		<Conversation className="min-h-0 flex-1 px-8 pt-6">
			<StickOnSend turn={lastSent} />
			<ConversationContent className="mx-auto w-full max-w-[680px] gap-5 pb-3">
				<Greeting />
				{messages
					.filter((m) => !isGreetingMessage(m))
					.map((m, i) => {
						const reasoning = isUser(m) ? "" : messageReasoning(m);
						const stats = m.id ? meta[m.id] : undefined;
						return (
							<div key={m.id ?? i} className="group relative min-w-0">
								{isToolMessage(m) ? (
									<ToolMessage message={m} />
								) : (
									<div className="min-w-0 break-words text-fg">
										{reasoning && (
											<div className="mb-2 whitespace-pre-wrap break-words border-dim/40 border-l pl-3 text-dim italic">
												{reasoning}
											</div>
										)}
										{isUser(m) ? (
											<div className="flex min-w-0 gap-1">
												<span className="select-none text-dim">›</span>
												<Markdown>{messageText(m)}</Markdown>
											</div>
										) : (
											<Markdown>{messageText(m)}</Markdown>
										)}
									</div>
								)}
								{stats && <MessageMeta meta={stats} />}
								{!isUser(m) && !isToolMessage(m) && (
									<MessageFeedback messageId={m.id} index={i} />
								)}
							</div>
						);
					})}
				<div className="-mt-5 pt-[1.7em]">
					<AgentAvatar />
				</div>
				{error && (
					<div className="whitespace-pre-wrap break-words text-red">
						{error}
					</div>
				)}
				<div aria-hidden className="h-[10vh]" />
			</ConversationContent>
			<ScrollToLatest />
		</Conversation>
	);
}
