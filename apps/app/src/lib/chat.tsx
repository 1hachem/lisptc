import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type FiredMemory, firedMemories } from "@repo/components";
import type { Skipped } from "@repo/syntax";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
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
import { apiHeaders } from "./api.ts";
import { type Answered, type Ask, answersOf, asksOf } from "./asks.ts";
import { fileContext, type OpenFile } from "./files.ts";
import { GREETING_ID, pickGreeting } from "./greeting.ts";
import { type QueuedMessage, useSteerQueue } from "./steer-queue.ts";
import type { SystemEventTicket } from "./system-event.ts";
import { isFreshChat, turnsToShow } from "./turns.ts";

export interface ChatMessage {
	id?: string;
	type: string;
	content: unknown;
	additional_kwargs?: {
		reasoning_content?: unknown;
		meta?: unknown;
		display?: unknown;
		ui?: unknown;
		asks?: unknown;
		prose?: unknown;
		failed?: unknown;
		source?: unknown;
		results?: unknown;
	};
}

export interface StepMeta {
	at?: string;
	durationMs?: number;
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
	const fired = firedMemories(value);
	return fired.length > 0 ? fired : undefined;
}

function parseMeta(value: unknown): StepMeta | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const durationMs = num(raw.durationMs);
	const memories = parseMemories(raw.memories);
	if (durationMs === undefined && memories === undefined) return undefined;
	return {
		at: typeof raw.at === "string" ? raw.at : undefined,
		durationMs,
		provider: text(raw.provider),
		model: text(raw.model),
		inputTokens: num(raw.inputTokens),
		outputTokens: num(raw.outputTokens),
		cachedInputTokens: num(raw.cachedInputTokens),
		steps: num(raw.steps),
		memories,
	};
}

export interface ChatSession {
	messages: ChatMessage[];
	saved: ChatMessage[];
	queued: QueuedMessage[];
	greeting: string | null;
	meta: Record<string, StepMeta>;
	fresh: boolean;
	isLoading: boolean;
	chatId: Id<"chats"> | null;
	workspaceId: Id<"workspaces">;
	error?: string;
	send: (text: string) => void;
	sendAbout: (file: OpenFile, text: string) => void;
	resume: (event: SystemEventTicket) => void;
	stop: () => void;
	withdraw: (id: string) => void;
	fail: (message: string) => void;
}

type StoredMessage = FunctionReturnType<typeof api.messages.transcript>[number];

function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
	return stored.map((message) => ({
		id: message.wireId ?? message._id,
		type: message.type,
		content: message.content,
		additional_kwargs: message.kwargs,
	}));
}

function greetingMessage(): ChatMessage {
	return { id: GREETING_ID, type: "ai", content: pickGreeting(new Date()) };
}

export type ChatStore = UseBoundStore<StoreApi<ChatSession>>;

const ChatContext = createContext<ChatStore | null>(null);

const abandoning = new Set<(chatId: Id<"chats">) => void>();

export function abandonChat(chatId: Id<"chats">): void {
	for (const abandon of abandoning) abandon(chatId);
}

