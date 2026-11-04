import { HugeiconsIcon } from "@hugeicons/react";
import { MessageMemories } from "@repo/components";
import type { Progress } from "@repo/interpreter/annotations";
import { formsIn } from "@repo/syntax";
import { Conversation, ConversationContent } from "@repo/ui";
import { anchorOf, contentRegion } from "@repo/ui-catalog";
import {
	createContext,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import {
	type AgentStatus,
	agentStatus,
	pickStatusLine,
} from "../lib/agent-status.ts";
import { askText } from "../lib/asks.ts";
import { attachedTo } from "../lib/attached-files.ts";
import {
	type ChannelId,
	channelOf,
	EVERY_CHANNEL,
	type Shown,
} from "../lib/channels.ts";
import {
	type ChatMessage,
	isParentMessage,
	isSystemMessage,
	isToolMessage,
	isUserMessage,
	messageClassified,
	messageProse,
	messageReasoning,
	messageText,
	parentSourceOf,
	type StepMeta,
	toolAnswers,
	toolAsks,
	toolFailed,
	toolFailure,
	toolModelOutput,
	toolQuestion,
	toolResult,
	toolResults,
	toolUi,
	useAgentSender,
	useBriefing,
	useChatSession,
} from "../lib/chat.tsx";
import { isGreetingMessage } from "../lib/greeting.ts";
import { useModelPicker } from "../lib/model-picker.tsx";
import { traceOpen } from "../lib/panel-ops.ts";
import { usePanels } from "../lib/panels.tsx";
import { useTraceLink } from "../lib/preferences.ts";
import { openQuestion, questionText } from "../lib/question.ts";
import { useSideTrace } from "../lib/side-trace.tsx";
import {
	groupTurns,
	latestTodos,
	shapeTurn,
	type Turn,
	turnMessages,
} from "../lib/turn-groups.ts";
import { placeTimeline, type TimelineEntry } from "../lib/turn-timeline.ts";
import { useUI } from "../lib/ui.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import { AskCard } from "./ask-card.tsx";
import { AttachedFiles } from "./attached-files.tsx";
import { GenerativeUI } from "./generative-ui.tsx";
import { LispSource, SkippedProse } from "./lisp-text.tsx";
import { Markdown } from "./markdown.tsx";
import { MessageFeedback } from "./message-feedback.tsx";
import { MessageMeta } from "./message-meta.tsx";
import { SteerQueue } from "./steer-queue.tsx";
import { TodoCard } from "./todo-card.tsx";
import { CallTimeline, ProgressBar } from "./turn-intent.tsx";
import { UserLine } from "./user-line.tsx";

const CHAT_FOLD = { lines: 25, chars: Number.POSITIVE_INFINITY };
const TRACE_FOLD = { lines: 6, chars: 480 };
const PAGE_LINES = 200;

const Traced = createContext(false);

function Marked({
	id,
	tone,
	children,
}: {
	id: ChannelId;
	tone?: string;
	children: React.ReactNode;
}) {
	const { icon, label, text } = channelOf(id);
	return (
		<div data-channel={id} className="flex min-w-0 gap-2">
			<HugeiconsIcon
				icon={icon}
				aria-label={label}
				className={`size-icon-sm mt-[3px] flex-none ${tone ?? text}`}
			/>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

const ParentSource = createContext<string | undefined>(undefined);

function foldOf(text: string, fold: { lines: number; chars: number }) {
	const head = text.split("\n").slice(0, fold.lines).join("\n");
	return head.length > fold.chars ? head.slice(0, fold.chars) : head;
}

function ChannelBody({ text, code }: { text: string; code: boolean }) {
	if (!code) return <Markdown>{text}</Markdown>;
	return (
		<pre className="whitespace-pre-wrap break-words font-mono">
			<LispSource>{text}</LispSource>
		</pre>
	);
}

function ChannelText({
	text,
	tone,
	code = false,
}: {
	text: string;
	tone: string;
	code?: boolean;
}) {
	const traced = useContext(Traced);
	const [expanded, setExpanded] = useState(false);
	const [page, setPage] = useState(0);
	const head = foldOf(text, traced ? TRACE_FOLD : CHAT_FOLD);
	const long = head.length < text.length;
	const folded = long && !expanded;
	const lines = text.split("\n");
	const pages = Math.ceil(lines.length / PAGE_LINES);
	const paged = !folded && pages > 1;
	const shown = folded
		? `${head}…`
		: paged
			? lines.slice(page * PAGE_LINES, (page + 1) * PAGE_LINES).join("\n")
			: text;
	const step = (by: number) =>
		setPage((p) => Math.min(pages - 1, Math.max(0, p + by)));
	return (
		<div className={`min-w-0 break-words ${tone}`}>
			<div
				{...contentRegion}
				className={expanded ? "max-h-[60vh] overflow-y-auto" : undefined}
			>
				<ChannelBody text={shown} code={code} />
			</div>
			{long && (
				<div
					{...anchorOf("chat/read-more")}
					className="mt-1 flex items-center gap-3 text-dim"
				>
					<button
						type="button"
						data-read-more
						onClick={() => {
							setExpanded(!expanded);
							setPage(0);
						}}
						className="underline decoration-dim/40 hover:text-fg"
					>
						{folded ? "read more" : "read less"}
					</button>
					{paged && (
						<span className="flex items-center gap-2">
							<button
								type="button"
								disabled={page === 0}
								onClick={() => step(-1)}
								className="hover:text-fg disabled:opacity-30"
							>
								‹
							</button>
							<span>
								{page + 1}/{pages}
							</span>
							<button
								type="button"
								disabled={page === pages - 1}
								onClick={() => step(1)}
								className="hover:text-fg disabled:opacity-30"
							>
								›
							</button>
						</span>
					)}
				</div>
			)}
		</div>
	);
}

const ShownChannels = createContext<Shown | null>(null);

export function ChannelsShown({
	shown,
	children,
}: {
	shown: Shown;
	children: ReactNode;
}) {
	return (
		<ShownChannels.Provider value={shown}>
			<Traced.Provider value>{children}</Traced.Provider>
		</ShownChannels.Provider>
	);
}

export function useChannels(): Shown {
	return useContext(ShownChannels) ?? EVERY_CHANNEL;
}

function toolOutput(message: ChatMessage): string {
	return [toolResult(message).output, ...toolResults(message)]
		.filter((part) => part !== "")
		.join("\n");
}

function ToolResult({ message }: { message: ChatMessage }) {
	const shown = useChannels();
	const output = shown.output ? toolOutput(message) : "";
	const model = shown.model ? toolModelOutput(message).output : "";
	const ui = shown.ui ? toolUi(message) : undefined;
	const attachments = shown.attachments ? attachedTo(message) : [];
	if (ui === undefined && attachments.length === 0 && !output && !model)
		return null;
	const failed = toolFailed(message);
	const modelTone = failed ? "text-red" : channelOf("model").text;
	return (
		<div
			data-step-failed={failed || undefined}
			className="flex min-w-0 flex-col gap-2 break-words"
		>
			{ui !== undefined && (
				<Marked id="ui">
					<ChannelText
						code
						text={JSON.stringify(ui, null, 2)}
						tone={channelOf("ui").text}
					/>
				</Marked>
			)}
			{attachments.length > 0 && (
				<Marked id="attachments">
					<AttachedFiles files={attachments} />
				</Marked>
			)}
			{output && (
				<Marked id="output">
					<ChannelText code text={output} tone={channelOf("output").text} />
				</Marked>
			)}
			{model && (
				<Marked id="model" tone={modelTone}>
					<ChannelText code={failed} text={model} tone={modelTone} />
				</Marked>
			)}
		</div>
	);
}

function askedText(message: ChatMessage): string {
	const answers = toolAnswers(message);
	const question = toolQuestion(message);
	return [
		...toolAsks(message).map((ask) => askText(ask, answers.get(ask.id))),
		...(question === undefined ? [] : [questionText(question)]),
	].join("\n\n");
}

export function ToolMessage({ message }: { message: ChatMessage }) {
	const shown = useChannels();
	const asked = shown.asks ? askedText(message) : "";
	return (
		<>
			<ToolResult message={message} />
			{asked !== "" && (
				<Marked id="asks">
					<ChannelText text={asked} tone="text-dim" />
				</Marked>
			)}
		</>
	);
}

function AgentMessage({
	message,
	onTrace,
}: {
	message: ChatMessage;
	onTrace?: () => void;
}) {
	const chatId = useChatSession((state) => state.chatId);
	const sender = useAgentSender(message, chatId, useContext(ParentSource));
	if (sender.cleared) return null;
	const { icon, text } = channelOf("agents");
	if (!sender.parent)
		return (
			<button
				{...anchorOf("chat/message")}
				type="button"
				data-agent-message
				disabled={onTrace === undefined}
				onClick={onTrace}
				title="open the full reply in the trace"
				className="flex min-w-0 items-center gap-1.5 text-left font-mono text-dim text-xs enabled:hover:text-fg"
			>
				<HugeiconsIcon
					icon={icon}
					aria-hidden
					className={`size-icon-sm flex-none ${text}`}
				/>
				<span className={`min-w-0 truncate ${sender.failed ? "text-red" : ""}`}>
					agent {sender.name} {sender.failed ? "failed" : "responded"}
				</span>
			</button>
		);
	return (
		<UserLine
			text={messageText(message)}
			title="parent agent"
			tone={text}
			mark={
				<HugeiconsIcon
					icon={icon}
					aria-label="parent agent"
					className="size-icon-sm mt-[3px] flex-none"
				/>
			}
		/>
	);
}

function UserMessage({ message }: { message: ChatMessage }) {
	const shown = useChannels();
	const text = messageText(message);
	const files = shown.attachments ? attachedTo(message) : [];
	if (files.length === 0) return <UserLine text={text} />;
	return (
		<>
			{text !== "" && <UserLine text={text} />}
			<AttachedFiles files={files} />
		</>
	);
}

export function ChatLine({ message }: { message: ChatMessage }) {
	const shown = useChannels();
	const reasoning =
		isUserMessage(message) || !shown.thinking ? "" : messageReasoning(message);
	return (
		<div className="min-w-0 break-words text-fg">
			{reasoning && (
				<div className="mb-2">
					<Marked id="thinking">
						<ChannelText text={reasoning} tone="text-dim italic" />
					</Marked>
				</div>
			)}
			{isUserMessage(message) ? (
				<UserMessage message={message} />
			) : (
				<div {...contentRegion}>
					<ChannelBody text={messageText(message)} code />
				</div>
			)}
		</div>
	);
}

function StickOnSend({ turn }: { turn: string | undefined }) {
	const { scrollToBottom } = useStickToBottomContext();
	useEffect(() => {
		if (turn) scrollToBottom("instant");
	}, [turn, scrollToBottom]);
	return null;
}

function ScrollToLatest() {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();
	if (isAtBottom) return null;
	return (
		<button
			{...anchorOf("chat/latest")}
			type="button"
			onClick={() => scrollToBottom("instant")}
			className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-[7px] rounded-none bg-bg2 px-[9px] py-px text-[11.5px] text-fg hover:brightness-125"
		>
			<span>latest</span>
			<span className="text-dim">▼</span>
		</button>
	);
}

function RanOutput({ message }: { message: ChatMessage }) {
	const output = toolOutput(message);
	const failure = toolFailure(message);
	if (output === "" && failure === "") return null;
	return (
		<div data-step-ran className="flex min-w-0 flex-col gap-2 break-words">
			{output !== "" && (
				<ChannelText code text={output} tone={channelOf("output").text} />
			)}
			{failure !== "" && <ChannelText code text={failure} tone="text-red" />}
		</div>
	);
}

function TurnOutput({ message }: { message: ChatMessage }) {
	const chatId = useChatSession((state) => state.chatId);
	const ui = toolUi(message);
	const attachments = attachedTo(message);
	const asks = toolAsks(message);
	const answers = toolAnswers(message);
	return (
		<>
			{ui !== undefined && chatId !== null && (
				<GenerativeUI chatId={chatId} viewId={ui.viewId} />
			)}
			{attachments.length > 0 && <AttachedFiles files={attachments} />}
			{asks.map((ask) => (
				<AskCard
					key={ask.id}
					ask={ask}
					messageId={message.id}
					answered={answers.get(ask.id)}
				/>
			))}
		</>
	);
}

function useStepProse(message: ChatMessage | undefined) {
	const text = message === undefined ? "" : messageText(message);
	const spans = useMemo(
		() =>
			message === undefined ? [] : messageProse(message).map((s) => s.span),
		[message],
	);
	const classified = message !== undefined && messageClassified(message);
	const { prose, heads } = useMemo(
		() => formsIn(text, spans, classified),
		[text, spans, classified],
	);
	return { text, spans, prose, heads };
}

function StepThinking({ thinking }: { thinking: string }) {
	const [open, setOpen] = useState(false);
	return (
		<button
			type="button"
			data-step-thinking
			aria-expanded={open}
			onClick={() => setOpen((shown) => !shown)}
			className="block w-full min-w-0 text-left text-[12.5px] text-dim leading-[1.5] hover:text-fg"
		>
			{open ? (
				<span className="block whitespace-pre-wrap break-words">
					{thinking}
				</span>
			) : (
				<span className="block truncate [direction:rtl]">
					<span dir="ltr">{thinking.replace(/\s+/g, " ").trim()}</span>
				</span>
			)}
		</button>
	);
}

function StepText({ message }: { message: ChatMessage }) {
	const { text, spans, prose } = useStepProse(message);
	const thinking = messageReasoning(message);
	if (!prose && !thinking) return null;
	return (
		<div
			{...contentRegion}
			data-step-text
			className="flex min-w-0 flex-col gap-2 break-words"
		>
			{thinking && <StepThinking thinking={thinking} />}
			{prose && (
				<SkippedProse text={text} spans={spans}>
					<Markdown>{prose}</Markdown>
				</SkippedProse>
			)}
		</div>
	);
}

function StepCall({
	call,
	result,
	doing,
	entries,
	progress,
	live,
	ran,
}: {
	call: ChatMessage | undefined;
	result: ChatMessage;
	ran: boolean;
	doing: string | undefined;
	entries: readonly TimelineEntry[];
	progress: Progress | undefined;
	live: boolean;
}) {
	const { heads } = useStepProse(call);
	const label = entries.some((entry) => entry.kind === "intent")
		? undefined
		: (doing ??
			(entries.length === 0 && !ran && heads.length > 0
				? heads.join(" · ")
				: undefined));
	return (
		<div className="flex min-w-0 flex-col gap-2 empty:hidden">
			{label && (
				<div
					data-step-call
					className="min-w-0 truncate font-mono text-dim text-xs"
				>
					{label}
				</div>
			)}
			<CallTimeline entries={entries} live={live} />
			{progress && <ProgressBar progress={progress} />}
			{ran && <RanOutput message={result} />}
			{result && <TurnOutput message={result} />}
		</div>
	);
}

function TurnFoot({
	message,
	live,
	failure,
	stats,
	memories,
	index,
	onTrace,
}: {
	message: ChatMessage | undefined;
	live: boolean;
	failure: string | undefined;
	stats: StepMeta | undefined;
	memories: NonNullable<StepMeta["memories"]>;
	index: number;
	onTrace?: () => void;
}) {
	const { metaShown } = useUI();
	const { openModelPicker } = useModelPicker();
	if (live && !failure) return null;
	return (
		<div
			data-turn-answer
			data-turn-foot={live ? "live" : "settled"}
			className="group flex min-h-6 min-w-0 flex-wrap items-center gap-x-3 text-[11px] text-dim leading-[1.7]"
		>
			{failure && (
				<span className="whitespace-pre-wrap break-words text-red">
					{failure}
				</span>
			)}
			{!live && memories.length > 0 && (
				<MessageMemories
					anchor={anchorOf("chat/meta")}
					memories={memories}
					onOpen={onTrace}
				/>
			)}
			{!live && (stats || onTrace) && (
				<MessageMeta
					meta={stats}
					show={metaShown}
					onPickModel={openModelPicker}
					onTrace={onTrace}
				/>
			)}
			{!live && message && (
				<MessageFeedback messageId={message.id} index={index} />
			)}
		</div>
	);
}

interface TurnProps {
	turn: Turn;
	index: number;
	live: boolean;
	meta: Record<string, StepMeta>;
	error?: string;
	onTrace?: (message: string) => void;
}

function failedAt(turn: Turn): ChatMessage | undefined {
	return (
		[...turn.steps].reverse().find((m) => isToolMessage(m) && toolFailed(m)) ??
		turn.steps.at(-1) ??
		turn.asked
	);
}

function TurnBody({ turn, index, live, meta, error, onTrace }: TurnProps) {
	const shape = useMemo(() => shapeTurn(turn), [turn]);
	const memories = useMemo(
		() =>
			turnMessages(turn).flatMap(
				(m) => (m.id === undefined ? undefined : meta[m.id]?.memories) ?? [],
			),
		[turn, meta],
	);
	const placed = useMemo(() => placeTimeline(shape, live), [shape, live]);
	const items = shape.chain.map((link, at) =>
		link.kind === "text" ? (
			<StepText key={`text:${link.message.id ?? at}`} message={link.message} />
		) : link.kind === "activity" ? (
			<CallTimeline
				key={`activity:${link.introduces[0]}`}
				entries={placed.get(at) ?? []}
				live={live}
			/>
		) : (
			<StepCall
				key={`call:${link.call?.id ?? link.result.id ?? at}`}
				call={link.call}
				result={link.result}
				ran={link.ran}
				doing={link.doing}
				entries={placed.get(at) ?? []}
				progress={link.progress ? shape.intent?.progress : undefined}
				live={live}
			/>
		),
	);
	const shown = useChannels();
	const traceAt = (message: ChatMessage | undefined) => {
		const id = message?.id;
		return onTrace && id !== undefined ? () => onTrace(id) : undefined;
	};
	const stats =
		shape.answer?.id === undefined ? undefined : meta[shape.answer.id];
	const failure =
		error ?? (!live && shape.failed ? "a step in this turn failed" : undefined);
	return (
		<div data-turn={turn.id} className="flex min-w-0 flex-col gap-3">
			{turn.asked && (!isParentMessage(turn.asked) || shown.agents) && (
				<div className="min-w-0 break-words text-fg">
					{isParentMessage(turn.asked) ? (
						<AgentMessage message={turn.asked} onTrace={traceAt(turn.asked)} />
					) : (
						<UserMessage message={turn.asked} />
					)}
				</div>
			)}
			{items}
			<TurnFoot
				message={shape.answer}
				live={live}
				failure={failure}
				stats={stats}
				memories={memories}
				index={index}
				onTrace={traceAt(failure ? failedAt(turn) : shape.answer)}
			/>
		</div>
	);
}

function sameTurn(before: TurnProps, after: TurnProps): boolean {
	if (
		before.live !== after.live ||
		before.index !== after.index ||
		before.error !== after.error ||
		before.onTrace !== after.onTrace
	)
		return false;
	const was = turnMessages(before.turn);
	const is = turnMessages(after.turn);
	return (
		was.length === is.length &&
		was.every(
			(m, at) =>
				m === is[at] &&
				(m.id === undefined || before.meta[m.id] === after.meta[m.id]),
		)
	);
}

const TurnView = memo(TurnBody, sameTurn);

function StatusLine({ status }: { status: AgentStatus }) {
	const [line] = useState(() => pickStatusLine(status));
	return (
		<span
			data-agent-status={status}
			className="min-w-0 break-words text-[11px] text-dim"
		>
			{status === "waiting" ? line : `${line}...`}
		</span>
	);
}

export function ChatView() {
	const { messages, meta, error, isLoading, chatId, queued } = useChatSession(
		(state) => ({
			messages: state.messages,
			meta: state.meta,
			error: state.error,
			isLoading: state.isLoading,
			chatId: state.chatId,
			queued: state.queued.length,
		}),
	);
	const { apply } = usePanels();
	const lastSent = messages
		.filter((m) => isUserMessage(m) || isSystemMessage(m))
		.at(-1)?.id;
	const briefing = useBriefing(chatId);
	const turns = useMemo(
		() =>
			groupTurns([
				...briefing,
				...messages.filter((m) => !isGreetingMessage(m)),
			]),
		[briefing, messages],
	);
	const { traceLink } = useTraceLink();
	const sideTrace = useSideTrace();
	const side = useRef(sideTrace);
	side.current = sideTrace;
	const onTrace = useCallback(
		(message: string) => {
			if (side.current !== null) side.current.show(message);
			else if (chatId !== null) apply([traceOpen(chatId, message)]);
		},
		[apply, chatId],
	);
	const last = turns.length - 1;
	const todos = useMemo(() => latestTodos(turns), [turns]);
	const writing = useMemo(() => {
		const turn = turns.at(-1);
		const link = turn === undefined ? undefined : shapeTurn(turn).chain.at(-1);
		return link?.kind === "text" ? messageText(link.message) : undefined;
	}, [turns]);
	const asking = useMemo(
		() => openQuestion(messages) !== undefined,
		[messages],
	);
	const status = error
		? undefined
		: agentStatus({ loading: isLoading, writing, queued, asking });
	const area = useRef<HTMLDivElement>(null);

	return (
		<Conversation className="min-h-0 min-w-0 flex-1 px-8 pt-6">
			<div
				ref={area}
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-0"
			/>
			<TodoCard todos={todos} chatId={chatId} area={area} />
			<StickOnSend turn={lastSent} />
			<ConversationContent
				className="mx-auto w-full max-w-[680px] gap-3 pb-3"
				scrollClassName="min-w-0"
			>
				<ParentSource.Provider value={parentSourceOf(briefing)}>
					{turns.map((turn, at) => (
						<TurnView
							key={turn.id}
							turn={turn}
							index={at}
							live={isLoading && at === last}
							meta={meta}
							error={at === last ? error : undefined}
							onTrace={chatId === null || !traceLink ? undefined : onTrace}
						/>
					))}
				</ParentSource.Provider>
				<SteerQueue />
				<div className="-mt-5 flex items-center gap-2 pt-[1.7em]">
					<AgentAvatar />
					{status && <StatusLine key={status} status={status} />}
				</div>
				{error && turns.length === 0 && (
					<div className="whitespace-pre-wrap break-words text-red">
						{error}
					</div>
				)}
				<div aria-hidden className="h-[6em]" />
			</ConversationContent>
			<ScrollToLatest />
		</Conversation>
	);
}
