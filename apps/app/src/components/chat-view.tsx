import { Conversation, ConversationContent } from "@repo/ui";
import { useChat } from "../lib/chat.ts";

export function ChatView() {
	const messages = useChat();

	return (
		<Conversation className="min-h-0 flex-1 px-8 pt-6">
			<ConversationContent className="mx-auto w-full max-w-[680px] gap-5 pb-3">
				{messages.map((m) => (
					<div key={m.id} className="whitespace-pre-wrap text-fg">
						{m.role === "user" && (
							<span className="select-none text-dim">› </span>
						)}
						{m.text}
					</div>
				))}
			</ConversationContent>
		</Conversation>
	);
}
