import { Conversation, ConversationContent } from "@repo/ui";
import {
	type ChatMessage,
	messageReasoning,
	messageText,
	useChatSession,
} from "../lib/chat.tsx";

function isUser(m: ChatMessage): boolean {
	return m.type === "human" || m.type === "user";
}

export function ChatView() {
	const { messages, isLoading, error } = useChatSession();
	const lastIsUser =
		messages.length > 0 && isUser(messages[messages.length - 1]);

	return (
		<Conversation className="min-h-0 flex-1 px-8 pt-6">
			<ConversationContent className="mx-auto w-full max-w-[680px] gap-5 pb-3">
				{messages.map((m, i) => {
					const reasoning = isUser(m) ? "" : messageReasoning(m);
					return (
						<div
							key={m.id ?? i}
							className="min-w-0 whitespace-pre-wrap break-words text-fg"
						>
							{reasoning && (
								<div className="mb-2 whitespace-pre-wrap break-words border-dim/40 border-l pl-3 text-dim italic">
									{reasoning}
								</div>
							)}
							{isUser(m) && <span className="select-none text-dim">› </span>}
							{messageText(m)}
						</div>
					);
				})}
				{isLoading && lastIsUser && (
					<div className="select-none text-dim">…</div>
				)}
				{error && (
					<div className="whitespace-pre-wrap break-words text-red">
						{error}
					</div>
				)}
			</ConversationContent>
		</Conversation>
	);
}
