import { HugeiconsIcon } from "@hugeicons/react";
import type { Id } from "@repo/backend/dataModel";
import { MessageMemories } from "@repo/components";
import { memoryKind } from "@repo/journal-catalog/memory";
import { view } from "@repo/shared/journal";
import {
	type ComponentProps,
	Fragment,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { attachedTo } from "../lib/attached-files.ts";
import {
	CHANNELS,
	channelOf,
	EVERY_CHANNEL,
	type Shown,
} from "../lib/channels.ts";
import {
	type ChatMessage,
	isParentMessage,
	isSystemMessage,
	isToolMessage,
	messageText,
	stepMeta,
} from "../lib/chat.tsx";
import { entriesOfMessage, isEntryMessage } from "../lib/entries.ts";
import { useModelPicker } from "../lib/model-picker.tsx";
import { useTrace } from "../lib/trace-source.tsx";
import {
	type TraceChild,
	type TraceEntry,
	type TraceStep,
	traceEntries,
} from "../lib/trace-steps.ts";
import { formatElapsed } from "../lib/turn-timeline.ts";
import { useUI } from "../lib/ui.tsx";
import { AttachedFiles } from "./attached-files.tsx";
import {
	ChannelsShown,
	ChatLine,
	ToolMessage,
	useChannels,
} from "./chat-view.tsx";
import { MessageMeta } from "./message-meta.tsx";

function ChannelToggles({
	shown,
	toggle,
}: {
	shown: Shown;
	toggle: (id: keyof Shown) => void;
}) {
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1 border-dim/20 border-b px-4 py-1.5 text-[11px]">
			{CHANNELS.map((c) => (
				<button
					key={c.id}
					type="button"
					aria-pressed={shown[c.id]}
					title={c.hint}
					onClick={() => toggle(c.id)}
					className={`flex items-center gap-1.5 tracking-[0.1em] ${
						shown[c.id] ? c.text : "text-dim/50 hover:text-dim"
					}`}
				>
					<HugeiconsIcon
						icon={c.icon}
						aria-hidden
						className="size-icon-sm flex-none"
					/>
					{c.label}
				</button>
			))}
		</div>
	);
}

function EntryLine({
	message,
	focused,
}: {
	message: ChatMessage;
	focused: boolean;
}) {
	const shown = useChannels();
	if (!shown.memory) return null;
	const entries = entriesOfMessage(message);
	const memory = view(entries, memoryKind).at(-1);
	if (memory === undefined) return null;
	return <MessageMemories memories={[memory]} focused={focused} />;
}

function TraceLine({
	message,
	focused,
}: {
	message: ChatMessage;
	focused: boolean;
}) {
	const { metaShown } = useUI();
	const { openModelPicker } = useModelPicker();
	const stats = useMemo(() => stepMeta(message), [message]);
	return (
		<div className="group relative min-w-0 empty:hidden">
			{isEntryMessage(message) ? (
				<EntryLine message={message} focused={focused} />
			) : isToolMessage(message) ? (
				<ToolMessage message={message} />
			) : (
				<ChatLine message={message} />
			)}
			{stats && (
				<MessageMeta
					meta={stats}
					show={metaShown}
					onPickModel={openModelPicker}
				/>
			)}
		</div>
	);
}

function useScrollTo(
	scroller: React.RefObject<HTMLDivElement | null>,
	target: string | undefined,
	loaded: boolean,
) {
	useEffect(() => {
		if (target === undefined || !loaded) return;
		const lines =
			scroller.current?.querySelectorAll<HTMLElement>("[data-message-id]");
		const found = [...(lines ?? [])].find(
			(line) => line.dataset.messageId === target,
		);
		found?.scrollIntoView?.({ block: "start" });
	}, [scroller, target, loaded]);
}

const FLASH_MS = 1600;

