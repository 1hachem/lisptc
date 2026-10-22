import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import type { FiredMemory } from "@repo/components";
import {
	type ActivityEntry,
	activityKey,
	type Intent,
	intentKey,
	memoriesKey,
	type Question,
	questionKey,
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
import type { SystemEventTicket } from "./system-event.ts";
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

export function stepMeta(message: ChatMessage): StepMeta | undefined {
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
	send: (text: string, annotations?: MessageAnnotations) => void;
	sendAbout: (
		file: OpenFile,
		text: string,
		annotations?: MessageAnnotations,
	) => void;
	resume: (event: SystemEventTicket) => void;
	stop: () => void;
	withdraw: (id: string) => void;
	fail: (message: string) => void;
}

export type StoredMessage = FunctionReturnType<
	typeof api.messages.transcript
>[number];

export type MessageAnnotations = Record<string, unknown>;

const shaped = new WeakMap<StoredMessage, ChatMessage>();

function toChatMessage(message: StoredMessage): ChatMessage {
	const known = shaped.get(message);
	if (known !== undefined) return known;
	const shown: ChatMessage = {
		id: message.wireId ?? message._id,
		type: message.type,
		content: message.content,
		additional_kwargs: message.kwargs,
	};
	shaped.set(message, shown);
	return shown;
}

export function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
	return stored.map(toChatMessage);
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

function useDraftedChat(
	chatId: Id<"chats"> | null,
	workspaceId: Id<"workspaces">,
	draftChat: (args: { workspaceId: Id<"workspaces"> }) => Promise<Id<"chats">>,
): Id<"chats"> | null {
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

function useStreamFailure(
	error: unknown,
	chatId: Id<"chats"> | null,
	streamingFor: { readonly current: Id<"chats"> | null },
	settleChat: (args: {
		chatId: Id<"chats">;
		failure?: string;
	}) => Promise<unknown>,
) {
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
		settleChat({
			chatId: failed,
			failure: error instanceof Error ? error.message : String(error),
		}).catch((ex: unknown) =>
			reportIssue(ex, { $exception_source: "chat settle", thread_id: failed }),
		);
	}, [error, settleChat, streamingFor]);
}

function useGreeting(): ChatMessage | null {
	const [greeting, setGreeting] = useState<ChatMessage | null>(null);
	useEffect(() => {
		setGreeting(greetingMessage());
	}, []);
	return greeting;
}

function freshMeta(
	turns: readonly ChatMessage[],
	meta: Record<string, StepMeta>,
): Record<string, StepMeta> {
	const found: Record<string, StepMeta> = {};
	for (const m of turns) {
		if (!m.id) continue;
		const known = meta[m.id];
		if (known?.memories) continue;
		const parsed = stepMeta(m);
		if (!parsed) continue;
		if (known && !parsed.memories) continue;
		found[m.id] = parsed;
	}
	return found;
}

function useStepMeta(turns: readonly ChatMessage[]): Record<string, StepMeta> {
	const [meta, setMeta] = useState<Record<string, StepMeta>>({});
	useEffect(() => {
		const found = freshMeta(turns, meta);
		if (Object.keys(found).length > 0)
			setMeta((prev) => ({ ...prev, ...found }));
	}, [turns, meta]);
	return meta;
}

function useAbandoning(abandon: (target: Id<"chats">) => void) {
	useEffect(() => {
		abandoning.add(abandon);
		return () => {
			abandoning.delete(abandon);
		};
	}, [abandon]);
}

type Stream = ReturnType<typeof useStream>;

function useSubmit({
	chatId,
	workspaceId,
	draftChat,
	renameChat,
	markStreaming,
	persisted,
	stream,
	streamingFor,
	announce,
	setFailure,
}: {
	chatId: Id<"chats"> | null;
	workspaceId: Id<"workspaces">;
	draftChat: (args: { workspaceId: Id<"workspaces"> }) => Promise<Id<"chats">>;
	renameChat: (args: {
		chatId: Id<"chats">;
		title: string;
	}) => Promise<unknown>;
	markStreaming: (args: { chatId: Id<"chats"> }) => Promise<unknown>;
	persisted: ChatMessage[];
	stream: Stream;
	streamingFor: { current: Id<"chats"> | null };
	announce: { readonly current: (chatId: Id<"chats">) => void };
	setFailure: (failure: null) => void;
}) {
	return useCallback(
		async (
			input:
				| { message: string; annotations?: MessageAnnotations }
				| { event: { token: string } },
			shown: ChatMessage,
			title: string,
		) => {
			setFailure(null);
			const opened = chatId ?? (await draftChat({ workspaceId }));
			if (chatId === null && title.trim() !== "")
				renameChat({ chatId: opened, title }).catch((ex: unknown) =>
					reportIssue(ex, {
						$exception_source: "chat title",
						thread_id: opened,
					}),
				);
			streamingFor.current = opened;
			markStreaming({ chatId: opened }).catch((ex: unknown) =>
				reportIssue(ex, { $exception_source: "chat start", thread_id: opened }),
			);
			stream.submit(
				{ chatId: opened, ...input },
				{ optimisticValues: { messages: [...persisted, shown] } },
			);
			if (!chatId) announce.current(opened);
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
			announce,
			setFailure,
		],
	);
}

