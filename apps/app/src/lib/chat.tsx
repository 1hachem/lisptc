import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import { createContext, useContext, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ChatMessage {
	id?: string;
	type: string;
	content: unknown;
	additional_kwargs?: { reasoning_content?: unknown };
}

interface ChatSession {
	messages: ChatMessage[];
	isLoading: boolean;
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
		() => new FetchStreamTransport({ apiUrl: `${API_URL}/api/chat` }),
		[],
	);
	const [threadId, setThreadId] = useState<string | null>(null);
	const stream = useStream({ transport, threadId, onThreadId: setThreadId });
	const messages = stream.messages as ChatMessage[];

	const value: ChatSession = {
		messages,
		isLoading: stream.isLoading,
		error: stream.error
			? stream.error instanceof Error
				? stream.error.message
				: String(stream.error)
			: undefined,
		send: (text) => {
			const trimmed = text.trim();
			if (!trimmed) return;
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
		clear: () => setThreadId(crypto.randomUUID()),
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