function useFlash(target: string | undefined): string | undefined {
	const [flashing, setFlashing] = useState(target);
	useEffect(() => {
		setFlashing(target);
		if (target === undefined) return;
		const timer = setTimeout(() => setFlashing(undefined), FLASH_MS);
		return () => clearTimeout(timer);
	}, [target]);
	return flashing;
}

function TraceRow({
	open,
	chevron = true,
	align = "items-center",
	children,
	...button
}: {
	open: boolean;
	chevron?: boolean;
	align?: "items-center" | "items-start";
} & ComponentProps<"button">) {
	return (
		<button
			type="button"
			aria-expanded={open}
			className={`flex w-full min-w-0 gap-2 text-left text-[11.5px] text-dim hover:text-fg ${align}`}
			{...button}
		>
			{chevron && (
				<span aria-hidden className="w-2 flex-none">
					{open ? "▾" : "▸"}
				</span>
			)}
			{children}
		</button>
	);
}

function StepDivider({ step }: { step: TraceStep }) {
	return (
		<div
			data-step-header
			className="flex min-w-0 items-center gap-2 border-dim/20 border-t pt-1.5 text-[11.5px] text-dim"
		>
			<span className="flex-none">step {step.number}</span>
			{step.durationMs !== undefined && (
				<span className="ml-auto flex-none tabular-nums">
					{formatElapsed(step.durationMs)}
				</span>
			)}
		</div>
	);
}

function TracedMessage({
	message,
	flashing,
	children,
}: {
	message: ChatMessage;
	flashing: string | undefined;
	children: React.ReactNode;
}) {
	const flashed = message.id !== undefined && message.id === flashing;
	return (
		<div
			data-message-id={message.id}
			data-flash={flashed || undefined}
			className={`min-w-0 transition-colors duration-700 empty:hidden ${
				flashed ? "bg-yellow/10" : ""
			}`}
		>
			{children}
		</div>
	);
}

