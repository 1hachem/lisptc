import { type ChatMessage, foldEntries, type StepMeta } from "@repo/components";
import { describe, expect, test, vi } from "vitest";
import {
	NOTHING_SHOWN,
	type ShownTurn,
	type Step,
	seal,
	type Transcript,
} from "../src/lib/sealed-turns.ts";
import { groupTurns } from "../src/lib/turn-groups.ts";
import type { TimelineEntry } from "../src/lib/turn-timeline.ts";

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: () => {} }));

interface World {
	readonly messages: readonly ChatMessage[];
	readonly live: boolean;
	readonly meta: Readonly<Record<string, StepMeta>>;
	readonly made: number;
	readonly started?: string;
	readonly lines: number;
}

const ORIGIN: World = {
	messages: [{ id: "h0", type: "human", content: "go" }],
	live: true,
	meta: {},
	made: 0,
	lines: 0,
};

const row = (id: string, kind: string, value: unknown, about?: string) =>
	({
		id,
		type: "entry",
		content: "",
		additional_kwargs: { kind, value, ...(about ? { about } : {}) },
	}) as ChatMessage;

const activity = (id: string, state: "started" | "done", at: number) => ({
	id,
	kind: "mcp",
	label: id,
	state,
	startedAt: at,
	...(state === "done" ? { ms: 5 } : {}),
});

const log = (lines: number) =>
	Array.from({ length: lines }, (_, at) => ({
		text: `line ${at}`,
		startedAt: at * 10,
		state: at === lines - 1 ? "running" : "done",
		...(at === lines - 1 ? {} : { ms: 10 }),
	}));

const firstTool = (world: World) =>
	world.messages.find((message) => message.type === "tool")?.id;

type Event = (world: World) => World;

const EVENTS: Record<string, Event> = {
	send: (w) => ({
		...w,
		made: w.made + 1,
		live: true,
		messages: [
			...w.messages,
			{ id: `h${w.made}`, type: "human", content: "more" },
		],
	}),
	say: (w) => {
		const last = w.messages.at(-1);
		if (last?.type === "ai")
			return {
				...w,
				messages: [
					...w.messages.slice(0, -1),
					{ ...last, content: `${last.content} more` },
				],
			};
		return {
			...w,
			made: w.made + 1,
			messages: [
				...w.messages,
				{ id: `a${w.made}`, type: "ai", content: "said" },
			],
		};
	},
	run: (w) => ({
		...w,
		made: w.made + 1,
		lines: w.lines + 1,
		messages: [
			...w.messages,
			{
				id: `t${w.made}`,
				type: "tool",
				content: "",
				additional_kwargs: {},
				entries: [
					{
						id: `i${w.made}`,
						kind: "intent",
						value: {
							log: log(w.lines + 1),
							progress: { done: w.made, total: 99 },
						},
					},
				],
			},
		],
	}),
	quiet: (w) => ({
		...w,
		made: w.made + 1,
		messages: [
			...w.messages,
			{
				id: `q${w.made}`,
				type: "tool",
				content: "",
				additional_kwargs: { quiet: true },
				entries: [
					{
						id: `qe${w.made}`,
						kind: "activity",
						value: activity(`quiet${w.made}`, "done", w.lines * 10 + 1),
					},
				],
			},
		],
	}),
	start: (w) => ({
		...w,
		made: w.made + 1,
		started: `act${w.made}`,
		messages: [
			...w.messages,
			row(
				`s${w.made}`,
				"activity",
				activity(`act${w.made}`, "started", w.lines * 10 + 2),
			),
		],
	}),
	finish: (w) =>
		w.started === undefined
			? w
			: {
					...w,
					made: w.made + 1,
					messages: [
						...w.messages,
						row(
							`f${w.made}`,
							"activity",
							activity(w.started, "done", w.lines * 10 + 2),
						),
					],
				},
	answer: (w) => {
		const about = firstTool(w);
		return about === undefined
			? w
			: {
					...w,
					made: w.made + 1,
					messages: [
						...w.messages,
						row(
							`r${w.made}`,
							"activity",
							activity(`answer${w.made}`, "done", 0),
							about,
						),
					],
				};
	},
	handoff: (w) => (EVENTS.finish as Event)((EVENTS.send as Event)(w)),
	pause: (w) => ({ ...w, live: !w.live }),
	meta: (w) => ({
		...w,
		meta: Object.fromEntries(
			w.messages
				.filter((message) => message.type === "ai" && message.id !== undefined)
				.map((message) => [
					message.id as string,
					{ model: `m${w.made}` } as StepMeta,
				]),
		),
		made: w.made + 1,
	}),
	reload: (w) => ({
		...w,
		messages: w.messages.map((message) => ({
			...message,
			additional_kwargs: { ...message.additional_kwargs },
		})),
	}),
};

