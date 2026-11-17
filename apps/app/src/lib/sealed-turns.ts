import {
	type ChatMessage,
	isToolMessage,
	type StepMeta,
} from "@repo/components";
import type { Progress } from "@repo/journal-catalog/intent";
import { toolFailed } from "./chat.tsx";
import { shapeTurn, type Turn } from "./turn-groups.ts";
import { placeTimeline, type TimelineEntry } from "./turn-timeline.ts";

export type Step =
	| {
			readonly kind: "text";
			readonly key: string;
			readonly message: ChatMessage;
	  }
	| {
			readonly kind: "activity";
			readonly key: string;
			readonly entries: readonly TimelineEntry[];
			readonly live: boolean;
	  }
	| {
			readonly kind: "call";
			readonly key: string;
			readonly call?: ChatMessage;
			readonly result: ChatMessage;
			readonly doing?: string;
			readonly ran: boolean;
			readonly progress?: Progress;
			readonly entries: readonly TimelineEntry[];
			readonly live: boolean;
	  };

export type Stats =
	| { readonly kind: "none" }
	| { readonly kind: "awaited"; readonly of: string }
	| { readonly kind: "known"; readonly meta: StepMeta };

const NO_STATS: Stats = { kind: "none" };

export interface Foot {
	readonly live: boolean;
	readonly failure?: string;
	readonly answer?: ChatMessage;
	readonly stats: Stats;
	readonly traced?: ChatMessage;
}

export interface ShownTurn {
	readonly id: string;
	readonly index: number;
	readonly asked?: ChatMessage;
	readonly steps: readonly Step[];
	readonly foot: Foot;
}

export interface Transcript {
	readonly turns: readonly ShownTurn[];
}

export interface Moment {
	readonly turns: readonly Turn[];
	readonly live: boolean;
	readonly meta: Readonly<Record<string, StepMeta>>;
	readonly error?: string;
}

export const NOTHING_SHOWN: Transcript = { turns: [] };

const TURN_FAILED = "a step in this turn failed";

function failedAt(turn: Turn): ChatMessage | undefined {
	return (
		[...turn.steps].reverse().find((m) => isToolMessage(m) && toolFailed(m)) ??
		turn.steps.at(-1) ??
		turn.asked
	);
}

function drawTurn(
	turn: Turn,
	index: number,
	live: boolean,
	meta: Moment["meta"],
	error: string | undefined,
): ShownTurn {
	const shape = shapeTurn(turn);
	const placed = placeTimeline(shape, live);
	const steps = shape.chain.map((link, at): Step => {
		if (link.kind === "text")
			return {
				kind: "text",
				key: `text:${link.message.id ?? at}`,
				message: link.message,
			};
		const entries = placed.get(at) ?? [];
		if (link.kind === "activity")
			return {
				kind: "activity",
				key: `activity:${link.introduces[0]}`,
				entries,
				live,
			};
		return {
			kind: "call",
			key: `call:${link.call?.id ?? link.result.id ?? at}`,
			...(link.call === undefined ? {} : { call: link.call }),
			result: link.result,
			...(link.doing === undefined ? {} : { doing: link.doing }),
			ran: link.ran,
			...(link.progress === undefined ? {} : { progress: link.progress }),
			entries,
			live,
		};
	});
	const failure = error ?? (!live && shape.failed ? TURN_FAILED : undefined);
	const answer = shape.answer;
	const known = answer?.id === undefined ? undefined : meta[answer.id];
	const stats: Stats =
		known !== undefined
			? { kind: "known", meta: known }
			: answer?.id !== undefined && !live && failure === undefined
				? { kind: "awaited", of: answer.id }
				: NO_STATS;
	const traced = failure ? failedAt(turn) : answer;
	return {
		id: turn.id,
		index,
		...(turn.asked === undefined ? {} : { asked: turn.asked }),
		steps,
		foot: {
			live,
			...(failure === undefined ? {} : { failure }),
			...(answer === undefined ? {} : { answer }),
			stats,
			...(traced === undefined ? {} : { traced }),
		},
	};
}

function entryIds(entries: readonly TimelineEntry[], into: Set<string>): void {
	for (const entry of entries) {
		into.add(entry.id);
		entryIds(entry.children, into);
	}
}

function unshown(
	entries: readonly TimelineEntry[],
	shown: ReadonlySet<string>,
): TimelineEntry[] {
	return entries
		.filter((entry) => !shown.has(entry.id))
		.map((entry) => ({ ...entry, children: unshown(entry.children, shown) }));
}

function withoutShown(
	step: Step,
	shown: ReadonlySet<string>,
): Step | undefined {
	if (step.kind === "text") return step;
	const entries = unshown(step.entries, shown);
	if (step.kind === "activity" && entries.length === 0) return undefined;
	return { ...step, entries };
}

function sealSteps(kept: readonly Step[], drawn: readonly Step[]): Step[] {
	const sealed = kept.slice(0, -1);
	const keys = new Set(sealed.map((step) => step.key));
	const shown = new Set<string>();
	for (const step of sealed)
		if (step.kind !== "text") entryIds(step.entries, shown);
	const open = drawn
		.filter((step) => !keys.has(step.key))
		.map((step) => withoutShown(step, shown))
		.filter((step): step is Step => step !== undefined);
	return [...sealed, ...open];
}

function withLateStats(turn: ShownTurn, meta: Moment["meta"]): ShownTurn {
	const { stats } = turn.foot;
	if (stats.kind !== "awaited") return turn;
	const known = meta[stats.of];
	if (known === undefined) return turn;
	return {
		...turn,
		foot: { ...turn.foot, stats: { kind: "known", meta: known } },
	};
}

export function seal(shown: Transcript, moment: Moment): Transcript {
	const last = moment.turns.length - 1;
	let agreed = true;
	const turns = moment.turns.map((turn, at): ShownTurn => {
		const kept = shown.turns[at];
		agreed &&= kept?.id === turn.id;
		const live = at === last && moment.live;
		const error = at === last ? moment.error : undefined;
		if (!agreed || kept === undefined)
			return drawTurn(turn, at, live, moment.meta, error);
		if (at < shown.turns.length - 1) return withLateStats(kept, moment.meta);
		const drawn = drawTurn(turn, at, live, moment.meta, error);
		return {
			...drawn,
			...(kept.asked === undefined ? {} : { asked: kept.asked }),
			steps: sealSteps(kept.steps, drawn.steps),
		};
	});
	return { turns };
}