function titleOf(message: string): string {
	const line = message.trim().split("\n")[0] ?? "";
	return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

function errorFor(
	chatId: Id<"chats"> | null,
	sources: {
		stream: unknown;
		streamingFor: Id<"chats"> | null;
		failure: { chatId: Id<"chats"> | null; message: string } | null;
	},
): string | undefined {
	const { stream, streamingFor, failure } = sources;
	if (stream && streamingFor === chatId)
		return stream instanceof Error ? stream.message : String(stream);
	if (failure?.chatId === chatId) return failure.message;
	return undefined;
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
	const startChat = useConvexMutation(api.chats.start);
	const settleChat = useConvexMutation(api.chats.settle);
	const markStreaming = useMemo(
		() =>
			startChat.withOptimisticUpdate((store, { chatId: started }) => {
				for (const { args, value } of store.getAllQueries(api.chats.list)) {
					if (value === undefined) continue;
					store.setQuery(api.chats.list, args, {
						...value,
						chats: value.chats.map((chat) =>
							chat._id === started
								? { ...chat, status: "streaming" as const, failure: undefined }
								: chat,
						),
					});
				}
			}),
		[startChat],
	);
	const transport = useMemo(
		() =>
			new FetchStreamTransport({
				apiUrl: "/api/chat",
				onRequest: async (_url, init) => ({
					...init,
					headers: { ...init.headers, ...(await apiHeaders()) },
				}),
			}),
		[],
	);
	const stream = useStream({ transport });
	const streamed: ChatMessage[] = stream.messages;
	const streamingFor = useRef<Id<"chats"> | null>(null);

	const { data: stored } = useQuery(
		convexQuery(api.messages.transcript, chatId ? { chatId } : "skip"),
	);
	const persisted = useMemo(() => toChatMessages(stored ?? []), [stored]);

	useEffect(() => {
		if (stream.error)
			reportIssue(stream.error, {
				$exception_source: "chat stream",
				thread_id: chatId ?? "draft",
			});
	}, [stream.error, chatId]);

	useEffect(() => {
		const failed = streamingFor.current;
		if (!stream.error || failed === null) return;
		settleChat({
			chatId: failed,
			failure:
				stream.error instanceof Error
					? stream.error.message
					: String(stream.error),
		}).catch((ex: unknown) =>
			reportIssue(ex, { $exception_source: "chat settle", thread_id: failed }),
		);
	}, [stream.error, settleChat]);

	const [greeting, setGreeting] = useState<ChatMessage | null>(null);
	useEffect(() => {
		setGreeting(greetingMessage());
	}, []);

	const [failure, setFailure] = useState<{
		chatId: Id<"chats"> | null;
		message: string;
	} | null>(null);

	const turns =
		streamingFor.current === chatId
			? turnsToShow(streamed, persisted, stream.isLoading)
			: persisted;

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

	const submit = useCallback(
		async (
			input: { message: string } | { event: { token: string } },
			shown: ChatMessage,
			title: string,
		) => {
			setFailure(null);
			const opened = chatId ?? (await createChat({ workspaceId, title }));
			streamingFor.current = opened;
			markStreaming({ chatId: opened }).catch((ex: unknown) =>
				reportIssue(ex, { $exception_source: "chat start", thread_id: opened }),
			);
			stream.submit(
				{ chatId: opened, ...input },
				{ optimisticValues: { messages: [...persisted, shown] } },
			);
			if (!chatId) {
				await navigate({
					to: "/$workspaceId/chat/$chatId",
					params: { workspaceId, chatId: opened },
					replace: true,
				});
			}
		},
		[
			chatId,
			workspaceId,
			createChat,
			markStreaming,
			navigate,
			persisted,
			stream,
		],
	);

	const submitTurn = useCallback(
		async (text: string, title = titleOf(text)) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			await submit(
				{ message: trimmed },
				{ type: "human", content: trimmed, id: crypto.randomUUID() },
				title,
			);
		},
		[submit],
	);

	const sendAbout = useCallback(
		async (file: OpenFile, text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			await submitTurn(fileContext(file, trimmed), titleOf(trimmed));
		},
		[submitTurn],
	);

	const resume = useCallback(
		(event: SystemEventTicket) =>
			void submit(
				{ event: { token: event.token } },
				systemMessage(event),
				titleOf(event.text),
			),
		[submit],
	);

	const resend = useCallback(
		(text: string) => void submitTurn(text),
		[submitTurn],
	);
	const { queued, enqueue, withdraw, clear } = useSteerQueue({
		chatId,
		landed: streamed,
		streaming: stream.isLoading,
		resend,
	});
	const steering = stream.isLoading && streamingFor.current === chatId;

	const send = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (steering && trimmed) enqueue(trimmed);
			else await submitTurn(trimmed);
		},
		[steering, enqueue, submitTurn],
	);

	const halt = useCallback(() => {
		clear();
		stream.stop();
	}, [stream, clear]);

	const stop = useCallback(() => {
		const stopped = streamingFor.current;
		if (stream.isLoading && stopped !== null)
			settleChat({ chatId: stopped }).catch((ex: unknown) =>
				reportIssue(ex, {
					$exception_source: "chat settle",
					thread_id: stopped,
				}),
			);
		halt();
	}, [stream, halt, settleChat]);

	const abandon = useCallback(
		(target: Id<"chats">) => {
			if (streamingFor.current === target) halt();
		},
		[halt],
	);

	const fresh = isFreshChat(chatId, turns);

	const storeRef = useRef<ChatStore | null>(null);
	if (storeRef.current === null) {
		storeRef.current = create<ChatSession>(() => ({
			messages: [],
			saved: [],
			queued: [],
			greeting: null,
			meta: {},
			fresh,
			isLoading: false,
			chatId,
			workspaceId,
			send: () => {},
			sendAbout: () => {},
			resume: () => {},
			stop: () => {},
			withdraw: () => {},
			fail: () => {},
		}));
	}
	const store = storeRef.current;

	useEffect(() => {
		store.setState({
			messages,
			saved: persisted,
			queued,
			meta,
			greeting: greeting ? messageText(greeting) : null,
			fresh,
			isLoading: stream.isLoading,
			chatId,
			workspaceId,
			error: errorFor(chatId, {
				stream: stream.error,
				streamingFor: streamingFor.current,
				failure,
			}),
			send: (text) => {
				void send(text);
			},
			sendAbout: (file, text) => {
				void sendAbout(file, text);
			},
			resume,
			stop,
			withdraw,
			fail: (message) => setFailure({ chatId, message }),
		});
	}, [
		store,
		messages,
		persisted,
		queued,
		meta,
		greeting,
		fresh,
		stream.isLoading,
		stream.error,
		failure,
		chatId,
		workspaceId,
		send,
		sendAbout,
		resume,
		stop,
		withdraw,
	]);

	useEffect(() => {
		abandoning.add(abandon);
		return () => {
			abandoning.delete(abandon);
		};
	}, [abandon]);

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

