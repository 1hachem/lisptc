import {
	Cancel01Icon,
	CheckmarkCircle02Icon,
	Loading03Icon,
	SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Progress } from "@repo/interpreter/annotations";
import { formatElapsed, type TimelineEntry } from "../lib/turn-timeline.ts";

export function ProgressBar({ progress }: { progress: Progress }) {
	const { done, total, label } = progress;
	const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
	return (
		<div data-progress className="flex items-center gap-2">
			<div
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={total}
				aria-valuenow={done}
				aria-label={label}
				className="h-1 w-32 flex-none overflow-hidden rounded-full bg-dim/20"
			>
				<div
					className="h-full bg-green transition-[width]"
					style={{ width: `${share * 100}%` }}
				/>
			</div>
			<span className="text-dim tabular-nums">
				{done}/{total}
			</span>
			{label && <span className="min-w-0 truncate text-dim">{label}</span>}
		</div>
	);
}

const STATE_MARK = {
	running: { icon: Loading03Icon, tone: "animate-spin text-dim" },
	done: { icon: CheckmarkCircle02Icon, tone: "text-green" },
	failed: { icon: Cancel01Icon, tone: "text-red" },
} as const;

const STALLED_MARK = { icon: SquareIcon, tone: "text-dim" } as const;

function markOf(entry: TimelineEntry, live: boolean) {
	if (entry.kind === "intent") return undefined;
	if (entry.state === "running" && !live) return STALLED_MARK;
	return STATE_MARK[entry.state];
}

function TimelineRow({ entry, live }: { entry: TimelineEntry; live: boolean }) {
	const mark = markOf(entry, live);
	return (
		<li
			data-timeline={entry.state}
			data-kind={entry.kind}
			className={
				mark
					? "relative flex flex-col gap-0.5 pl-5 before:absolute before:top-4 before:bottom-[-0.125rem] before:left-[0.4375rem] before:w-px before:bg-dim/25 last:before:hidden"
					: "flex flex-col gap-0.5"
			}
		>
			<div title={entry.detail} className="flex min-w-0 items-center gap-2">
				{mark && (
					<HugeiconsIcon
						icon={mark.icon}
						aria-label={entry.state}
						className={`absolute left-0 size-icon flex-none ${mark.tone}`}
					/>
				)}
				<span
					className={`min-w-0 truncate ${entry.state === "failed" ? "text-red" : "text-fg"}`}
				>
					{entry.label}
				</span>
				{entry.detail && (
					<span className="min-w-0 shrink-[100] truncate text-dim">
						{entry.detail}
					</span>
				)}
				{entry.ms !== undefined && (
					<span
						data-elapsed
						className="ml-auto flex-none text-dim tabular-nums"
					>
						{formatElapsed(entry.ms)}
					</span>
				)}
			</div>
			{entry.children.length > 0 && (
				<Timeline entries={entry.children} live={live} />
			)}
		</li>
	);
}

function Timeline({
	entries,
	live,
}: {
	entries: readonly TimelineEntry[];
	live: boolean;
}) {
	return (
		<ol className="flex flex-col gap-1">
			{entries.map((entry) => (
				<TimelineRow key={entry.id} entry={entry} live={live} />
			))}
		</ol>
	);
}

export function CallTimeline({
	entries,
	live,
}: {
	entries: readonly TimelineEntry[];
	live: boolean;
}) {
	if (entries.length === 0) return null;
	return (
		<div data-call-timeline className="text-[12.5px]">
			<Timeline entries={entries} live={live} />
		</div>
	);
}
