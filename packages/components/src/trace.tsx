import { HugeiconsIcon } from "@hugeicons/react";
import {
	type FiredMemory,
	memoryKind,
	recognizedKind,
} from "@repo/journal-catalog/memory";
import { view } from "@repo/shared/journal";
import {
	type ComponentProps,
	createContext,
	Fragment,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MessageMemories } from "./message-memories.tsx";
import {
	CHANNELS,
	channelOf,
	EVERY_CHANNEL,
	type Shown,
} from "./trace-channels.ts";
import { ChannelsShown, Revealed, useChannels } from "./trace-context.tsx";
import { entriesOfMessage, isEntryMessage } from "./trace-entries.ts";
import { messageMatches } from "./trace-find.ts";
import {
	type ChatMessage,
	isParentMessage,
	isSystemMessage,
	messageText,
	type StepMeta,
} from "./trace-message.ts";
import {
	type TraceChild,
	type TraceEntry,
	type TraceStep,
	traceEntries,
} from "./trace-steps.ts";

export interface TraceSlots {
	line(message: ChatMessage): ReactNode;
	meta?(meta: StepMeta | undefined): ReactNode;
	attachments?(message: ChatMessage): ReactNode;
	child?(child: TraceChild): ReactNode;
	memories?(memories: FiredMemory[], message: ChatMessage): ReactNode;
	aside?(message: ChatMessage): ReactNode;
}

const Slots = createContext<TraceSlots>({ line: () => null });

const FindQuery = createContext("");

function useMatched(message: ChatMessage): boolean {
	return messageMatches(message, useContext(FindQuery));
}

function FindBar({
	query,
	setQuery,
	at,
	count,
	go,
	input,
}: {
	query: string;
	setQuery: (query: string) => void;
	at: number;
	count: number;
	go: (by: number) => void;
	input: RefObject<HTMLInputElement | null>;
}) {
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			go(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") setQuery("");
	};
	return (
		<div className="flex min-w-0 items-center gap-2 border-dim/20 border-b px-4 py-1.5 text-[11.5px]">
			<input
				ref={input}
				type="search"
				aria-label="find in trace"
				placeholder="find in trace"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={onKeyDown}
				className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-dim/50"
			/>
			{query.trim() !== "" && (
				<span data-find-count className="flex-none text-dim tabular-nums">
					{count === 0 ? "no match" : `${Math.max(at, 0) + 1}/${count}`}
				</span>
			)}
			<button
				type="button"
				aria-label="previous match"
				disabled={count === 0}
				onClick={() => go(-1)}
				className="flex-none text-dim hover:text-fg disabled:opacity-30"
			>
				‹
			</button>
			<button
				type="button"
				aria-label="next match"
				disabled={count === 0}
				onClick={() => go(1)}
				className="flex-none text-dim hover:text-fg disabled:opacity-30"
			>
				›
			</button>
		</div>
	);
}

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

function shownMemories(
	message: ChatMessage,
	shown: Shown,
): FiredMemory[] | undefined {
	if (!shown.memory) return undefined;
	const entries = entriesOfMessage(message);
	const memory = view(entries, memoryKind).at(-1);
	if (memory !== undefined) return [memory];
	return view(entries, recognizedKind).at(-1)?.fired;
}

