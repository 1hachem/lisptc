import { Conversation, ConversationContent } from "@repo/ui";
import {
	type ChatMessage,
	isToolMessage,
	messageReasoning,
	messageText,
	toolResult,
	useChatSession,
} from "../lib/chat.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { Greeting } from "./greeting.tsx";
import { Markdown } from "./markdown.tsx";

function isUser(m: ChatMessage): boolean {
	return m.type === "human" || m.type === "user";
}

function ToolMessage({ message }: { message: ChatMessage }) {
	const { output, error } = toolResult(message);
	return (
		<div
			className={`min-w-0 break-words border-l pl-3 ${
				error ? "border-red/60 text-red" : "border-dim/40 text-dim"
			}`}
		>
			<Markdown>{output}</Markdown>
		</div>
	);
}

export function ChatView() {
	const { messages, error } = useChatSession();

	return (
		<Conversation className="min-h-0 flex-1 px-8 pt-6">
			<ConversationContent className="mx-auto w-full max-w-[680px] gap-5 pb-3">
				{messages.map((m, i) => {
					if (isToolMessage(m))
						return <ToolMessage key={m.id ?? i} message={m} />;
					const reasoning = isUser(m) ? "" : messageReasoning(m);
					return (
						<div key={m.id ?? i} className="min-w-0 break-words text-fg">
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
					);
				})}
				{messages.length === 0 && <Greeting />}
				{/* the agent's face: its state is the run's state, `…` included */}
				<AgentAvatar />
				{error && (
					<div className="whitespace-pre-wrap break-words text-red">
						{error}
					</div>
				)}
			</ConversationContent>
		</Conversation>
	);
}