function useStopping(
	stream: Stream,
	streamingFor: { readonly current: Id<"chats"> | null },
	settleChat: (args: { chatId: Id<"chats"> }) => Promise<unknown>,
	clear: () => void,
) {
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
	}, [stream, halt, settleChat, streamingFor]);

	const abandon = useCallback(
		(target: Id<"chats">) => {
			if (streamingFor.current === target) halt();
		},
		[halt, streamingFor],
	);
	return { stop, abandon };
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
	const draftChat = useConvexMutation(api.chats.draft);
	const renameChat = useConvexMutation(api.chats.rename);
	const drafted = useDraftedChat(chatId, workspaceId, draftChat);
	const settleChat = useConvexMutation(api.chats.settle);
	const markStreaming = useMarkStreaming();
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
		convexQuery(api.messages.light, chatId ? { chatId } : "skip"),
	);
	const persisted = useMemo(() => toChatMessages(stored ?? []), [stored]);

	useStreamFailure(stream.error, chatId, streamingFor, settleChat);

	const greeting = useGreeting();

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

	const meta = useStepMeta(turns);

	const submit = useSubmit({
		chatId,
		workspaceId,
		draftChat,
		renameChat,
		markStreaming,
		persisted,
		stream,
		streamingFor,
		announce,
		setFailure,
	});

	const submitTurn = useCallback(
		async (
			text: string,
			title = titleOf(text),
			annotations?: MessageAnnotations,
		) => {
			const trimmed = text.trim();
			if (!trimmed && annotations === undefined) return;
			await submit(
				{ message: trimmed, ...(annotations ? { annotations } : {}) },
				{
					type: "human",
					content: trimmed,
					id: crypto.randomUUID(),
					...(annotations ? { additional_kwargs: annotations } : {}),
				},
				title,
			);
		},
		[submit],
	);

	const sendAbout = useCallback(
		async (file: OpenFile, text: string, annotations?: MessageAnnotations) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			await submitTurn(
				fileContext(file, trimmed),
				titleOf(trimmed),
				annotations,
			);
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
		async (text: string, annotations?: MessageAnnotations) => {
			const trimmed = text.trim();
			if (steering && trimmed && annotations === undefined) enqueue(trimmed);
			else await submitTurn(trimmed, undefined, annotations);
		},
		[steering, enqueue, submitTurn],
	);

	const { stop, abandon } = useStopping(
		stream,
		streamingFor,
		settleChat,
		clear,
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
			draftChatId: null,
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
			draftChatId: chatId === null ? drafted : null,
			workspaceId,
			error: errorFor(chatId, {
				stream: stream.error,
				streamingFor: streamingFor.current,
				failure,
			}),
			send: (text, annotations) => {
				void send(text, annotations);
			},
			sendAbout: (file, text, annotations) => {
				void sendAbout(file, text, annotations);
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
		drafted,
		workspaceId,
		send,
		sendAbout,
		resume,
		stop,
		withdraw,
	]);

	useAbandoning(abandon);

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

export function messageClassified(message: ChatMessage): boolean {
	return envelopeOf(message.additional_kwargs).prose !== undefined;
}

export function messageProse(message: ChatMessage): Skipped[] {
	return [...(envelopeOf(message.additional_kwargs).prose ?? [])];
}

export function toolQuiet(message: ChatMessage): boolean {
	return envelopeOf(message.additional_kwargs).quiet === true;
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

export function toolActivity(message: ChatMessage): ActivityEntry[] {
	return readAnnotation(message.additional_kwargs, activityKey) ?? [];
}

export function toolIntent(message: ChatMessage): Intent | undefined {
	return readAnnotation(message.additional_kwargs, intentKey);
}

export function toolAsks(message: ChatMessage): Ask[] {
	return asksOf(message.additional_kwargs);
}

export function toolQuestion(message: ChatMessage): Question | undefined {
	return readAnnotation(message.additional_kwargs, questionKey);
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
	const { display, failed } = envelopeOf(message.additional_kwargs);
	return {
		output: display ?? "",
		error: failed === true || toolModelOutput(message).error,
	};
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
