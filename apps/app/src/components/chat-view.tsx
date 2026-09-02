import { Conversation, ConversationContent } from "@repo/ui";
import { useEffect, useRef, useState } from "react";
import {
	type ChatMessage,
	isGreetingMessage,
	isToolMessage,
	messageReasoning,
	messageText,
	toolResult,
	useChatSession,
} from "../lib/chat.tsx";
import { excerpt } from "../lib/notes.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { Greeting } from "./greeting.tsx";
import { Markdown } from "./markdown.tsx";

function isUser(m: ChatMessage): boolean {
	return m.type === "human" || m.type === "user";
}

/**
 * The per-message capture affordance.
 *
 * It sits under the message rather than in a review tool because the moment
 * worth capturing is the moment you are reading the reply — anything that costs
 * a context switch gets written down as "I'll remember that", and then isn't.
 */
function NoteButton({
	message,
	index,
	text,
}: {
	message: ChatMessage;
	index: number;
	text: string;
}) {
	const { note } = useChatSession();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const field = useRef<HTMLInputElement>(null);

	// The field only exists because the note button was just clicked, so opening
	// it without focus would make every note a two-click gesture.
	useEffect(() => {
		if (open) field.current?.focus();
	}, [open]);

	const submit = async () => {
		const trimmed = draft.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		const result = await note({
			text: trimmed,
			target: "message",
			messageId: message.id,
			messageIndex: index,
			messageExcerpt: excerpt(text),
		});
		setSaving(false);
		if (result.ok) {
			setDraft("");
			setOpen(false);
		}
	};

	if (!open)
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="mt-1 select-none text-[11px] text-dim opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus:opacity-100"
			>
				+ note
			</button>
		);

	return (
		<div className="mt-1 flex items-center gap-2 border-yellow/40 border-l pl-3">
			<span className="select-none text-[11px] text-dim">note</span>
			<input
				ref={field}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void submit();
					}
					if (e.key === "Escape") setOpen(false);
				}}
				placeholder="what happened here? #tags"
				className="min-w-0 flex-1 bg-transparent text-[12px] text-yellow caret-yellow outline-none placeholder:text-dim"
			/>
			<span className="select-none text-[10.5px] text-dim">
				{saving ? "…" : "⏎"}
			</span>
		</div>
	);
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
	const { messages, error, notice } = useChatSession();

	return (
		<Conversation className="min-h-0 flex-1 px-8 pt-6">
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
						const text = isToolMessage(m)
							? toolResult(m).output
							: messageText(m);
						const reasoning = isUser(m) ? "" : messageReasoning(m);
						return (
							<div key={m.id ?? i} className="group min-w-0">
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
								<NoteButton message={m} index={i} text={text} />
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
				{notice && (
					<div className="select-none text-[11.5px] text-yellow">{notice}</div>
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
