import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
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
import { GREETING_ID, greetingFor, rememberedGreeting } from "./greeting.ts";
import { type QueuedMessage, useSteerQueue } from "./steer-queue.ts";
import { isFreshChat, turnsToShow } from "./turns.ts";
import { shownMessages, useWatch } from "./watch.ts";

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
	greetingTyped: boolean;
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
	stopAll: () => void;
	withdraw: (id: string) => void;
	fail: (message: string) => void;
}

export type StoredMessage = FunctionReturnType<
	typeof api.messages.transcript
>[number];

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

function greetingOf(line: string, typed: boolean): Greeted {
	return { message: { id: GREETING_ID, type: "ai", content: line }, typed };
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

interface Greeted {
	message: ChatMessage | null;
	typed: boolean;
}

function useGreeting(key: string | undefined): Greeted {
	const [greeting, setGreeting] = useState<Greeted>(() => {
		const known = rememberedGreeting(key);
		return known === undefined
			? { message: null, typed: false }
			: greetingOf(known, true);
	});
	useEffect(() => {
		if (greeting.message !== null) return;
		const { line, typed } = greetingFor(key, new Date());
		setGreeting(greetingOf(line, typed));
	}, [greeting, key]);
	return greeting;
}

function freshMeta(
	known: Readonly<Record<string, StepMeta>>,
	message: ChatMessage,
): StepMeta | undefined {
	if (!message.id || known[message.id]?.memories) return undefined;
	const parsed = stepMeta(message);
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
	failed: string | undefined,
	failure: Failure,
): string | undefined {
	if (failure?.chatId === chatId) return failure.message;
	return failed;
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

async function postTo(path: string, body: unknown): Promise<Response> {
	return await fetch(path, {
		method: "POST",
		headers: await apiHeaders(),
		body: JSON.stringify(body),
	});
}

async function postTurn(
	chatId: Id<"chats">,
	id: string,
	input: TurnInput,
): Promise<void> {
	const response = await postTo("/api/chat", {
		input: { chatId, id, ...input },
	});
	if (!response.ok)
		throw new Error(`the message was refused: ${response.status}`);
}

export type StopScope = "thread" | "tree";

export function stopChat(chatId: string, scope: StopScope): void {
	postTo("/api/chat/stop", { chatId, scope }).catch(
		reported("chat stop", chatId),
	);
}

function useHalt(chatId: Id<"chats"> | null, clear: () => void) {
	const halt = useCallback(
		(scope: StopScope) => {
			clear();
			if (chatId !== null) stopChat(chatId, scope);
		},
		[chatId, clear],
	);

	const stop = useCallback(() => halt("thread"), [halt]);

	const stopAll = useCallback(() => halt("tree"), [halt]);

	const abandon = useCallback(
		(target: Id<"chats">) => {
			if (target === chatId) stopAll();
		},
		[chatId, stopAll],
	);
	return { stop, stopAll, abandon };
}

type Failure = { chatId: Id<"chats"> | null; message: string } | null;

type TurnInput = { message: string; annotations?: Record<string, unknown> };

interface Pending {
	readonly chatId: Id<"chats">;
	readonly message: ChatMessage;
}

function useSubmit(
	workspaceId: Id<"workspaces">,
	chatId: Id<"chats"> | null,
	setPending: (pending: Pending | null) => void,
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
			markStreaming({ chatId: opened }).catch(reported("chat start", opened));
			setPending({ chatId: opened, message: shown });
			try {
				await postTurn(opened, shown.id ?? crypto.randomUUID(), input);
			} catch (error) {
				setPending(null);
				throw error;
			}
			if (chatId === null) announce.current(opened);
		},
		[
			chatId,
			workspaceId,
			draftChat,
			renameChat,
			markStreaming,
			setPending,
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

export interface Briefed {
	_id: string;
	parentChatId?: string;
	agent?: { prompt: string };
}

export function briefingOf(chat: Briefed | undefined): ChatMessage[] {
	if (chat?.agent === undefined || chat.parentChatId === undefined) return [];
	return [
		{
			id: `briefing:${chat._id}`,
			type: "system",
			content: chat.agent.prompt,
			additional_kwargs: { source: `agent:${chat.parentChatId}` },
		},
	];
}

export function parentSourceOf(
	briefing: readonly ChatMessage[],
): string | undefined {
	const [opening] = briefing;
	return opening && envelopeOf(opening.additional_kwargs).source;
}

export function useAgentSender(
	message: ChatMessage,
	chatId: Id<"chats"> | null,
	parentSource: string | undefined,
): { parent: boolean; name: string; failed: boolean } {
	const envelope = envelopeOf(message.additional_kwargs);
	const source = envelope.source ?? "";
	const failed = envelope.failed === true;
	const sender = source.slice("agent:".length);
	const { data: children } = useQuery(
		convexQuery(api.chats.children, chatId ? { chatId } : "skip"),
	);
	if (source === parentSource || sender === chatId)
		return { parent: true, name: "parent agent", failed };
	const name = children?.find((child) => child._id === sender)?.title;
	return { parent: false, name: name ?? sender, failed };
}

export function useBriefing(chatId: Id<"chats"> | null): ChatMessage[] {
	const { data: chat } = useQuery(
		convexQuery(api.chats.get, chatId ? { chatId } : "skip"),
	);
	return useMemo(() => briefingOf(chat), [chat]);
}

function usePersisted(chatId: Id<"chats"> | null): ChatMessage[] {
	const { data: stored } = useQuery(
		convexQuery(api.messages.light, chatId ? { chatId } : "skip"),
	);
	return useMemo(() => toChatMessages(stored ?? []), [stored]);
}

function withPending(
	turns: ChatMessage[],
	pending: Pending | null,
	chatId: Id<"chats"> | null,
): ChatMessage[] {
	if (pending === null || (chatId !== null && pending.chatId !== chatId))
		return turns;
	if (turns.some((message) => message.id === pending.message.id)) return turns;
	return [...turns, pending.message];
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
			greetingTyped: false,
			meta: {},
			fresh,
			isLoading: false,
			chatId,
			draftChatId: null,
			workspaceId,
			send: () => Promise.resolve(false),
			sendAbout: () => Promise.resolve(false),
			stop: () => {},
			stopAll: () => {},
			withdraw: () => {},
			fail: () => {},
		})),
	);
	return store;
}

