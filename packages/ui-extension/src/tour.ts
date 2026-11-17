import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	Keyword,
	LispKeyword,
	type List,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zAny, zList } from "@repo/interpreter/schema";
import {
	ANCHOR_IDS,
	type AnchorId,
	anchors,
	FILLABLE_ANCHOR,
	isAnchor,
	isPage,
	MARK_SIZES,
	MARKS,
	MAX_FILL_CHARS,
	MAX_LABEL_CHARS,
	type Mark,
	type MarkSize,
	PAGE_IDS,
	type PageId,
	pages,
	TOUR_LABELS,
	type TourLabels,
	type TourStep,
	UNTILS,
} from "@repo/ui-catalog";
import { z } from "zod";
import { listElements } from "./element.ts";
import type { StartedTour, TourStore } from "./tour-store.ts";

const MAX_STEPS = 20;

const DEFAULT_MARK: Mark = "arrow";

const DEFAULT_SIZE: MarkSize = "medium";

const MAX_SAY_CHARS = 500;

const OUTCOMES = ["done", "skipped"] as const;

export interface TourActions {
	action(form: unknown): string;
	send(text: string): void;
}

function nameOf(x: unknown, what: string): string {
	if (typeof x === "string") return x;
	if (x instanceof LispKeyword) return x.name;
	if (x instanceof Sym && !(x instanceof Keyword)) return x.name;
	throw new EvalException(`string or symbol expected for ${what}`, x);
}

function anchorOf(x: unknown): AnchorId {
	const id = nameOf(x, "an anchor");
	if (!isAnchor(id))
		throw new EvalException(
			`unknown anchor; expected one of ${ANCHOR_IDS.join(" ")}`,
			id,
		);
	return id;
}

export function pageOf(x: unknown): PageId {
	const id = nameOf(x, "a page");
	if (!isPage(id))
		throw new EvalException(
			`unknown page; expected one of ${PAGE_IDS.join(" ")}`,
			id,
		);
	return id;
}

function sayOf(x: unknown): string {
	if (typeof x !== "string" || x.trim() === "")
		throw new EvalException("tour step needs a :say string", x ?? null);
	if (x.length > MAX_SAY_CHARS)
		throw new EvalException(
			`tour step :say is longer than ${MAX_SAY_CHARS} characters`,
			x.length,
		);
	return x;
}

function fillOf(anchor: AnchorId, x: unknown): string {
	if (anchor !== FILLABLE_ANCHOR)
		throw new EvalException(
			`ui/point :fill only works on ${FILLABLE_ANCHOR}`,
			anchor,
		);
	if (typeof x !== "string" || x.trim() === "")
		throw new EvalException("ui/point :fill needs a string", x ?? null);
	if (x.length > MAX_FILL_CHARS)
		throw new EvalException(
			`ui/point :fill is longer than ${MAX_FILL_CHARS} characters`,
			x.length,
		);
	return x;
}

function labelsOf(given: List): TourLabels | undefined {
	const opts = plistOptions(given, TOUR_LABELS);
	const labels: TourLabels = {};
	for (const name of TOUR_LABELS) {
		if (!opts.has(name)) continue;
		const value = opts.get(name);
		if (typeof value !== "string" || value.trim() === "")
			throw new EvalException(`string expected for :${name}`, value ?? null);
		if (value.length > MAX_LABEL_CHARS)
			throw new EvalException(
				`:${name} is longer than ${MAX_LABEL_CHARS} characters`,
				value.length,
			);
		labels[name] = value;
	}
	return Object.keys(labels).length === 0 ? undefined : labels;
}

function markOf(x: unknown): Mark {
	const mark = nameOf(x, ":mark");
	if (!(MARKS as readonly string[]).includes(mark))
		throw new EvalException(
			`unknown :mark; expected one of ${MARKS.join(" ")}`,
			mark,
		);
	return mark as Mark;
}

function sizeOf(x: unknown): MarkSize {
	const size = nameOf(x, ":size");
	if (!(MARK_SIZES as readonly string[]).includes(size))
		throw new EvalException(
			`unknown :size; expected one of ${MARK_SIZES.join(" ")}`,
			size,
		);
	return size as MarkSize;
}

function untilOf(x: unknown): TourStep["until"] {
	const until = nameOf(x, ":until");
	if (!(UNTILS as readonly string[]).includes(until))
		throw new EvalException(
			`unknown :until; expected one of ${UNTILS.join(" ")}`,
			until,
		);
	return until as TourStep["until"];
}

function stepOf(x: unknown): TourStep {
	const opts = plistOptions(x instanceof Cell ? x : null, [
		"anchor",
		"page",
		"say",
		"until",
	]);
	const anchor = opts.has("anchor") ? anchorOf(opts.get("anchor")) : undefined;
	const page = opts.has("page") ? pageOf(opts.get("page")) : undefined;
	const until = opts.has("until") ? untilOf(opts.get("until")) : "next";
	if (until === "click" && anchor === undefined)
		throw new EvalException("tour step :until click needs an :anchor", x);
	return {
		...(anchor === undefined ? {} : { anchor }),
		...(page === undefined ? {} : { page }),
		say: sayOf(opts.get("say")),
		until,
	};
}

