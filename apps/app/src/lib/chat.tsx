import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_URL, apiHeaders } from "./api.ts";
import { pickGreeting } from "./greeting.ts";

export interface ChatMessage {
	id?: string;
	type: string;
	content: unknown;
	additional_kwargs?: { reasoning_content?: unknown; display?: unknown };
}

interface ChatSession {
	messages: ChatMessage[];
	/**
	 * The opening line, also `messages[0]` — `null` until the first effect runs
	 * (see `greetingMessage`). Handed out separately so the view can hold its row
	 * open before there is a line to put in it.
	 */
	greeting: string | null;
	/** no turns yet — the greeting alone doesn't count as a conversation */
	fresh: boolean;
	isLoading: boolean;
	/** the id every event of this conversation is traced under */
	threadId: string;
	/** set when the last run failed (e.g. the agent/provider errored) */
	error?: string;
	/** send a plain-text user turn */
	send: (text: string) => void;
	/** abort the in-flight run — cancels the fetch, which aborts the model stream */
	stop: () => void;
	/** start a fresh session */
	clear: () => void;
}

/**
 * The greeting is a real assistant turn: it leads the transcript and it is
 * replayed to the model with every send, so the agent is answering a
 * conversation it opened rather than one that starts mid-air.
 *
 * A fixed id is what keeps it single. `send` replays the whole list and the
 * server echoes it back verbatim, ids included, so from the second turn on the
 * greeting arrives in `stream.messages` like any other message — and prepending
 * the local copy on top of it would show it twice.
 *
 * Prose, not Lisp, which is legal for an assistant turn: a form-less reply is how
 * the policy spells "finished answering" (see `AgentRepl`), so the greeting reads
 * to the model as a completed turn and not as code it should carry on from.
 */
const GREETING_ID = "greeting";

/** The greeting draws itself (`<Greeting>`), so the message loop skips it. */
export function isGreetingMessage(message: ChatMessage): boolean {
	return message.id === GREETING_ID;
}

function greetingMessage(): ChatMessage {
	return { id: GREETING_ID, type: "ai", content: pickGreeting(new Date()) };
}

const ChatContext = createContext<ChatSession | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
	const transport = useMemo(
		() =>
			new FetchStreamTransport({
				apiUrl: `${API_URL}/api/chat`,
				// Carries the browser-local id onto every chat request, so the turn's
				// trace and the feedback given on it land on the same person.
				defaultHeaders: apiHeaders(),
			}),
		[],
	);
	// Generated up front rather than left null until the server names one: the
	// API keys the persistent AgentRepl (and now the trace) off this id, so a
	// conversation without one loses its interpreter state between turns.
	const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
	const stream = useStream({
		transport,
		threadId,
		onThreadId: (id) => {
			if (id) setThreadId(id);
		},
	});
	const streamed = stream.messages as ChatMessage[];

	// Picked in an effect, not in the initialiser: the page is server-rendered and
	// both inputs disagree across that boundary — the die comes up differently and
	// the server's clock is in the server's timezone.
	const [greeting, setGreeting] = useState<ChatMessage | null>(null);
	useEffect(() => {
		setGreeting(greetingMessage());
	}, []);

	const messages = useMemo(
		() =>
			!greeting || streamed.some((m) => m.id === GREETING_ID)
				? streamed
				: [greeting, ...streamed],
		[greeting, streamed],
	);

	const value: ChatSession = {
		messages,
		greeting: greeting ? messageText(greeting) : null,
		fresh: streamed.length === 0,
		isLoading: stream.isLoading,
		threadId,
		error: stream.error
			? stream.error instanceof Error
				? stream.error.message
				: String(stream.error)
			: undefined,
		send: (text) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			// FetchStreamTransport is stateless, so replay the whole conversation
			// each turn — greeting included, it is `messages[0]`; the server echoes it
			// back and streams the new reply.
			const history = messages.map((m) => ({
				type: m.type,
				content: m.content,
				id: m.id,
			}));
			// The id is named here rather than left to the server: it is this turn's
			// React key, and the server echoes it back verbatim, so the message shown
			// on send and the one that comes back are the same row.
			const turn = [
				...history,
				{ type: "human", content: trimmed, id: crypto.randomUUID() },
			];
			// Shown optimistically because `submit` first resets the stream's values
			// to `initialValues` — `{}` for a stateless transport — so without this
			// the transcript blanks out until the server's opening `values` event
			// echoes it back. That empty frame collapses the scroll container, which
			// throws a reader who was part-way up the conversation to the top and
			// then scrolls them back down once the messages return.
			stream.submit(
				{ messages: turn },
				{ optimisticValues: { messages: turn } },
			);
		},
		stop: () => stream.stop(),
		clear: () => {
			setThreadId(crypto.randomUUID());
			// a new conversation gets a new opening line, and a fresh look at the clock
			setGreeting(greetingMessage());
		},
	};

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatSession(): ChatSession {
	const ctx = useContext(ChatContext);
	if (!ctx) {
		throw new Error("useChatSession must be used within a ChatProvider");
	}
	return ctx;
}