const NAMES = Object.keys(EVENTS);

function frame(shown: Transcript, world: World): Transcript {
	return seal(shown, {
		turns: groupTurns(foldEntries(world.messages)),
		live: world.live,
		meta: world.meta,
	});
}

function idsIn(entries: readonly TimelineEntry[], into: string[]): string[] {
	for (const entry of entries) {
		into.push(entry.id);
		idsIn(entry.children, into);
	}
	return into;
}

function shownIds(turn: ShownTurn): string[] {
	const ids: string[] = [];
	for (const step of turn.steps)
		if (step.kind !== "text") idsIn(step.entries, ids);
	return ids;
}

function running(entries: readonly TimelineEntry[]): boolean {
	return entries.some(
		(entry) => entry.state === "running" || running(entry.children),
	);
}

function rowSettled(
	was: TimelineEntry,
	now: TimelineEntry | undefined,
): boolean {
	if (now === was) return true;
	if (now === undefined || now.id !== was.id) return false;
	const { children: wasChildren, ...wasRow } = was;
	const { children: nowChildren, ...nowRow } = now;
	return (
		(was.state === "running" || sameFields(wasRow, nowRow)) &&
		nowChildren.length === wasChildren.length &&
		wasChildren.every((child, at) => rowSettled(child, nowChildren[at]))
	);
}

function stepSettled(was: Step, now: Step | undefined): boolean {
	if (now === was) return true;
	if (now === undefined || was.kind === "text" || now.kind !== was.kind)
		return false;
	const { entries: wasRows, live: _was, ...wasRest } = was;
	const { entries: nowRows, live: _now, ...nowRest } = now;
	return (
		sameFields(wasRest, nowRest) &&
		nowRows.length === wasRows.length &&
		running(wasRows) &&
		wasRows.every((row, at) => rowSettled(row, nowRows[at]))
	);
}

function sameFields(was: object, now: object): boolean {
	const before = Object.entries(was);
	return (
		before.length === Object.keys(now).length &&
		before.every(
			([key, value]) => (now as Record<string, unknown>)[key] === value,
		)
	);
}

function turnSettled(was: ShownTurn, now: ShownTurn | undefined): boolean {
	if (now === was) return true;
	if (now === undefined) return false;
	const { stats: wasStats, ...wasFoot } = was.foot;
	const { stats: nowStats, ...nowFoot } = now.foot;
	const stats =
		nowStats === wasStats ||
		(wasStats.kind === "awaited" && nowStats.kind === "known");
	return (
		now.id === was.id &&
		now.index === was.index &&
		now.asked === was.asked &&
		stats &&
		sameFields(wasFoot, nowFoot) &&
		now.steps.length === was.steps.length &&
		was.steps.every((step, at) => stepSettled(step, now.steps[at]))
	);
}

function broken(before: Transcript, after: Transcript): string | undefined {
	const last = before.turns.length - 1;
	for (const [at, turn] of before.turns.entries()) {
		const now = after.turns[at];
		if (at < last) {
			if (!turnSettled(turn, now))
				return `turn ${turn.id}, not the latest, changed`;
			continue;
		}
		if (now === undefined) return `the latest turn ${turn.id} vanished`;
		if (now.asked !== turn.asked) return `what asked turn ${turn.id} changed`;
		for (const [step, shown] of turn.steps.slice(0, -1).entries())
			if (!stepSettled(shown, now.steps[step]))
				return `step ${shown.key} of turn ${turn.id}, not the latest, changed`;
	}
	for (const turn of after.turns) {
		const ids = shownIds(turn);
		if (new Set(ids).size !== ids.length)
			return `turn ${turn.id} shows an entry twice: ${ids.join(",")}`;
	}
	return undefined;
}

