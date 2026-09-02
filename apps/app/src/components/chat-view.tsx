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
		// `@container` so the avatar below can ask about the width of the CHAT
		// column, sidebars included, rather than the width of the window
		<Conversation className="@container min-h-0 flex-1 px-8 pt-6">
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
				{/*
				 * The agent's face: its state is the run's state, `…` included.
				 *
				 * It sits in the left margin, level with the last row of text, and it
				 * takes no width from the text to do it: the wrapper is a flex item of
				 * ZERO height (with the flex gap cancelled) so `bottom-0` lands on the
				 * bottom edge of the message above, and the avatar stands in the gutter
				 * on its own.
				 *
				 * Only once there is a gutter to stand in, hence the container query:
				 * 28px of avatar has to fit outside a 680px column inside 64px of
				 * padding, which needs 832px of chat. Below that it drops back into the
				 * flow, on its own row.
				 */}
				<div className="relative @min-[832px]:-mt-5 @min-[832px]:h-0">
					<div className="@min-[832px]:-left-11 @min-[832px]:absolute @min-[832px]:bottom-0">
						<AgentAvatar />
					</div>
				</div>
				{error && (
					<div className="whitespace-pre-wrap break-words text-red">
						{error}
					</div>
				)}
			</ConversationContent>
		</Conversation>
	);
}