function TraceLine({ message }: { message: ChatMessage }) {
	const slots = useContext(Slots);
	return (
		<div className="group relative min-w-0 empty:hidden">
			{slots.line(message)}
			{slots.aside?.(message)}
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
	const slots = useContext(Slots);
	return (
		<div
			data-step-header
			className="flex min-w-0 items-baseline gap-2 border-dim/20 border-t pt-1.5 text-[11.5px] text-dim"
		>
			<span className="flex-none">step {step.number}</span>
			<div className="min-w-0 flex-1 [&>div]:mt-0">
				{slots.meta?.(step.meta)}
			</div>
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
	const matched = useMatched(message);
	return (
		<div
			data-message-id={message.id}
			data-flash={flashed || undefined}
			data-match={matched || undefined}
			className={`min-w-0 transition-colors duration-700 empty:hidden has-[>div:empty]:hidden data-[find-current]:outline data-[find-current]:outline-1 data-[find-current]:outline-yellow/60 ${
				flashed || matched ? "bg-yellow/10" : ""
			}`}
		>
			<Revealed.Provider value={matched}>{children}</Revealed.Provider>
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

function MessageMark({ kind }: { kind: MessageKind }) {
	const marked = channelOf(
		kind === "agent" ? "agents" : kind === "system" ? "system" : "user",
	);
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
	const slots = useContext(Slots);
	const matched = useMatched(message);
	const [unfolded, setOpen] = useState(false);
	const open = unfolded || matched;
	const line = useRef<HTMLSpanElement>(null);
	const text = messageText(message);
	const clipped = useClipped(line, text);
	const parent = isParentMessage(message);
	const system = isSystemMessage(message);
	if (parent ? !shown.agents : system ? !shown.system : !shown.user)
		return null;
	const kind = messageKind(parent, system);
	const attached = shown.attachments ? slots.attachments?.(message) : null;
	const foldable =
		open || clipped || text.trim().includes("\n") || attached != null;
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
					<MessageMark kind={kind} />
					<MessageLine line={line} text={text} open={open} />
				</TraceRow>
				{open && attached}
			</div>
		</TracedMessage>
	);
}

function PromptEntry({
	message,
	text,
	flashing,
}: {
	message: ChatMessage;
	text: string;
	flashing: string | undefined;
}) {
	const shown = useChannels();
	const matched = useMatched(message);
	const [unfolded, setOpen] = useState(false);
	if (!shown.system) return null;
	const open = unfolded || matched;
	return (
		<TracedMessage message={message} flashing={flashing}>
			<div data-trace-message="prompt" className="flex min-w-0 flex-col gap-2">
				<TraceRow open={open} onClick={() => setOpen((was) => !was)}>
					<MessageMark kind="system" />
					<span className="min-w-0 flex-1 truncate text-fg">
						system prompt · {text.length.toLocaleString()} chars
					</span>
				</TraceRow>
				{open && (
					<pre className="m-0 whitespace-pre-wrap break-words border-dim/20 border-l pl-2.5 font-mono text-[11px] text-dim">
						{text}
					</pre>
				)}
			</div>
		</TracedMessage>
	);
}

export function TraceSteps({ messages }: { messages: readonly ChatMessage[] }) {
	const entries = useMemo(() => traceEntries(messages), [messages]);
	return <TraceEntries entries={entries} />;
}

interface StepRow {
	at: number;
	message: ChatMessage;
	memories?: FiredMemory[];
}

function stepRows(messages: readonly ChatMessage[], shown: Shown): StepRow[] {
	return messages.flatMap((message, at) => {
		if (!isEntryMessage(message)) return [{ at, message }];
		const memories = shownMemories(message, shown);
		return memories === undefined ? [] : [{ at, message, memories }];
	});
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
	const slots = useContext(Slots);
	return (
		<div className="flex w-full min-w-0 flex-col gap-3">
			{entries.map((entry) => {
				if (entry.kind === "prompt")
					return (
						<PromptEntry
							key={entry.message.id ?? entry.at}
							message={entry.message}
							text={entry.text}
							flashing={flashing}
						/>
					);
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
						{stepRows(step.messages, shown).map(({ at, message, memories }) => (
							<Fragment key={message.id ?? at}>
								<TracedMessage message={message} flashing={flashing}>
									{memories === undefined ? (
										<TraceLine message={message} />
									) : (
										(slots.memories?.(memories, message) ?? (
											<MessageMemories
												memories={memories}
												focused={
													message.id !== undefined && message.id === focused
												}
											/>
										))
									)}
								</TracedMessage>
								{shown.agents &&
									step.children
										.filter((child) => child.after === at)
										.map((child) => (
											<Fragment key={child.chatId}>
												{slots.child?.(child)}
											</Fragment>
										))}
							</Fragment>
						))}
					</div>
				);
			})}
		</div>
	);
}

const CURRENT = "data-find-current";

function useFind(scroller: RefObject<HTMLDivElement | null>) {
	const [query, setRawQuery] = useState("");
	const [at, setAt] = useState(-1);
	const [count, setCount] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const hits = useCallback(
		() =>
			[
				...(scroller.current?.querySelectorAll<HTMLElement>("[data-match]") ??
					[]),
			].filter((hit) => hit.childElementCount > 0),
		[scroller],
	);
	const clear = useCallback(() => {
		for (const hit of scroller.current?.querySelectorAll(`[${CURRENT}]`) ?? [])
			hit.removeAttribute(CURRENT);
	}, [scroller]);
	useEffect(() => {
		const root = scroller.current;
		if (root === null) return;
		const recount = () => setCount(hits().length);
		recount();
		const observer = new MutationObserver(recount);
		observer.observe(root, {
			subtree: true,
			childList: true,
			attributeFilter: ["data-match"],
		});
		return () => observer.disconnect();
	}, [scroller, hits]);
	const setQuery = (next: string) => {
		clear();
		setAt(-1);
		setRawQuery(next);
	};
	const go = (by: number) => {
		const found = hits();
		setCount(found.length);
		if (found.length === 0) return;
		const next =
			((((at < 0 && by < 0 ? 0 : at) + by) % found.length) + found.length) %
			found.length;
		clear();
		found[next]?.setAttribute(CURRENT, "");
		found[next]?.scrollIntoView?.({ block: "center" });
		setAt(next);
	};
	return { query, setQuery, at, count, go, input };
}

export function Trace({
	messages,
	turn,
	slots,
}: {
	messages: readonly ChatMessage[];
	turn?: string;
	slots: TraceSlots;
}) {
	const [shown, setShown] = useState<Shown>(EVERY_CHANNEL);
	const scroller = useRef<HTMLDivElement>(null);
	const entries = useMemo(() => traceEntries(messages), [messages]);
	const flashing = useFlash(turn);
	const find = useFind(scroller);
	useScrollTo(scroller, turn, messages.length > 0);
	const toggle = (id: keyof Shown) =>
		setShown((was) => ({ ...was, [id]: !was[id] }));
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "f") {
			event.preventDefault();
			find.input.current?.focus();
			find.input.current?.select();
		}
	};
	return (
		<Slots.Provider value={slots}>
			<ChannelsShown shown={shown}>
				<FindQuery.Provider value={find.query}>
					<section
						aria-label="trace"
						className="flex h-full min-h-0 flex-col"
						onKeyDown={onKeyDown}
					>
						<FindBar {...find} />
						<ChannelToggles shown={shown} toggle={toggle} />
						<div
							ref={scroller}
							className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 [scrollbar-gutter:stable]"
						>
							<div className="mx-auto w-full max-w-[680px]">
								<TraceEntries
									entries={entries}
									flashing={flashing}
									focused={turn}
								/>
							</div>
						</div>
					</section>
				</FindQuery.Provider>
			</ChannelsShown>
		</Slots.Provider>
	);
}