/** Mirrors `WarmStatus` in @repo/ai — the API reports it on /health. */
export type WarmStatus =
	| "pending"
	| "restored"
	| "saved"
	| "unavailable"
	| "failed"
	| "skipped";

/**
 * Polls the API until its llama.cpp KV warmup settles.
 *
 * Only an explicit `"pending"` counts as warming. An unreachable API stays
 * `null` — locking the composer because the server is down would strand the
 * user with no way to find out why; a send surfaces the real error instead.
 */
export function useWarmup(): { warming: boolean; status: WarmStatus | null } {
	const [status, setStatus] = useState<WarmStatus | null>(null);

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;

		const poll = async () => {
			let warm: WarmStatus | null = null;
			try {
				const res = await fetch(`${API_URL}/health`);
				warm = ((await res.json()) as { warm?: WarmStatus }).warm ?? null;
			} catch {
				// API not up yet — keep polling so the composer unlocks on its own
			}
			if (cancelled) return;
			setStatus(warm);
			if (warm === null || warm === "pending") timer = setTimeout(poll, 2000);
		};
		void poll();

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, []);

	return { warming: status === "pending", status };
}

/** The model's thinking trace, accumulated client-side onto the AI message. */
export function messageReasoning(message: ChatMessage): string {
	const reasoning = message.additional_kwargs?.reasoning_content;
	return typeof reasoning === "string" ? reasoning : "";
}

export function isToolMessage(message: ChatMessage): boolean {
	return message.type === "tool";
}

/**
 * A REPL result rides as a JSON tool-result object (so the model never mistakes
 * it for a human turn). Unwrap it for display: show the printed `output`, and
 * flag failures. Falls back to the raw content if it isn't the expected shape.
 *
 * `content` holds the output capped to the model's word limit; when the step
 * printed more than that, the full text rides in `additional_kwargs.display`
 * and is what a human should read — there is no reason to truncate a page the
 * reader can simply scroll.
 */
export function toolResult(message: ChatMessage): {
	output: string;
	error: boolean;
} {
	const text = messageText(message);
	const display = message.additional_kwargs?.display;
	try {
		const parsed = JSON.parse(text) as {
			source?: unknown;
			output?: unknown;
			error?: unknown;
		};
		if (parsed?.source === "lisp-repl")
			return {
				output:
					typeof display === "string" ? display : String(parsed.output ?? ""),
				error: Boolean(parsed.error),
			};
	} catch {
		// not JSON — fall through to raw text
	}
	return { output: text, error: false };
}

export function messageText(message: ChatMessage): string {
	const { content } = message;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				typeof part === "string"
					? part
					: part && typeof part === "object" && "text" in part
						? String((part as { text: unknown }).text)
						: "",
			)
			.join("");
	}
	return "";
}
