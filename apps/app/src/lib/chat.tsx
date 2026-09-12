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
	additional_kwargs?: {
		reasoning_content?: unknown;
		meta?: unknown;
		display?: unknown;
	};
}

export interface StepMeta {
	at?: string;
	durationMs: number;
	provider?: string;
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	steps?: number;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function parseMeta(value: unknown): StepMeta | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const durationMs = num(raw.durationMs);
	if (durationMs === undefined) return undefined;
	return {
		at: typeof raw.at === "string" ? raw.at : undefined,
		durationMs,
		provider: text(raw.provider),
		model: text(raw.model),
		inputTokens: num(raw.inputTokens),
		outputTokens: num(raw.outputTokens),
		cachedInputTokens: num(raw.cachedInputTokens),
		steps: num(raw.steps),
	};
}

interface ChatSession {
	messages: ChatMessage[];
	greeting: string | null;
	meta: Record<string, StepMeta>;
	fresh: boolean;
	isLoading: boolean;
	threadId: string;
	error?: string;
	send: (text: string) => void;
	stop: () => void;
	clear: () => void;
}

const GREETING_ID = "greeting";

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
				defaultHeaders: apiHeaders(),
			}),
		[],
	);
	const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
	const stream = useStream({
		transport,
		threadId,
		onThreadId: (id) => {
			if (id) setThreadId(id);
		},
	});
	const streamed = stream.messages as ChatMessage[];

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

	const [meta, setMeta] = useState<Record<string, StepMeta>>({});
	useEffect(() => {
		const found: Record<string, StepMeta> = {};
		for (const m of streamed) {
			if (!m.id || meta[m.id]) continue;
			const parsed = parseMeta(m.additional_kwargs?.meta);
			if (parsed) found[m.id] = parsed;
		}
		if (Object.keys(found).length > 0)
			setMeta((prev) => ({ ...prev, ...found }));
	}, [streamed, meta]);

	const value: ChatSession = {
		messages,
		meta,
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
			const history = messages.map((m) => ({
				type: m.type,
				content: m.content,
				id: m.id,
			}));
			const turn = [
				...history,
				{ type: "human", content: trimmed, id: crypto.randomUUID() },
			];
			stream.submit(
				{ messages: turn },
				{ optimisticValues: { messages: turn } },
			);
		},
		stop: () => stream.stop(),
		clear: () => {
			setThreadId(crypto.randomUUID());
			setMeta({});
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

export type WarmStatus =
	| "pending"
	| "restored"
	| "saved"
	| "unavailable"
	| "failed"
	| "skipped";

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
			} catch {}
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

export function messageReasoning(message: ChatMessage): string {
	const reasoning = message.additional_kwargs?.reasoning_content;
	return typeof reasoning === "string" ? reasoning : "";
}

export function isToolMessage(message: ChatMessage): boolean {
	return message.type === "tool";
}

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
	} catch {}
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
