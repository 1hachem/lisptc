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

// Lines of REPL output shown before it is folded away. The model's own view of
// a result is capped at a word limit; a human's is not (see `toolResult`), so
// the one thing left to guard against is a long `echo` burying the turns around
// it in a transcript nobody can scroll past.
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

/**
 * Sending is a jump to the bottom: the turn just typed, and the reply about to
 * land under it, are what the sender wants in view. Instant, not animated —
 * being carried down through the whole transcript is the thing worth avoiding.
 */
function StickOnSend({ turn }: { turn: string | undefined }) {
	const { scrollToBottom } = useStickToBottomContext();
	useEffect(() => {
		if (turn) scrollToBottom("instant");
	}, [turn, scrollToBottom]);
	return null;
}

/**
 * The way back down, for a reader who has travelled up the transcript. It rides
 * at the foot of the conversation — directly above the composer — and shows
 * itself only once the view has left the bottom, which the container reports
 * with a 70px grace so it never flickers in on the last line.
 */
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
				{/*
				 * The opening line is a turn like any other, so it stays put once the
				 * conversation starts rather than being swapped out for the first
				 * message — a greeting that vanishes reads as a placeholder, and this
				 * one is the agent talking.
				 */}
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
								{/* the agent's turns are the ones there is anything to say about */}
								{!isUser(m) && !isToolMessage(m) && (
									<MessageFeedback messageId={m.id} index={i} />
								)}
							</div>
						);
					})}
				{/*
				 * The agent's face: its state is the run's state, `…` included.
				 *
				 * It stands in the text column at the foot of the transcript, one blank
				 * line under the turn above it — so the moment a request is sent, the
				 * animation is on the SECOND line below what the user typed, which is
				 * where the reply is about to appear.
				 *
				 * That line is measured, not spaced by the flex gap: `-mt-5` cancels the
				 * gap so the box starts flush with the bottom of the text above, and
				 * `1.7em` — the shell's own line height — is then exactly one empty row.
				 */}
				<div className="-mt-5 pt-[1.7em]">
					<AgentAvatar />
				</div>
				{error && (
					<div className="whitespace-pre-wrap break-words text-red">
						{error}
					</div>
				)}
				{/*
				 * Room to scroll past the last turn, so the tail of the conversation
				 * does not come to rest hard against the composer. It is real
				 * scrollable height, so a short conversation — which does not fill the
				 * screen — is left where it is.
				 */}
				<div aria-hidden className="h-[10vh]" />
			</ConversationContent>
			<ScrollToLatest />
		</Conversation>
	);
}