const POINT_MEMORY = "internal/ui/point";

const SECTIONS = {
	layout:
		"the user asks where or how to open or close a sidebar, switch or make a workspace, or use tabs, panes, splitting, resizing, the bottom bar or zoom",
	chats:
		"the user asks where or how to start, find, search, rename, archive or delete a chat, or see its sub-agent threads",
	files:
		"the user asks where or how to upload, find, open, select, move, download, keep or delete a file, or get one back from the bin",
	input:
		"the user asks where or how to type or send a message, stop or queue one, attach a file to it, use / or @ in it, or answer a question the agent asked",
	messages:
		"the user asks about a message in a chat: reading more, the details under it, feedback, the todo, an approval card, queued messages, sub-agent threads, the agent's thinking or avatar",
	trace:
		"the user asks how to see what the agent did: opening the trace, finding in it, its lanes or its rows",
	settings:
		"the user asks where or how to rename the workspace or change its model, icon or theme",
	preferences:
		"the user asks where or how to change how the app looks or behaves for them: theme, font, motion, the bottom bar, sidebar entries, input helpers, details under answers, developer or desktop switches",
	account:
		"the user asks about their account: their name or email, signing out, or deleting the account",
	readme: "the user asks where the workspace readme is or how to edit it",
	agent:
		"the user asks where to see what the agent remembers, may call or runs: its memories, permissions, onboardings, sub-agents, or the folders not ready yet",
} as const;

type Section = keyof typeof SECTIONS;

const SECTION_IDS = Object.keys(SECTIONS) as Section[];

type Head<T> = T extends `${infer H}/${string}` ? H : T;

const SECTION_OF: Record<Head<AnchorId>, Section> = {
	sidebar: "layout",
	right: "layout",
	workspace: "layout",
	panel: "layout",
	"status-bar": "layout",
	status: "layout",
	home: "chats",
	"new-chat": "chats",
	chats: "chats",
	knowledge: "files",
	attachments: "files",
	bin: "files",
	files: "files",
	file: "files",
	composer: "input",
	chat: "messages",
	trace: "trace",
	settings: "settings",
	preferences: "preferences",
	account: "account",
	"sign-out": "account",
	readme: "readme",
	memories: "agent",
	memory: "agent",
	permissions: "agent",
	onboarding: "agent",
	"sub-agents": "agent",
	agent: "agent",
	triggers: "agent",
	tasks: "agent",
	ui: "agent",
	tests: "agent",
};

function sectionOf(id: AnchorId): Section {
	return SECTION_OF[id.split("/")[0] as Head<AnchorId>];
}

function anchorLine(id: AnchorId): string {
	const { doc, opens } = anchors[id] as { doc: string; opens?: PageId };
	return `- ${id}: ${doc}${opens === undefined ? "" : `, opens page ${opens}`}`;
}

export function anchorMemories(): string {
	return SECTION_IDS.map((section) => {
		const body = [
			`Anchors, ${section}. For ui/point and ui/tour :anchor.`,
			...ANCHOR_IDS.filter((id) => sectionOf(id) === section).map(anchorLine),
		].join("\n");
		return `(memory "internal/ui/anchors-${section}" :when ${str(SECTIONS[section])} :links (${str(POINT_MEMORY)})\n  "${body.replace(/[\\"]/g, "\\$&")}")`;
	}).join("\n\n");
}

function endForm(tourId: string, outcome: (typeof OUTCOMES)[number]): Cell {
	return arrayToList([newSym("ui/tour-end"), tourId, outcome]) as Cell;
}