function finishedActivity(world: World): Set<string> {
	const state = new Map<string, string>();
	const note = (kind: unknown, value: unknown) => {
		if (kind !== "activity") return;
		const { id, state: now } = value as { id: string; state: string };
		state.set(id, now);
	};
	for (const message of world.messages) {
		if (message.type === "entry")
			note(message.additional_kwargs?.kind, message.additional_kwargs?.value);
		for (const entry of message.entries ?? []) note(entry.kind, entry.value);
	}
	return new Set(
		[...state]
			.filter(([, now]) => now !== "started")
			.map(([id]) => `activity:${id}`),
	);
}

function stillRunning(
	entries: readonly TimelineEntry[],
	done: Set<string>,
): string | undefined {
	for (const entry of entries) {
		if (entry.state === "running" && done.has(entry.id)) return entry.id;
		const child = stillRunning(entry.children, done);
		if (child) return child;
	}
	return undefined;
}

function unsettled(shown: Transcript, world: World): string | undefined {
	const done = finishedActivity(world);
	for (const turn of shown.turns)
		for (const step of turn.steps) {
			if (step.kind === "text") continue;
			const row = stillRunning(step.entries, done);
			if (row)
				return `row ${row} in step ${step.key} of turn ${turn.id} still runs after it finished`;
		}
	return undefined;
}

function unfilled(shown: Transcript, world: World): string | undefined {
	for (const turn of shown.turns) {
		const { stats } = turn.foot;
		if (stats.kind === "awaited" && world.meta[stats.of] !== undefined)
			return `turn ${turn.id} still waits on metadata it has`;
	}
	return undefined;
}

function explore(
	world: World,
	shown: Transcript,
	depth: number,
	path: string[],
	visit: (path: string[], failure: string) => void,
): number {
	if (depth === 0) return 1;
	let checked = 1;
	for (const name of NAMES) {
		const next = (EVENTS[name] as Event)(world);
		const after = frame(shown, next);
		const failure =
			broken(shown, after) ??
			unfilled(after, next) ??
			unsettled(after, next) ??
			(broken(after, frame(after, next)) &&
				"sealing the same moment twice moved it");
		if (failure) visit([...path, name], failure);
		checked += explore(next, after, depth - 1, [...path, name], visit);
	}
	return checked;
}

function random(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

describe("a transcript shown while the agent streams", () => {
	test("never changes a turn or a step once a later one is shown, for every interleaving of five stream events", () => {
		const failures: string[] = [];
		const start = frame(NOTHING_SHOWN, ORIGIN);
		const checked = explore(ORIGIN, start, 5, [], (path, failure) => {
			if (failures.length < 5) failures.push(`${path.join(" → ")}: ${failure}`);
		});

		expect(failures).toEqual([]);
		expect(checked).toBe((NAMES.length ** 6 - 1) / (NAMES.length - 1));
	}, 60_000);

	test("never changes a turn or a step once a later one is shown, over long random streams", () => {
		const failures: string[] = [];
		for (let seed = 1; seed <= 300 && failures.length === 0; seed += 1) {
			const next = random(seed);
			let world = ORIGIN;
			let shown = frame(NOTHING_SHOWN, world);
			const path: string[] = [];
			for (let at = 0; at < 60; at += 1) {
				const name = NAMES[Math.floor(next() * NAMES.length)] as string;
				path.push(name);
				world = (EVENTS[name] as Event)(world);
				const after = frame(shown, world);
				const failure =
					broken(shown, after) ??
					unfilled(after, world) ??
					unsettled(after, world);
				if (failure) {
					failures.push(`seed ${seed}, ${path.join(" → ")}: ${failure}`);
					break;
				}
				shown = after;
			}
		}

		expect(failures).toEqual([]);
	});
});
