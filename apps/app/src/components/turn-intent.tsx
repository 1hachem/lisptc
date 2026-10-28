import {
	AiBrain01Icon,
	Cancel01Icon,
	CheckmarkCircle02Icon,
	FileEditIcon,
	FileViewIcon,
	FirstBracketIcon,
	PlugSocketIcon,
	SquareIcon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type {
	ActivityIcon,
	ActivityImage,
	Progress,
} from "@repo/interpreter/annotations";
import { GlyphCycle } from "@repo/components";
import { useState } from "react";
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
	running: { icon: FirstBracketIcon, tone: "text-dim" },
	done: { icon: CheckmarkCircle02Icon, tone: "text-green" },
	failed: { icon: Cancel01Icon, tone: "text-red" },
} as const;

const STALLED_MARK = { icon: SquareIcon, tone: "text-dim" } as const;

const ACTIVITY_ICON: Record<ActivityIcon, IconSvgElement> = {
	tool: PlugSocketIcon,
	model: AiBrain01Icon,
	agent: UserMultipleIcon,
	read: FileViewIcon,
	write: FileEditIcon,
};

function markOf(entry: TimelineEntry, live: boolean) {
	if (entry.kind === "intent") return undefined;
	if (entry.state === "running" && !live) return STALLED_MARK;
	if (entry.state === "done" && typeof entry.icon === "string")
		return { icon: ACTIVITY_ICON[entry.icon], tone: STATE_MARK.done.tone };
	return STATE_MARK[entry.state];
}

const IMAGE_THEME = {
	light: "dark:hidden",
	dark: "hidden dark:block",
	any: "",
} as const;

function themedImages(images: readonly ActivityImage[]) {
	const light = images.find((i) => i.theme === "light");
	const dark = images.find((i) => i.theme === "dark");
	const plain = images.find((i) => i.theme === undefined);
	if (light && dark)
		return [
			{ src: light.src, show: IMAGE_THEME.light },
			{ src: dark.src, show: IMAGE_THEME.dark },
		];
	const one = plain ?? light ?? dark;
	return one ? [{ src: one.src, show: IMAGE_THEME.any }] : [];
}

function ImageMark({
	images,
	onBroken,
}: {
	images: readonly ActivityImage[];
	onBroken: () => void;
}) {
	return themedImages(images).map(({ src, show }) => (
		<img
			key={src}
			src={src}
			alt=""
			referrerPolicy="no-referrer"
			loading="lazy"
			onError={onBroken}
			data-activity-image
			className={`absolute left-0 size-icon flex-none rounded-sm object-contain ${show}`}
		/>
	));
}

function TimelineRow({ entry, live }: { entry: TimelineEntry; live: boolean }) {
	const mark = markOf(entry, live);
	const cycling = mark === STATE_MARK.running;
	const [broken, setBroken] = useState(false);
	const images =
		entry.state === "done" && Array.isArray(entry.icon) && !broken
			? entry.icon
			: undefined;
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
				{mark && images ? (
					<ImageMark images={images} onBroken={() => setBroken(true)} />
				) : (
					mark &&
					(cycling ? (
						<GlyphCycle
							label={entry.state}
							className={`absolute left-0 size-icon flex-none ${mark.tone}`}
						/>
					) : (
						<HugeiconsIcon
							icon={mark.icon}
							aria-label={entry.state}
							className={`absolute left-0 size-icon flex-none ${mark.tone}`}
						/>
					))
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
			{entry.error && (
				<pre
					data-timeline-error
					className="min-w-0 whitespace-pre-wrap break-words font-mono text-red"
				>
					{entry.error}
				</pre>
			)}
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
