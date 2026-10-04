import { MessageMemories } from "@repo/components";
import { formsIn, type Skipped } from "@repo/syntax";
import {
	Conversation,
	ConversationContent,
	useStickToBottomContext,
} from "@repo/ui";
import { useEffect, useMemo, useState } from "react";
import { CHANNELS } from "../lib/channels.ts";
import {
	type ChatMessage,
	isGreetingMessage,
	isToolMessage,
	isUserMessage,
	messageProse,
	messageReasoning,
	messageText,
	toolApprovals,
	toolDecisions,
	toolFailed,
	toolModelOutput,
	toolResult,
	toolUi,
	useChatSession,
} from "../lib/chat.tsx";
import { useUI } from "../lib/ui.tsx";
import { toUiNode } from "../lib/ui-node.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { Building } from "./building.tsx";
import { GenerativeUI } from "./generative-ui.tsx";
import { SkippedProse } from "./lisp-text.tsx";
import { Markdown } from "./markdown.tsx";
import { MessageFeedback } from "./message-feedback.tsx";
import { MessageMeta } from "./message-meta.tsx";
import { PermissionRequest } from "./permission-request.tsx";
import { SteerQueue } from "./steer-queue.tsx";
import { UserLine } from "./user-line.tsx";

const FOLD_LINES = 25;
const PAGE_LINES = 200;

const channel = (id: string) =>
	CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];

function ChannelLabel({ id }: { id: string }) {
	const { label, dot, text } = channel(id);
	return (
		<div className="mt-2 mb-1 flex items-center gap-2">
			<span aria-hidden className={`size-1.5 flex-none rounded-full ${dot}`} />
			<span className={`flex-none text-[11px] tracking-[0.1em] ${text}`}>
				{label}
			</span>
			<span aria-hidden className="h-px flex-1 bg-dim/20" />
		</div>
	);
}

