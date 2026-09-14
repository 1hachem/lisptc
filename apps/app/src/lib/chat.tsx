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
	useRef,
	useState,
} from "react";
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

const LISP_PREFIX = "!";

function lispEntry(text: string): string | null {
	if (!text.startsWith(LISP_PREFIX)) return null;
	const code = text.slice(LISP_PREFIX.length).trim();
	return code === "" ? null : code;
}

async function evalLisp(
	code: string,
	threadId: string,
	signal: AbortSignal,
): Promise<ChatMessage> {
	const response = await fetch(`${API_URL}/api/chat/eval`, {
		method: "POST",
		headers: apiHeaders(),
		body: JSON.stringify({
			code,
			config: { configurable: { thread_id: threadId } },
		}),
		signal,
	});
	if (!response.ok) throw new Error(`the repl returned ${response.status}`);
	const { message } = (await response.json()) as { message: ChatMessage };
	return message;
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

	const [entries, setEntries] = useState<ChatMessage[]>([]);
	const [evaluating, setEvaluating] = useState(false);
	const [evalError, setEvalError] = useState<string | undefined>(undefined);
	const running = useRef<AbortController | null>(null);

	const messages = useMemo(() => {
		const shown = [...streamed, ...entries];
		return !greeting || shown.some((m) => m.id === GREETING_ID)
			? shown
			: [greeting, ...shown];
	}, [greeting, streamed, entries]);

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

	const runLisp = useCallback(
		async (code: string) => {
			const run = new AbortController();
			running.current?.abort();
			running.current = run;
			setEvalError(undefined);
			setEvaluating(true);
			setEntries((prev) => [
				...prev,
				{ id: crypto.randomUUID(), type: "human", content: code },
			]);
			try {
				const result = await evalLisp(code, threadId, run.signal);
				setEntries((prev) => [...prev, result]);
			} catch (ex) {
				if (run.signal.aborted) return;
				setEvalError(ex instanceof Error ? ex.message : String(ex));
			} finally {
				if (running.current === run) {
					running.current = null;
					setEvaluating(false);
				}
			}
		},
		[threadId],
	);

	const value: ChatSession = {
		messages,
		meta,
		greeting: greeting ? messageText(greeting) : null,
		fresh: streamed.length === 0 && entries.length === 0,
		isLoading: stream.isLoading || evaluating,
		threadId,
		error:
			(stream.error
				? stream.error instanceof Error
					? stream.error.message
					: String(stream.error)
				: undefined) ?? evalError,
		send: (text) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			const code = lispEntry(trimmed);
			if (code !== null) {
				void runLisp(code);
				return;
			}
			const history = messages.map((m) => ({
				type: m.type,
				content: m.content,
				id: m.id,
			}));
			const turn = [
				...history,
				{ type: "human", content: trimmed, id: crypto.randomUUID() },
			];
			setEntries([]);
			setEvalError(undefined);
			stream.submit(
				{ messages: turn },
				{ optimisticValues: { messages: turn } },
			);
		},
		stop: () => {
			running.current?.abort();
			running.current = null;
			setEvaluating(false);
			stream.stop();
		},
		clear: () => {
			running.current?.abort();
			running.current = null;
			setEvaluating(false);
			setEntries([]);
			setEvalError(undefined);
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
