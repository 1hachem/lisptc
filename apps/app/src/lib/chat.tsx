import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	apiHeaders,
	type NoteInput,
	type NoteResult,
	postNote,
} from "./notes.ts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ChatMessage {
	id?: string;
	type: string;
	content: unknown;
	additional_kwargs?: { reasoning_content?: unknown };
}

/** A note written from the composer or from under a message. */
export type NoteDraft = Omit<NoteInput, "threadId" | "target"> & {
	target?: NoteInput["target"];
};

interface ChatSession {
	messages: ChatMessage[];
	isLoading: boolean;
	/** the id every event of this conversation is traced under */
	threadId: string;
	/** send a note about this conversation (or one of its messages) to PostHog */
	note: (draft: NoteDraft) => Promise<NoteResult>;
	/** transient confirmation of the last note, shown under the transcript */
	notice?: string;
	/** set when the last run failed (e.g. the agent/provider errored) */
	error?: string;
	/** send a plain-text user turn */
	send: (text: string) => void;
	/** abort the in-flight run — cancels the fetch, which aborts the model stream */
	stop: () => void;
	/** start a fresh session */
	clear: () => void;
}

const ChatContext = createContext<ChatSession | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
	const transport = useMemo(
		() =>
			new FetchStreamTransport({
				apiUrl: `${API_URL}/api/chat`,
				// Carries the browser-local id onto every chat request, so the turn's
				// trace and the notes written about it land on the same person.
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
	const messages = stream.messages as ChatMessage[];
	const [notice, setNotice] = useState<string | undefined>();

	const note = useCallback(
		async (draft: NoteDraft): Promise<NoteResult> => {
			const result = await postNote({
				...draft,
				threadId,
				target: draft.target ?? "conversation",
			});
			setNotice(
				result.ok
					? result.captured
						? "note captured"
						: "note dropped — the API has no POSTHOG_API_KEY"
					: `note failed: ${result.error}`,
			);
			return result;
		},
		[threadId],
	);

	// The confirmation is an acknowledgement, not a message — it should not sit
	// in the transcript once it has been read.
	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(undefined), 4000);
		return () => clearTimeout(timer);
	}, [notice]);

	const value: ChatSession = {
		messages,
		isLoading: stream.isLoading,
		threadId,
		note,
		notice,
		error: stream.error
			? stream.error instanceof Error
				? stream.error.message
				: String(stream.error)
			: undefined,
		send: (text) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			// `/note <text>` is a comment about the run, not a turn — it must never
			// reach the model, or the thing being measured changes because it was
			// measured.
			if (/^\/note\b/.test(trimmed)) {
				const body = trimmed.slice("/note".length).trim();
				if (body) void note({ text: body, target: "conversation" });
				else setNotice("/note needs something to say");
				return;
			}
			// FetchStreamTransport is stateless, so replay the whole conversation
			// each turn; the server echoes it back and streams the new reply.
			const history = messages.map((m) => ({
				type: m.type,
				content: m.content,
				id: m.id,
			}));
			stream.submit({
				messages: [...history, { type: "human", content: trimmed }],
			});
		},
		stop: () => stream.stop(),
		clear: () => {
			setThreadId(crypto.randomUUID());
			setNotice(undefined);
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
 */
export function toolResult(message: ChatMessage): {
	output: string;
	error: boolean;
} {
	const text = messageText(message);
	try {
		const parsed = JSON.parse(text) as {
			source?: unknown;
			output?: unknown;
			error?: unknown;
		};
		if (parsed?.source === "lisp-repl")
			return {
				output: String(parsed.output ?? ""),
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
