import { convexQuery } from "@convex-dev/react-query";
import {
	AiBrain01Icon,
	AlertCircleIcon,
	CheckmarkCircle02Icon,
	CommandLineIcon,
	GitBranchIcon,
	HelpCircleIcon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { usePageHost } from "../lib/page-host.tsx";

export interface ChildThread {
	_id: string;
	title: string;
	status?: "streaming" | "waiting" | "errored";
	failure?: string;
	job?: boolean;
}

type ThreadState = "running" | "waiting" | "errored" | "idle";

const STATE_OF: Record<NonNullable<ChildThread["status"]>, ThreadState> = {
	streaming: "running",
	waiting: "waiting",
	errored: "errored",
};

const ICON_OF: Record<ThreadState, IconSvgElement> = {
	running: Loading03Icon,
	waiting: HelpCircleIcon,
	errored: AlertCircleIcon,
	idle: CheckmarkCircle02Icon,
};

function threadState(thread: ChildThread): ThreadState {
	return thread.status === undefined ? "idle" : STATE_OF[thread.status];
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

function ThreadRow({
	thread,
	onOpen,
}: {
	thread: ChildThread;
	onOpen: (thread: ChildThread) => void;
}) {
	const state = threadState(thread);
	return (
		<li>
			<button
				type="button"
				data-state={state}
				title={thread.failure ?? state}
				onClick={() => onOpen(thread)}
				className={`flex w-full min-w-0 items-center gap-2 text-left hover:text-fg ${state === "errored" ? "text-destructive" : state === "idle" ? "text-dim" : "text-fg"}`}
			>
				<HugeiconsIcon
					icon={ICON_OF[state]}
					className={`size-icon-sm flex-none ${state === "running" ? "animate-spin" : ""}`}
				/>
				<HugeiconsIcon
					icon={thread.job ? CommandLineIcon : AiBrain01Icon}
					data-kind={thread.job ? "job" : "agent"}
					className="size-icon-sm flex-none text-dim"
				/>
				<span className="min-w-0 truncate">{thread.title || "untitled"}</span>
				<span className="sr-only">{state}</span>
			</button>
		</li>
	);
}

export function ChildThreadStrip({
	threads,
	onOpen,
}: {
	threads: readonly ChildThread[];
	onOpen: (thread: ChildThread) => void;
}) {
	const area = useRef<HTMLDivElement>(null);
	const wide = useWide(area);
	const [expanded, setExpanded] = useState(false);
	const [opened, setOpened] = useState<boolean | null>(null);
	if (threads.length === 0) return null;
	const running = threads.filter(
		(thread) => thread.status !== undefined,
	).length;
	const count = threads.length === 1 ? "1 thread" : `${threads.length} threads`;
	const hidden = expanded ? 0 : Math.max(0, threads.length - LATEST);
	const shown = threads.slice(hidden);
	const place = "absolute left-2 bottom-7 z-10";
	if (!(opened ?? wide))
		return (
			<div ref={area} className={place}>
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
					<ThreadRow key={thread._id} thread={thread} onOpen={onOpen} />
				))}
			</ul>
		</div>
	);
}

export function ChildThreads({ chatId }: { chatId: Id<"chats"> | null }) {
	const host = usePageHost();
	const { data } = useQuery(
		convexQuery(api.chats.children, chatId === null ? "skip" : { chatId }),
	);
	return (
		<ChildThreadStrip
			threads={data ?? []}
			onOpen={(thread) =>
				host.show({ kind: "chat", chatId: thread._id, title: thread.title })
			}
		/>
	);
}
