import { convexQuery } from "@convex-dev/react-query";
import {
	AlertCircleIcon,
	CheckmarkCircle02Icon,
	CircleDashedIcon,
	GitBranchIcon,
	HelpCircleIcon,
	Loading03Icon,
	StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { anchorOf } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { stopChat, useChatSession } from "../lib/chat.tsx";
import { requestPanel } from "../lib/panel-requests.ts";

export interface ChildThread {
	_id: string;
	title: string;
	status?: "streaming" | "waiting" | "errored" | "stopped";
	lastStartedAt?: number;
	failure?: string;
}

type ThreadState =
	| "idle"
	| "running"
	| "waiting"
	| "errored"
	| "stopped"
	| "done";

const STATE_OF: Record<NonNullable<ChildThread["status"]>, ThreadState> = {
	streaming: "running",
	waiting: "waiting",
	errored: "errored",
	stopped: "stopped",
};

const ICON_OF: Record<ThreadState, IconSvgElement> = {
	idle: CircleDashedIcon,
	running: Loading03Icon,
	waiting: HelpCircleIcon,
	errored: AlertCircleIcon,
	stopped: StopCircleIcon,
	done: CheckmarkCircle02Icon,
};

const TONE_OF: Record<ThreadState, string> = {
	idle: "text-dim",
	running: "text-fg",
	waiting: "text-fg",
	errored: "text-destructive",
	stopped: "text-dim",
	done: "text-dim",
};

function threadState(thread: ChildThread): ThreadState {
	if (thread.status !== undefined) return STATE_OF[thread.status];
	return thread.lastStartedAt === undefined ? "idle" : "done";
}

const LATEST = 3;

const GUTTER_PX = 1240;

function useWide(area: RefObject<HTMLElement | null>): boolean {
	const [wide, setWide] = useState(true);
	useEffect(() => {
		const element = area.current?.parentElement;
		if (!element || typeof ResizeObserver === "undefined") return;
		const measure = () => {
			const width = element.clientWidth;
			setWide(width === 0 || width >= GUTTER_PX);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [area]);
	return wide;
}

function isActive(thread: ChildThread): boolean {
	return thread.status === "streaming" || thread.status === "waiting";
}

function ThreadRow({
	thread,
	onOpen,
	onStop,
}: {
	thread: ChildThread;
	onOpen: (thread: ChildThread) => void;
	onStop: (thread: ChildThread) => void;
}) {
	const state = threadState(thread);
	const name = thread.title || "untitled";
	return (
		<li className="flex min-w-0 items-center gap-1">
			<button
				type="button"
				data-state={state}
				title={thread.failure ?? state}
				onClick={() => onOpen(thread)}
				className={`flex min-w-0 flex-1 items-center gap-2 text-left hover:text-fg ${TONE_OF[state]}`}
			>
				<HugeiconsIcon
					icon={ICON_OF[state]}
					className={`size-icon-sm flex-none ${state === "running" ? "animate-spin" : ""}`}
				/>
				<span className="min-w-0 truncate">{name}</span>
				<span className="sr-only">{state}</span>
			</button>
			{isActive(thread) && (
				<button
					type="button"
					data-child-threads="stop"
					aria-label={`stop ${name}`}
					title={`stop ${name}`}
					onClick={() => onStop(thread)}
					className="flex-none text-red hover:brightness-125"
				>
					■
				</button>
			)}
		</li>
	);
}

export function ChildThreadStrip({
	threads,
	onOpen,
	onStop,
	onStopAll,
}: {
	threads: readonly ChildThread[];
	onOpen: (thread: ChildThread) => void;
	onStop: (thread: ChildThread) => void;
	onStopAll: () => void;
}) {
	const area = useRef<HTMLDivElement>(null);
	const wide = useWide(area);
	const [expanded, setExpanded] = useState(false);
	const [opened, setOpened] = useState<boolean | null>(null);
	if (threads.length === 0) return null;
	const running = threads.filter(isActive).length;
	const count = threads.length === 1 ? "1 thread" : `${threads.length} threads`;
	const hidden = expanded ? 0 : Math.max(0, threads.length - LATEST);
	const shown = threads.slice(hidden);
	const place = "absolute left-2 bottom-7 z-10";
	if (!(opened ?? wide))
		return (
			<div {...anchorOf("chat/children")} ref={area} className={place}>
				<button
					type="button"
					data-child-threads="chip"
					aria-expanded={false}
					aria-label="show sub-agents"
					onClick={() => setOpened(true)}
					className="flex items-center gap-1.5 border border-bg2 bg-bg1 px-2 py-0.5 text-[11px] text-dim tabular-nums hover:text-fg"
				>
					<HugeiconsIcon
						icon={GitBranchIcon}
						className="size-icon-sm flex-none"
					/>
					{running > 0 ? `${running}/${threads.length}` : threads.length}
				</button>
			</div>
		);
	return (
		<div
			{...anchorOf("chat/children")}
			ref={area}
			data-child-threads="card"
			className={`${place} flex w-56 max-w-[calc(100%-1rem)] flex-col gap-1.5 border border-bg2 bg-bg1 px-3 py-2 text-[12px]`}
		>
			<button
				type="button"
				data-child-threads="collapse"
				aria-expanded={true}
				aria-label="hide sub-agents"
				onClick={() => {
					setOpened(false);
					setExpanded(false);
				}}
				className="flex items-center gap-2 text-left text-[11px] text-dim hover:text-fg"
			>
				<HugeiconsIcon
					icon={GitBranchIcon}
					className="size-icon-sm flex-none"
				/>
				<span className="flex-1">{count}</span>
				{running > 0 && <span className="tabular-nums">{running} active</span>}
			</button>
			{running > 0 && (
				<button
					type="button"
					data-child-threads="stop-all"
					onClick={onStopAll}
					className="flex items-center gap-[7px] self-start bg-bg2 px-[9px] py-px text-[11px] text-red hover:brightness-125"
				>
					<span>stop all</span>
					<span className="text-dim">■</span>
				</button>
			)}
			{hidden > 0 && (
				<button
					type="button"
					data-child-threads="more"
					onClick={() => setExpanded(true)}
					className="text-left text-[11px] text-dim hover:text-fg"
				>
					+{hidden} earlier
				</button>
			)}
			<ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
				{shown.map((thread) => (
					<ThreadRow
						key={thread._id}
						thread={thread}
						onOpen={onOpen}
						onStop={onStop}
					/>
				))}
			</ul>
		</div>
	);
}

export function ChildThreads({ chatId }: { chatId: Id<"chats"> | null }) {
	const stopAll = useChatSession((state) => state.stopAll);
	const { data } = useQuery(
		convexQuery(api.chats.children, chatId === null ? "skip" : { chatId }),
	);
	return (
		<ChildThreadStrip
			threads={data ?? []}
			onOpen={(thread) =>
				requestPanel({ kind: "chat", chatId: thread._id, title: thread.title })
			}
			onStop={(thread) => stopChat(thread._id, "tree")}
			onStopAll={stopAll}
		/>
	);
}
