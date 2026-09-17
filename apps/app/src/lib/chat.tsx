import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { reportIssue } from "./analytics.tsx";
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
		ui?: unknown;
		prose?: unknown;
		failed?: unknown;
	};
}

export interface FiredMemory {
	key: string;
	body: string;
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
	memories?: FiredMemory[];
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function parseMemories(value: unknown): FiredMemory[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const fired: FiredMemory[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as Record<string, unknown>;
		const key = text(raw.key);
		if (key === undefined) continue;
		fired.push({ key, body: text(raw.body) ?? "" });
	}
	return fired.length > 0 ? fired : undefined;
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
		memories: parseMemories(raw.memories),
	};
}

interface ChatSession {
	messages: ChatMessage[];
	greeting: string | null;
	meta: Record<string, StepMeta>;
	fresh: boolean;
	isLoading: boolean;
	chatId: Id<"chats"> | null;
	error?: string;
	send: (text: string) => void;
	runLisp: (code: string) => void;
	stop: () => void;
}

async function evalLisp(
	code: string,
	chatId: string,
	signal: AbortSignal,
): Promise<void> {
	const response = await fetch(`${API_URL}/api/chat/eval`, {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify({ chatId, code }),
		signal,
	});
	if (!response.ok) throw new Error(`the repl returned ${response.status}`);
}

interface StoredMessage {
	_id: string;
	type: string;
	content: string;
	kwargs?: Record<string, unknown>;
}

function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
	return stored.map((message) => ({
		id: message._id,
		type: message.type,
		content: message.content,
		additional_kwargs: message.kwargs as ChatMessage["additional_kwargs"],
	}));
}

const GREETING_ID = "greeting";

export function isGreetingMessage(message: ChatMessage): boolean {
	return message.id === GREETING_ID;
}

function greetingMessage(): ChatMessage {
	return { id: GREETING_ID, type: "ai", content: pickGreeting(new Date()) };
}

type ChatStore = UseBoundStore<StoreApi<ChatSession>>;

const ChatContext = createContext<ChatStore | null>(null);

