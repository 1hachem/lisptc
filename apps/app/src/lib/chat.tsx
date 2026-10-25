import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type { FiredMemory } from "@repo/components";
import {
	memoriesKey,
	readAnnotation,
	type ViewNode,
	viewKey,
} from "@repo/interpreter/annotations";
import type { Answered, Ask } from "@repo/interpreter/asks";
import type { Skipped } from "@repo/shared/lisp-forms";
import { envelopeOf, type MessageKwargs } from "@repo/shared/messages";
import { useQuery } from "@tanstack/react-query";
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
import { answersOf, asksOf } from "./asks.ts";
import { fileContext, type OpenFile } from "./files.ts";
import { GREETING_ID, pickGreeting } from "./greeting.ts";
import { type QueuedMessage, useSteerQueue } from "./steer-queue.ts";
import { isFreshChat, turnsToShow } from "./turns.ts";

export interface ChatMessage {
	id?: string;
	type: string;
	content: unknown;
	additional_kwargs?: MessageKwargs;
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

function named(value: string | undefined): string | undefined {
	return value === "" ? undefined : value;
}

function parseMeta(message: ChatMessage): StepMeta | undefined {
	const { meta } = envelopeOf(message.additional_kwargs);
	if (meta === undefined) return undefined;
	const fired = readAnnotation(meta, memoriesKey);
	const memories = fired === undefined ? undefined : [...fired];
	if (meta.durationMs === undefined && memories === undefined) return undefined;
	return {
		at: meta.at,
		durationMs: meta.durationMs,
		provider: named(meta.provider),
		model: named(meta.model),
		inputTokens: meta.inputTokens,
		outputTokens: meta.outputTokens,
		cachedInputTokens: meta.cachedInputTokens,
		steps: meta.steps,
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
	draftChatId: Id<"chats"> | null;
	workspaceId: Id<"workspaces">;
	error?: string;
	send: (
		text: string,
		annotations?: Record<string, unknown>,
	) => Promise<boolean>;
	sendAbout: (
		file: OpenFile,
		text: string,
		annotations?: Record<string, unknown>,
	) => Promise<boolean>;
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

function withGreeting(
	greeting: ChatMessage | null,
	turns: ChatMessage[],
): ChatMessage[] {
	if (greeting === null || turns.some((m) => m.id === GREETING_ID))
		return turns;
	return [greeting, ...turns];
}

function greetingText(greeting: ChatMessage | null): string | null {
	return greeting === null ? null : messageText(greeting);
}

function useGreeting(): ChatMessage | null {
	const [greeting, setGreeting] = useState<ChatMessage | null>(null);
	useEffect(() => {
		setGreeting(greetingMessage());
	}, []);
	return greeting;
}

function freshMeta(
	known: Readonly<Record<string, StepMeta>>,
	message: ChatMessage,
): StepMeta | undefined {
	if (!message.id || known[message.id]?.memories) return undefined;
	const parsed = parseMeta(message);
	if (parsed && known[message.id] && !parsed.memories) return undefined;
	return parsed;
}

function newMeta(
	known: Readonly<Record<string, StepMeta>>,
	turns: readonly ChatMessage[],
): Record<string, StepMeta> {
	const found: Record<string, StepMeta> = {};
	for (const message of turns) {
		const parsed = freshMeta(known, message);
		if (parsed && message.id) found[message.id] = parsed;
	}
	return found;
}

function useTurnMeta(turns: ChatMessage[]): Record<string, StepMeta> {
	const [meta, setMeta] = useState<Record<string, StepMeta>>({});
	useEffect(() => {
		const found = newMeta(meta, turns);
		if (Object.keys(found).length > 0)
			setMeta((prev) => ({ ...prev, ...found }));
	}, [turns, meta]);
	return meta;
}

function useDrafted(
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats"> | null,
): Id<"chats"> | null {
	const draftChat = useConvexMutation(api.chats.draft);
	const [drafted, setDrafted] = useState<Id<"chats"> | null>(null);
	useEffect(() => {
		setDrafted(null);
		if (chatId !== null) return;
		let current = true;
		draftChat({ workspaceId })
			.then((draft) => {
				if (current) setDrafted(draft);
			})
			.catch((ex: unknown) =>
				reportIssue(ex, { $exception_source: "chat draft" }),
			);
		return () => {
			current = false;
		};
	}, [chatId, workspaceId, draftChat]);
	return drafted;
}

function useMarkStreaming() {
	const startChat = useConvexMutation(api.chats.start);
	return useMemo(
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
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function useStreamFailure(
	error: unknown,
	chatId: Id<"chats"> | null,
	streamingFor: { readonly current: Id<"chats"> | null },
): void {
	const settleChat = useConvexMutation(api.chats.settle);
	useEffect(() => {
		if (error)
			reportIssue(error, {
				$exception_source: "chat stream",
				thread_id: chatId ?? "draft",
			});
	}, [error, chatId]);

	useEffect(() => {
		const failed = streamingFor.current;
		if (!error || failed === null) return;
		settleChat({ chatId: failed, failure: messageOf(error) }).catch(
			(ex: unknown) =>
				reportIssue(ex, {
					$exception_source: "chat settle",
					thread_id: failed,
				}),
		);
	}, [error, settleChat, streamingFor]);
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

function reported(source: string, thread: string) {
	return (ex: unknown) =>
		reportIssue(ex, { $exception_source: source, thread_id: thread });
}

function isEmptyTurn(
	trimmed: string,
	annotations: Record<string, unknown> | undefined,
): boolean {
	return trimmed === "" && annotations === undefined;
}

function turnInput(
	message: string,
	annotations: Record<string, unknown> | undefined,
): { message: string; annotations?: Record<string, unknown> } {
	return annotations === undefined ? { message } : { message, annotations };
}

function humanMessage(
	content: string,
	annotations: Record<string, unknown> | undefined,
): ChatMessage {
	const message: ChatMessage = {
		type: "human",
		content,
		id: crypto.randomUUID(),
	};
	return annotations === undefined
		? message
		: { ...message, additional_kwargs: annotations };
}

function useChatStream() {
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
	return useStream({ transport });
}

function useHalt(
	stream: { isLoading: boolean; stop: () => unknown },
	streamingFor: { readonly current: Id<"chats"> | null },
	clear: () => void,
	settleChat: (args: { chatId: Id<"chats"> }) => Promise<unknown>,
) {
	const halt = useCallback(() => {
		clear();
		stream.stop();
	}, [stream, clear]);

	const stop = useCallback(() => {
		const stopped = streamingFor.current;
		if (stream.isLoading && stopped !== null)
			settleChat({ chatId: stopped }).catch(reported("chat settle", stopped));
		halt();
	}, [stream, halt, settleChat, streamingFor]);

	const abandon = useCallback(
		(target: Id<"chats">) => {
			if (streamingFor.current === target) halt();
		},
		[halt, streamingFor],
	);
	return { stop, abandon };
}

type Failure = { chatId: Id<"chats"> | null; message: string } | null;

type TurnInput = { message: string; annotations?: Record<string, unknown> };

function useSubmit(
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats"> | null,
	stream: ReturnType<typeof useChatStream>,
	streamingFor: { current: Id<"chats"> | null },
	persisted: ChatMessage[],
	setFailure: (failure: Failure) => void,
	announce: { readonly current: (chatId: Id<"chats">) => void },
) {
	const draftChat = useConvexMutation(api.chats.draft);
	const renameChat = useConvexMutation(api.chats.rename);
	const markStreaming = useMarkStreaming();
	return useCallback(
		async (input: TurnInput, shown: ChatMessage, title: string) => {
			setFailure(null);
			const opened = chatId ?? (await draftChat({ workspaceId }));
			if (chatId === null && title.trim() !== "")
				renameChat({ chatId: opened, title }).catch(
					reported("chat title", opened),
				);
			streamingFor.current = opened;
			markStreaming({ chatId: opened }).catch(reported("chat start", opened));
			stream.submit(
				{ chatId: opened, ...input },
				{ optimisticValues: { messages: [...persisted, shown] } },
			);
			if (chatId === null) announce.current(opened);
		},
		[
			chatId,
			workspaceId,
			draftChat,
			renameChat,
			markStreaming,
			persisted,
			stream,
			streamingFor,
			setFailure,
			announce,
		],
	);
}

function useTurnSend(
	chatId: Id<"chats"> | null,
	submit: (
		input: TurnInput,
		shown: ChatMessage,
		title: string,
	) => Promise<void>,
	setFailure: (failure: Failure) => void,
) {
	const submitTurn = useCallback(
		async (
			text: string,
			title = titleOf(text),
			annotations?: Record<string, unknown>,
		): Promise<boolean> => {
			const trimmed = text.trim();
			if (isEmptyTurn(trimmed, annotations)) return true;
			try {
				await submit(
					turnInput(trimmed, annotations),
					humanMessage(trimmed, annotations),
					title,
				);
				return true;
			} catch (ex: unknown) {
				reportIssue(ex, { $exception_source: "chat send" });
				setFailure({ chatId, message: "message not sent, try again" });
				return false;
			}
		},
		[submit, chatId, setFailure],
	);

	const sendAbout = useCallback(
		async (
			file: OpenFile,
			text: string,
			annotations?: Record<string, unknown>,
		) => {
			const trimmed = text.trim();
			if (isEmptyTurn(trimmed, annotations)) return true;
			return await submitTurn(
				fileContext(file, trimmed),
				titleOf(trimmed || file.path),
				annotations,
			);
		},
		[submitTurn],
	);

	return { submitTurn, sendAbout };
}

function usePersisted(chatId: Id<"chats"> | null): ChatMessage[] {
	const { data: stored } = useQuery(
		convexQuery(api.messages.transcript, chatId ? { chatId } : "skip"),
	);
	return useMemo(() => toChatMessages(stored ?? []), [stored]);
}

function shownTurns(
	streamingHere: boolean,
	streamed: ChatMessage[],
	persisted: ChatMessage[],
	loading: boolean,
): ChatMessage[] {
	return streamingHere ? turnsToShow(streamed, persisted, loading) : persisted;
}

function useSend(
	steering: boolean,
	enqueue: (text: string) => void,
	submitTurn: (
		text: string,
		title?: string,
		annotations?: Record<string, unknown>,
	) => Promise<boolean>,
) {
	return useCallback(
		async (text: string, annotations?: Record<string, unknown>) => {
			const trimmed = text.trim();
			if (!steering || !trimmed || annotations !== undefined)
				return await submitTurn(trimmed, undefined, annotations);
			enqueue(trimmed);
			return true;
		},
		[steering, enqueue, submitTurn],
	);
}

function useSessionStore(
	fresh: boolean,
	chatId: Id<"chats"> | null,
	workspaceId: Id<"workspaces">,
): ChatStore {
	const [store] = useState(() =>
		create<ChatSession>(() => ({
			messages: [],
			saved: [],
			queued: [],
			greeting: null,
			meta: {},
			fresh,
			isLoading: false,
			chatId,
			draftChatId: null,
			workspaceId,
			send: () => Promise.resolve(false),
			sendAbout: () => Promise.resolve(false),
			stop: () => {},
			withdraw: () => {},
			fail: () => {},
		})),
	);
	return store;
}

export function ChatProvider({
	workspaceId,
	chatId,
	onOpened,
	children,
}: {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats"> | null;
	onOpened: (chatId: Id<"chats">) => void;
	children: React.ReactNode;
}) {
	const announce = useRef(onOpened);
	announce.current = onOpened;
	const drafted = useDrafted(workspaceId, chatId);
	const settleChat = useConvexMutation(api.chats.settle);
	const stream = useChatStream();
	const streamed: ChatMessage[] = stream.messages;
	const streamingFor = useRef<Id<"chats"> | null>(null);

	const persisted = usePersisted(chatId);

	useStreamFailure(stream.error, chatId, streamingFor);

	const greeting = useGreeting();

	const [failure, setFailure] = useState<Failure>(null);

	const turns = shownTurns(
		streamingFor.current === chatId,
		streamed,
		persisted,
		stream.isLoading,
	);

	const messages = useMemo(
		() => withGreeting(greeting, turns),
		[greeting, turns],
	);
	const meta = useTurnMeta(turns);

	const submit = useSubmit(
		workspaceId,
		chatId,
		stream,
		streamingFor,
		persisted,
		setFailure,
		announce,
	);
	const { submitTurn, sendAbout } = useTurnSend(chatId, submit, setFailure);
	const { queued, enqueue, withdraw, clear } = useSteerQueue({
		chatId,
		landed: streamed,
		streaming: stream.isLoading,
	});
	const send = useSend(
		stream.isLoading && streamingFor.current === chatId,
		enqueue,
		submitTurn,
	);

	const { stop, abandon } = useHalt(stream, streamingFor, clear, settleChat);

	const fresh = isFreshChat(chatId, turns);

	const store = useSessionStore(fresh, chatId, workspaceId);

	useEffect(() => {
		store.setState({
			messages,
			saved: persisted,
			queued,
			meta,
			greeting: greetingText(greeting),
			fresh,
			isLoading: stream.isLoading,
			chatId,
			draftChatId: chatId === null ? drafted : null,
			workspaceId,
			error: errorFor(chatId, {
				stream: stream.error,
				streamingFor: streamingFor.current,
				failure,
			}),
			send,
			sendAbout,
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
		drafted,
		workspaceId,
		send,
		sendAbout,
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

export function ChatStoreProvider({
	store,
	children,
}: {
	store: ChatStore;
	children: React.ReactNode;
}) {
	return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>;
}

export function useChatStore(): ChatStore {
	const store = useContext(ChatContext);
	if (!store) {
		throw new Error("useChatStore must be used within a ChatProvider");
	}
	return store;
}

export function messageReasoning(message: ChatMessage): string {
	return envelopeOf(message.additional_kwargs).reasoning_content ?? "";
}

export function isToolMessage(message: ChatMessage): boolean {
	return message.type === "tool";
}

export function isSystemMessage(message: ChatMessage): boolean {
	return message.type === "system";
}

export function isUserMessage(message: ChatMessage): boolean {
	return message.type === "human" || message.type === "user";
}

export function messageProse(message: ChatMessage): Skipped[] {
	return [...(envelopeOf(message.additional_kwargs).prose ?? [])];
}

export function toolFailed(message: ChatMessage): boolean {
	return envelopeOf(message.additional_kwargs).failed === true;
}

export function toolResults(message: ChatMessage): string[] {
	return [...(envelopeOf(message.additional_kwargs).results ?? [])];
}

export function toolUi(message: ChatMessage): ViewNode | undefined {
	return readAnnotation(message.additional_kwargs, viewKey);
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
	const { display } = envelopeOf(message.additional_kwargs);
	try {
		const parsed = JSON.parse(text) as {
			source?: unknown;
			output?: unknown;
			error?: unknown;
		};
		if (parsed?.source === "lisp-repl")
			return {
				output: display ?? String(parsed.output ?? ""),
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