function usePending(chatId: Id<"chats"> | null) {
	const [pending, setPending] = useState<Pending | null>(null);
	useEffect(() => {
		if (chatId === null) setPending(null);
	}, [chatId]);
	return [pending, setPending] as const;
}

function useAbandoning(abandon: (chatId: Id<"chats">) => void) {
	useEffect(() => {
		abandoning.add(abandon);
		return () => {
			abandoning.delete(abandon);
		};
	}, [abandon]);
}

export function ChatProvider({
	workspaceId,
	chatId,
	onOpened,
	greetingKey,
	children,
}: {
	workspaceId: Id<"workspaces">;
	chatId: Id<"chats"> | null;
	onOpened: (chatId: Id<"chats">) => void;
	greetingKey?: string;
	children: React.ReactNode;
}) {
	const announce = useRef(onOpened);
	announce.current = onOpened;
	const drafted = useDrafted(workspaceId, chatId);
	const watched = useWatch(chatId);
	const streamed = useMemo(() => shownMessages(watched), [watched]);
	const running = watched.status === "running";

	const persisted = usePersisted(chatId);

	const greeting = useGreeting(greetingKey);

	const [failure, setFailure] = useState<Failure>(null);
	const [pending, setPending] = usePending(chatId);

	const turns = useMemo(
		() =>
			withPending(turnsToShow(streamed, persisted, running), pending, chatId),
		[streamed, persisted, running, pending, chatId],
	);

	const messages = useMemo(
		() => withGreeting(greeting.message, turns),
		[greeting, turns],
	);
	const meta = useTurnMeta(turns);

	const submit = useSubmit(
		workspaceId,
		chatId,
		setPending,
		setFailure,
		announce,
	);
	const { submitTurn, sendAbout } = useTurnSend(chatId, submit, setFailure);
	const { queued, enqueue, withdraw, clear } = useSteerQueue({
		chatId,
		landed: streamed,
		streaming: running,
	});
	const send = useSend(running, enqueue, submitTurn);

	const { stop, stopAll, abandon } = useHalt(chatId, clear);

	const fresh = isFreshChat(chatId, turns);

	const store = useSessionStore(fresh, chatId, workspaceId);

	useEffect(() => {
		store.setState({
			messages,
			saved: persisted,
			queued,
			meta,
			greeting: greetingText(greeting.message),
			greetingTyped: greeting.typed,
			fresh,
			isLoading: running,
			chatId,
			draftChatId: chatId === null ? drafted : null,
			workspaceId,
			error: errorFor(
				chatId,
				watched.status === "errored" ? watched.failure : undefined,
				failure,
			),
			send,
			sendAbout,
			stop,
			stopAll,
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
		running,
		watched,
		failure,
		chatId,
		drafted,
		workspaceId,
		send,
		sendAbout,
		stop,
		stopAll,
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

export function isUserMessage(message: ChatMessage): boolean {
	return message.type === "human" || message.type === "user";
}

export function isParentMessage(message: ChatMessage): boolean {
	return (
		isSystemMessage(message) &&
		(envelopeOf(message.additional_kwargs).source?.startsWith("agent:") ??
			false)
	);
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