function useClipped(line: RefObject<HTMLElement | null>, text: string) {
	const [clipped, setClipped] = useState(false);
	useEffect(() => {
		const at = line.current;
		if (at === null || text === "") {
			setClipped(false);
			return;
		}
		const measure = () => setClipped(at.scrollWidth > at.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(at);
		return () => observer.disconnect();
	}, [line, text]);
	return clipped;
}

type MessageKind = "agent" | "system" | "you";

function messageKind(parent: boolean, system: boolean): MessageKind {
	if (parent) return "agent";
	return system ? "system" : "you";
}

function MessageMark({ kind, system }: { kind: MessageKind; system: boolean }) {
	if (!system)
		return (
			<span aria-hidden className="flex-none select-none">
				›
			</span>
		);
	const marked = channelOf(kind === "agent" ? "agents" : "system");
	return (
		<HugeiconsIcon
			icon={marked.icon}
			aria-label={kind}
			className={`size-icon-sm flex-none ${marked.text}`}
		/>
	);
}

function MessageLine({
	line,
	text,
	open,
}: {
	line: RefObject<HTMLSpanElement | null>;
	text: string;
	open: boolean;
}) {
	return (
		<span
			ref={line}
			className={`min-w-0 flex-1 text-fg ${
				open ? "whitespace-pre-wrap break-words" : "truncate"
			}`}
		>
			{open ? text.trim() : text.replace(/\s+/g, " ").trim()}
		</span>
	);
}

function MessageEntry({
	message,
	flashing,
}: {
	message: ChatMessage;
	flashing: string | undefined;
}) {
	const shown = useChannels();
	const [open, setOpen] = useState(false);
	const line = useRef<HTMLSpanElement>(null);
	const text = messageText(message);
	const clipped = useClipped(line, text);
	const parent = isParentMessage(message);
	const system = isSystemMessage(message);
	if (parent ? !shown.agents : system && !shown.system) return null;
	const kind = messageKind(parent, system);
	const attached = shown.attachments ? attachedTo(message) : [];
	const foldable =
		open || clipped || text.trim().includes("\n") || attached.length > 0;
	const files = open ? attached : [];
	return (
		<TracedMessage message={message} flashing={flashing}>
			<div data-trace-message={kind} className="flex min-w-0 flex-col gap-2">
				<TraceRow
					open={open}
					chevron={!system && foldable}
					align={open ? "items-start" : "items-center"}
					disabled={!foldable}
					aria-expanded={foldable ? open : undefined}
					onClick={() => setOpen((was) => !was)}
				>
					<MessageMark kind={kind} system={system} />
					<MessageLine line={line} text={text} open={open} />
				</TraceRow>
				{files.length > 0 && <AttachedFiles files={files} />}
			</div>
		</TracedMessage>
	);
}

function ChildTrace({ child }: { child: TraceChild }) {
	return (
		<div
			data-child-trace={child.chatId}
			className="flex min-w-0 flex-col gap-2 border-dim/20 border-l pl-3"
		>
			<div className="flex min-w-0 gap-2 text-[11.5px] text-dim">
				<span className="flex-none">agent</span>
				<span className="min-w-0 truncate text-fg">{child.label}</span>
			</div>
			<NestedTrace chatId={child.chatId} />
		</div>
	);
}

function NestedTrace({ chatId }: { chatId: string }) {
	const messages = useTrace(chatId as Id<"chats">);
	const entries = useMemo(() => traceEntries(messages), [messages]);
	return <TraceEntries entries={entries} />;
}

function TraceEntries({
	entries,
	flashing,
	focused,
}: {
	entries: readonly TraceEntry[];
	flashing?: string;
	focused?: string;
}) {
	const shown = useChannels();
	return (
		<div className="flex w-full min-w-0 flex-col gap-3">
			{entries.map((entry) => {
				if (entry.kind === "message") {
					const { message, at } = entry;
					return (
						<MessageEntry
							key={message.id ?? at}
							message={message}
							flashing={flashing}
						/>
					);
				}
				if (!Object.values(shown).some(Boolean)) return null;
				const { step } = entry;
				return (
					<div
						key={step.id}
						data-step={step.number}
						className="flex min-w-0 flex-col gap-2"
					>
						<StepDivider step={step} />
						{step.messages.map((message, at) => (
							<Fragment key={message.id ?? at}>
								<TracedMessage message={message} flashing={flashing}>
									<TraceLine
										message={message}
										focused={message.id !== undefined && message.id === focused}
									/>
								</TracedMessage>
								{shown.agents &&
									step.children
										.filter((child) => child.after === at)
										.map((child) => (
											<ChildTrace key={child.chatId} child={child} />
										))}
							</Fragment>
						))}
					</div>
				);
			})}
		</div>
	);
}

export function TraceLines({
	messages,
	turn,
}: {
	messages: readonly ChatMessage[];
	turn?: string;
}) {
	const [shown, setShown] = useState<Shown>(EVERY_CHANNEL);
	const scroller = useRef<HTMLDivElement>(null);
	const entries = useMemo(() => traceEntries(messages), [messages]);
	const flashing = useFlash(turn);
	useScrollTo(scroller, turn, messages.length > 0);
	const toggle = (id: keyof Shown) =>
		setShown((was) => ({ ...was, [id]: !was[id] }));
	return (
		<ChannelsShown shown={shown}>
			<div className="flex h-full min-h-0 flex-col">
				<ChannelToggles shown={shown} toggle={toggle} />
				<div
					ref={scroller}
					className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-4"
				>
					<div className="mx-auto w-full max-w-[680px]">
						<TraceEntries
							entries={entries}
							flashing={flashing}
							focused={turn}
						/>
					</div>
				</div>
			</div>
		</ChannelsShown>
	);
}

export function TraceView({ chatId, turn }: { chatId: string; turn?: string }) {
	const messages = useTrace(chatId as Id<"chats">);
	return <TraceLines messages={messages} turn={turn} />;
}