export function isSystemMessage(message: ChatMessage): boolean {
	return message.type === "system";
}

export function systemSource(message: ChatMessage): string | undefined {
	const source = message.additional_kwargs?.source;
	return typeof source === "string" && source !== "" ? source : undefined;
}

function systemMessage(event: SystemEventTicket): ChatMessage {
	return {
		type: "system",
		content: event.text,
		id: crypto.randomUUID(),
		additional_kwargs: { source: event.source },
	};
}

export function isUserMessage(message: ChatMessage): boolean {
	return message.type === "human" || message.type === "user";
}

export function messageProse(message: ChatMessage): Skipped[] {
	const prose = message.additional_kwargs?.prose;
	return Array.isArray(prose) ? prose.filter(isSkipped) : [];
}

function isSkipped(value: unknown): value is Skipped {
	if (typeof value !== "object" || value === null) return false;
	const { span, reason } = value as { span?: unknown; reason?: unknown };
	return (
		typeof reason === "string" &&
		Array.isArray(span) &&
		span.length === 2 &&
		typeof span[0] === "number" &&
		typeof span[1] === "number"
	);
}

export function toolFailed(message: ChatMessage): boolean {
	return message.additional_kwargs?.failed === true;
}

export function toolResults(message: ChatMessage): string[] {
	const results = message.additional_kwargs?.results;
	return Array.isArray(results)
		? results.filter((r): r is string => typeof r === "string")
		: [];
}

export function toolUi(message: ChatMessage): unknown {
	return message.additional_kwargs?.ui;
}

export function toolAsks(message: ChatMessage): Ask[] {
	return asksOf(message.additional_kwargs);
}

export function toolAnswers(
	message: ChatMessage,
): ReadonlyMap<string, Answered> {
	return answersOf(message.additional_kwargs);
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
						? String(part.text)
						: "",
			)
			.join("");
	}
	return "";
}