function titleOf(message: string): string {
	const line = message.trim().split("\n")[0] ?? "";
	return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

export function ChatProvider({
	workspaceId,
	chatId,
	children,
}: {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats"> | null;
	children: React.ReactNode;
}) {
	const navigate = useNavigate();
	const createChat = useConvexMutation(api.chats.create);
	const transport = useMemo(
		() =>
			new FetchStreamTransport({
				apiUrl: `${API_URL}/api/chat`,
				onRequest: async (_url, init) => ({
					...init,
					headers: { ...init.headers, ...(await apiHeaders()) },
				}),
			}),
		[],
	);
	const stream = useStream({ transport });
	const streamed = stream.messages as ChatMessage[];
	const streamingFor = useRef<Id<"chats"> | null>(null);

	const { data: stored } = useQuery(
		convexQuery(api.messages.transcript, chatId ? { chatId } : "skip"),
	);
	const persisted = useMemo(
		() => toChatMessages((stored ?? []) as StoredMessage[]),
		[stored],
	);

	useEffect(() => {
		if (stream.error)
			reportIssue(stream.error, {
				$exception_source: "chat stream",
				thread_id: chatId ?? "draft",
			});
	}, [stream.error, chatId]);

	const [greeting, setGreeting] = useState<ChatMessage | null>(null);
	useEffect(() => {
		setGreeting(greetingMessage());
	}, []);

	const [evaluating, setEvaluating] = useState(false);
	const [evalError, setEvalError] = useState<string | undefined>(undefined);
	const running = useRef<AbortController | null>(null);

	const live = stream.isLoading && streamingFor.current === chatId;
	const turns = live ? streamed : persisted;

	const messages = useMemo(
		() =>
			!greeting || turns.some((m) => m.id === GREETING_ID)
				? turns
				: [greeting, ...turns],
		[greeting, turns],
	);

	const [meta, setMeta] = useState<Record<string, StepMeta>>({});
	useEffect(() => {
		const found: Record<string, StepMeta> = {};
		for (const m of turns) {
			if (!m.id) continue;
			const known = meta[m.id];
			if (known?.memories) continue;
			const parsed = parseMeta(m.additional_kwargs?.meta);
			if (!parsed) continue;
			if (known && !parsed.memories) continue;
			found[m.id] = parsed;
		}
		if (Object.keys(found).length > 0)
			setMeta((prev) => ({ ...prev, ...found }));
	}, [turns, meta]);

	const runLisp = useCallback(
		async (code: string) => {
			if (!chatId) return;
			const run = new AbortController();
			running.current?.abort();
			running.current = run;
			setEvalError(undefined);
			setEvaluating(true);
			try {
				await evalLisp(code, chatId, run.signal);
			} catch (ex) {
				if (run.signal.aborted) return;
				reportIssue(ex, { $exception_source: "lisp eval", thread_id: chatId });
				setEvalError(ex instanceof Error ? ex.message : String(ex));
			} finally {
				if (running.current === run) {
					running.current = null;
					setEvaluating(false);
				}
			}
		},
		[chatId],
	);

	const send = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			setEvalError(undefined);
			const opened =
				chatId ?? (await createChat({ workspaceId, title: titleOf(trimmed) }));
			streamingFor.current = opened;
			stream.submit(
				{ chatId: opened, message: trimmed },
				{
					optimisticValues: {
						messages: [
							...persisted,
							{ type: "human", content: trimmed, id: crypto.randomUUID() },
						],
					},
				},
			);
			if (!chatId) {
				await navigate({
					to: "/$workspaceId/$chatId",
					params: { workspaceId, chatId: opened },
					replace: true,
				});
			}
		},
		[chatId, workspaceId, createChat, navigate, persisted, stream],
	);

	const stop = useCallback(() => {
		running.current?.abort();
		running.current = null;
		setEvaluating(false);
		stream.stop();
	}, [stream]);

	const storeRef = useRef<ChatStore | null>(null);
	if (storeRef.current === null) {
		storeRef.current = create<ChatSession>(() => ({
			messages: [],
			greeting: null,
			meta: {},
			fresh: true,
			isLoading: false,
			chatId,
			send: () => {},
			runLisp: () => {},
			stop: () => {},
		}));
	}
	const store = storeRef.current;

	useEffect(() => {
		store.setState({
			messages,
			meta,
			greeting: greeting ? messageText(greeting) : null,
			fresh: turns.length === 0,
			isLoading: stream.isLoading || evaluating,
			chatId,
			error:
				(stream.error
					? stream.error instanceof Error
						? stream.error.message
						: String(stream.error)
					: undefined) ?? evalError,
			send: (text) => {
				void send(text);
			},
			runLisp: (code) => {
				void runLisp(code);
			},
			stop,
		});
	}, [
		store,
		messages,
		meta,
		greeting,
		turns.length,
		stream.isLoading,
		stream.error,
		evaluating,
		evalError,
		chatId,
		send,
		runLisp,
		stop,
	]);

	return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>;
}

export function useChatSession<U>(selector: (state: ChatSession) => U): U {
	const store = useContext(ChatContext);
	if (!store) {
		throw new Error("useChatSession must be used within a ChatProvider");
	}
	return store(useShallow(selector));
}

export function useChatStore(): ChatStore {
	const store = useContext(ChatContext);
	if (!store) {
		throw new Error("useChatStore must be used within a ChatProvider");
	}
	return store;
}

export function messageReasoning(message: ChatMessage): string {
	const reasoning = message.additional_kwargs?.reasoning_content;
	return typeof reasoning === "string" ? reasoning : "";
}

export function isToolMessage(message: ChatMessage): boolean {
	return message.type === "tool";
}

export function isUserMessage(message: ChatMessage): boolean {
	return message.type === "human" || message.type === "user";
}

export function messageProse(message: ChatMessage): string[] {
	const prose = message.additional_kwargs?.prose;
	return Array.isArray(prose) ? prose.map(String) : [];
}

export function toolFailed(message: ChatMessage): boolean {
	return message.additional_kwargs?.failed === true;
}

export function toolUi(message: ChatMessage): unknown {
	return message.additional_kwargs?.ui;
}

export function toolModelOutput(message: ChatMessage): {
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
	} catch {}
	return { output: text, error: false };
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
