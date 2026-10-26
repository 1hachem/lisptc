import type {
	ActivityEntry,
	Intent,
	IntentStep,
} from "@repo/interpreter/annotations";
import type { TurnShape } from "./turn-groups.ts";

export type TimelineState = "running" | "done" | "failed";

export interface TimelineEntry {
	id: string;
	kind: "intent" | "activity";
	label: string;
	detail?: string;
	state: TimelineState;
	ms?: number;
	children: TimelineEntry[];
}

const ACTIVITY_STATE: Record<ActivityEntry["state"], TimelineState> = {
	started: "running",
	done: "done",
	failed: "failed",
};

function activityEntry(entry: ActivityEntry): TimelineEntry {
	return {
		id: `activity:${entry.id}`,
		kind: "activity",
		label: entry.label,
		detail: entry.detail,
		state: ACTIVITY_STATE[entry.state],
		ms: entry.ms,
		children: [],
	};
}

function runningAt(
	log: readonly IntentStep[],
	startedAt: number | undefined,
): number {
	if (startedAt === undefined) return -1;
	let found = -1;
	for (const [at, line] of log.entries())
		if (line.startedAt <= startedAt) found = at;
	return found;
}

function settledLine(
	line: IntentStep,
	last: boolean,
	live: boolean,
): Pick<TimelineEntry, "state" | "ms"> {
	if (!live && last && line.state === "running" && line.ms === undefined)
		return { state: "done" };
	return { state: line.state, ms: line.ms };
}

export function turnTimeline(
	intent: Intent | undefined,
	activity: readonly ActivityEntry[],
	live = false,
): TimelineEntry[] {
	const log = intent?.log ?? [];
	if (log.length === 0) return activity.map(activityEntry);
	const lines: (TimelineEntry & { startedAt?: number })[] = log.map(
		(line, at) => ({
			id: `intent:${at}`,
			kind: "intent",
			label: line.text,
			...settledLine(line, at === log.length - 1, live),
			startedAt: line.startedAt,
			children: [],
		}),
	);
	const loose: (TimelineEntry & { startedAt?: number })[] = [];
	for (const entry of activity) {
		const owner = runningAt(log, entry.startedAt);
		if (owner === -1)
			loose.push({ ...activityEntry(entry), startedAt: entry.startedAt });
		else lines[owner]?.children.push(activityEntry(entry));
	}
	return [...loose, ...lines]
		.map((entry, at) => ({ entry, at }))
		.sort(
			(a, b) =>
				(a.entry.startedAt ?? Number.POSITIVE_INFINITY) -
					(b.entry.startedAt ?? Number.POSITIVE_INFINITY) || a.at - b.at,
		)
		.map(({ entry: { startedAt: _, ...entry } }) => entry);
}

export function formatElapsed(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function placeTimeline(
	shape: TurnShape,
	live: boolean,
): Map<number, TimelineEntry[]> {
	const owner = new Map<string, number>();
	let last = -1;
	for (const [at, link] of shape.chain.entries()) {
		if (link.kind !== "call") continue;
		last = at;
		for (const id of link.introduces) if (!owner.has(id)) owner.set(id, at);
	}
	const placed = new Map<number, TimelineEntry[]>();
	if (last === -1) return placed;
	for (const entry of turnTimeline(shape.intent, shape.activity, live)) {
		const at = owner.get(entry.id) ?? last;
		placed.set(at, [...(placed.get(at) ?? []), entry]);
	}
	return placed;
}