function ChannelText({ text, tone }: { text: string; tone: string }) {
	const [expanded, setExpanded] = useState(false);
	const [page, setPage] = useState(0);
	const lines = text.split("\n");
	const long = lines.length > FOLD_LINES;
	const folded = long && !expanded;
	const pages = Math.ceil(lines.length / PAGE_LINES);
	const paged = !folded && pages > 1;
	const shown = folded
		? lines.slice(0, FOLD_LINES)
		: paged
			? lines.slice(page * PAGE_LINES, (page + 1) * PAGE_LINES)
			: lines;
	const step = (by: number) =>
		setPage((p) => Math.min(pages - 1, Math.max(0, p + by)));
	return (
		<div className={`min-w-0 break-words ${tone}`}>
			<div className={expanded ? "max-h-[60vh] overflow-y-auto" : undefined}>
				<Markdown>{shown.join("\n")}</Markdown>
			</div>
			{long && (
				<div className="mt-1 flex items-center gap-3 text-dim">
					<button
						type="button"
						onClick={() => {
							setExpanded(!expanded);
							setPage(0);
						}}
						className="underline decoration-dim/40 hover:text-fg"
					>
						{folded
							? `see ${lines.length - FOLD_LINES} more lines`
							: "see less"}
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

function AssistantText({
	id,
	text,
	skipped,
	busy,
}: {
	id: string;
	text: string;
	skipped: Skipped[];
	busy: boolean;
}) {
	const { shown } = useUI();
	const spans = useMemo(() => skipped.map((s) => s.span), [skipped]);
	const { prose, heads } = useMemo(() => formsIn(text, spans), [text, spans]);
	return (
		<SkippedProse text={text} spans={spans}>
			{shown.lisp ? (
				<Markdown lisp>{text}</Markdown>
			) : (
				<>
					{prose && <Markdown>{prose}</Markdown>}
					<Building id={id} heads={heads} busy={busy} />
				</>
			)}
		</SkippedProse>
	);
}

type Shown = ReturnType<typeof useUI>["shown"];

function toolChannels(message: ChatMessage, shown: Shown) {
	const { output } = toolResult(message);
	const ui = toUiNode(toolUi(message));
	const model = toolModelOutput(message).output;
	return {
		output,
		ui: shown.ui ? ui : undefined,
		model,
		drawsUser: shown.user && output !== "",
		drawsError: shown.errors && toolFailed(message),
		drawsModel: shown.model && model !== "",
	};
}

type ToolChannels = ReturnType<typeof toolChannels>;

function drawsAny(channels: ToolChannels): boolean {
	const { ui, drawsUser, drawsError, drawsModel } = channels;
	return ui !== undefined || drawsUser || drawsError || drawsModel;
}

function isLabelled(channels: ToolChannels): boolean {
	const { ui, drawsUser, drawsError, drawsModel } = channels;
	const drawn = [ui !== undefined, drawsUser, drawsModel].filter(Boolean);
	return drawn.length > 1 || (drawsError && drawsModel);
}

function Channel({
	id,
	labelled,
	children,
}: {
	id: string;
	labelled: boolean;
	children: React.ReactNode;
}) {
	return (
		<>
			{labelled && <ChannelLabel id={id} />}
			{children}
		</>
	);
}

function ToolResult({ message }: { message: ChatMessage }) {
	const { shown } = useUI();
	const channels = toolChannels(message, shown);
	if (!drawsAny(channels)) return null;
	const { output, ui, model, drawsUser, drawsError, drawsModel } = channels;
	const labelled = isLabelled(channels);
	return (
		<div
			className={`min-w-0 break-words border-l pl-3 ${
				drawsError ? "border-red/60" : "border-dim/40"
			}`}
		>
			{ui !== undefined && (
				<Channel id="ui" labelled={labelled}>
					<GenerativeUI node={ui} />
				</Channel>
			)}
			{drawsUser && (
				<Channel id="user" labelled={labelled}>
					<ChannelText text={output} tone="text-dim" />
				</Channel>
			)}
			{drawsError && (
				<div className={channel("errors").text}>a form in this step failed</div>
			)}
			{drawsModel && (
				<Channel id="model" labelled={labelled}>
					<ChannelText text={model} tone={channel("model").text} />
				</Channel>
			)}
		</div>
	);
}

function ToolMessage({ message }: { message: ChatMessage }) {
	const { shown } = useUI();
	const approvals = shown.permissions ? toolApprovals(message) : [];
	const decisions = toolDecisions(message);
	return (
		<>
			<ToolResult message={message} />
			{approvals.map((request) => (
				<PermissionRequest
					key={request.id}
					request={request}
					messageId={message.id}
					decided={decisions.get(request.id)}
				/>
			))}
		</>
	);
}

function ChatLine({
	message,
	index,
	busy,
}: {
	message: ChatMessage;
	index: number;
	busy: boolean;
}) {
	const { shown } = useUI();
	const reasoning =
		isUserMessage(message) || !shown.thinking ? "" : messageReasoning(message);
	return (
		<div className="min-w-0 break-words text-fg">
			{reasoning && (
				<div className="mb-2">
					<ChannelLabel id="thinking" />
					<div className="whitespace-pre-wrap break-words border-blue/40 border-l pl-3 text-dim italic">
						{reasoning}
					</div>
				</div>
			)}
			{isUserMessage(message) ? (
				<UserLine text={messageText(message)} />
			) : (
				<AssistantText
					id={message.id ?? String(index)}
					text={messageText(message)}
					skipped={messageProse(message)}
					busy={busy}
				/>
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
			type="button"
			onClick={() => scrollToBottom("instant")}
			className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-[7px] rounded-none bg-bg2 px-[9px] py-px text-[11.5px] text-fg hover:brightness-125"
		>
			<span>latest</span>
			<span className="text-dim">▼</span>
		</button>
	);
}

export function ChatView() {
	const { messages, meta, error, isLoading } = useChatSession((state) => ({
		messages: state.messages,
		meta: state.meta,
		error: state.error,
		isLoading: state.isLoading,
	}));
	const { shown } = useUI();
	const lastSent = messages.filter(isUserMessage).at(-1)?.id;

	return (
		<Conversation className="min-h-0 flex-1 px-8 pt-6">
			<StickOnSend turn={lastSent} />
			<ConversationContent className="mx-auto w-full max-w-[680px] gap-5 pb-3">
				{messages
					.filter((m) => !isGreetingMessage(m))
					.map((m, i, all) => {
						const stats = m.id ? meta[m.id] : undefined;
						const tool = isToolMessage(m);
						return (
							<div key={m.id ?? i} className="group relative min-w-0">
								{tool ? (
									<ToolMessage message={m} />
								) : (
									<ChatLine
										message={m}
										index={i}
										busy={isLoading && i === all.length - 1}
									/>
								)}
								{stats?.memories && shown.memory && (
									<MessageMemories memories={stats.memories} />
								)}
								{stats && <MessageMeta meta={stats} />}
								{!tool && !isUserMessage(m) && (
									<MessageFeedback messageId={m.id} index={i} />
								)}
							</div>
						);
					})}
				<SteerQueue />
				<div className="-mt-5 pt-[1.7em]">
					<AgentAvatar />
				</div>
				{error && (
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