export function registerTours(
	interp: Interp,
	tours: TourStore,
	actions: TourActions,
): void {
	const shared: [string, unknown, string][] = [
		[
			"*ui-pages*",
			arrayToList(PAGE_IDS.map((id) => arrayToList([id, pages[id].doc]))),
			"The app pages ui/open and :open take, each as (id what-it-holds).",
		],
		[
			"*ui-anchor-sections*",
			arrayToList([...SECTION_IDS]),
			"The sections of the app the anchors are filed under; memory internal/ui/anchors-SECTION lists one section's anchors.",
		],
		["*ui-marks*", arrayToList([...MARKS]), "The marks ui/point draws."],
		["*ui-default-mark*", DEFAULT_MARK, "The mark ui/point draws given none."],
		[
			"*ui-mark-sizes*",
			arrayToList([...MARK_SIZES]),
			"The sizes a ui/point mark comes in.",
		],
		[
			"*ui-default-mark-size*",
			DEFAULT_SIZE,
			"The size of a ui/point mark given none.",
		],
		[
			"*ui-fill-anchor*",
			FILLABLE_ANCHOR,
			"The one anchor ui/point :fill works on.",
		],
		[
			"*ui-tour-untils*",
			arrayToList([...UNTILS]),
			"What a tour step waits for; the first is the default.",
		],
		[
			"*ui-tour-max-steps*",
			BigInt(MAX_STEPS),
			"How many steps one ui/tour takes.",
		],
	];
	for (const [name, value, doc] of shared)
		interp.defineGlobal(newSym(name), value, { signature: name, doc });

	function* start(tour: StartedTour): Eval<string> {
		yield* settled(tours.start(tour));
		return tour.tourId;
	}

	interp.defGen(
		"ui/point",
		-2,
		'(ui/point anchor [:open page] [:fill text] [:mark "oval"] [:size "small"] [:click t])',
		`Draw a short scribbled mark on one part of the app for a few seconds, with no overlay; say what it is in your reply. \`anchor\` is one of ${ANCHOR_IDS.join(" ")}. \`:mark\` is ${MARKS.join(" or ")}: an arrow at it (default) or an oval round it. \`:size\` is ${MARK_SIZES.join(" ")}, medium by default: how big the arrow is, or how loose the oval. \`:click t\` shows the pointer clicking the anchor. \`:open\` is one of ${PAGE_IDS.join(" ")}: the pointer clicks the anchor, then the page opens beside the chat, as if the user clicked it. \`:fill\` works on ${FILLABLE_ANCHOR} only: once the pointer is done, the text is put in the message box for the user to send, such as a slash command. Returns the anchor.`,
		z.tuple([zAny, zList]),
		function* ([target, rest]): Eval {
			const anchor = anchorOf(target);
			const opts = plistOptions(rest, [
				"open",
				"fill",
				"mark",
				"size",
				"click",
			]);
			const open = opts.has("open") ? pageOf(opts.get("open")) : undefined;
			const fill = opts.has("fill")
				? fillOf(anchor, opts.get("fill"))
				: undefined;
			const mark = opts.has("mark") ? markOf(opts.get("mark")) : DEFAULT_MARK;
			const size = opts.has("size") ? sizeOf(opts.get("size")) : DEFAULT_SIZE;
			const click =
				open !== undefined || (opts.has("click") && opts.get("click") !== null);
			yield* settled(
				tours.point({
					anchor,
					mark,
					size,
					click,
					...(open === undefined ? {} : { open }),
					...(fill === undefined ? {} : { fill }),
				}),
			);
			return anchor;
		},
	);

	interp.defGen(
		"ui/tour",
		-2,
		'(ui/tour id step... [:next "next" :done "done" :skip "skip"])',
		`Walk the user through the app one step at a time. Each step is a plist (:anchor anchor :page page :say text :until next-or-click): :anchor one of ${ANCHOR_IDS.join(" ")}, or none for a callout in the middle; :page one of ${PAGE_IDS.join(" ")}, opened beside the chat as the step starts; :until next (default) waits for the next button, click waits for the user to click the anchor. :next, :done and :skip name the buttons; a one-step tour shows only :done, "got it" unless named, and :skip only when given. Replaces any tour on screen. When the user finishes or skips it, you get a message saying so. Returns the tour id.`,
		z.tuple([zAny, zList]),
		function* ([id, rest]): Eval {
			const tourId = nameOf(id, "a tour id");
			const { values, options } = splitKeywordArgs(rest, TOUR_LABELS);
			const labels = labelsOf(options);
			const steps = (listElements(values) ?? []).map(stepOf);
			if (steps.length === 0)
				throw new EvalException("ui/tour needs at least one step", tourId);
			if (steps.length > MAX_STEPS)
				throw new EvalException(
					`ui/tour takes at most ${MAX_STEPS} steps`,
					steps.length,
				);
			return yield* start({
				tourId,
				steps,
				...(labels === undefined ? {} : { labels }),
				done: actions.action(endForm(tourId, "done")),
				skip: actions.action(endForm(tourId, "skipped")),
			});
		},
	);

	interp.defGen(
		"ui/tour-done?",
		1,
		"(ui/tour-done? id)",
		"t if this user has finished the tour `id` before, in any chat, nil if not. Check before offering one.",
		z.tuple([zAny]),
		function* ([id]): Eval {
			const done = yield* settled(tours.finished(nameOf(id, "a tour id")));
			return done || null;
		},
	);

	interp.def(
		"ui/tour-end",
		2,
		"(ui/tour-end id outcome)",
		"What the app calls when the user finishes or skips a tour; it tells you. You never call it.",
		z.tuple([zAny, zAny]),
		([id, outcome]) => {
			const tourId = nameOf(id, "a tour id");
			const how = nameOf(outcome, "an outcome");
			if (!(OUTCOMES as readonly string[]).includes(how))
				throw new EvalException(
					`unknown outcome; expected one of ${OUTCOMES.join(" ")}`,
					how,
				);
			actions.send(
				`I ${how === "done" ? "finished" : "skipped"} the ${tourId} tour.`,
			);
			return null;
		},
	);
}
