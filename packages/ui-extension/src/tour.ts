import { type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Interp } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	Keyword,
	LispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { plistOptions } from "@repo/interpreter/plist";
import { zAny, zList } from "@repo/interpreter/schema";
import {
	ANCHOR_IDS,
	type AnchorId,
	anchors,
	isAnchor,
	type TourStep,
	UNTILS,
} from "@repo/ui-catalog";
import { z } from "zod";
import { listElements } from "./element.ts";
import type { StartedTour, TourStore } from "./tour-store.ts";

const MAX_STEPS = 20;

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
		"say",
		"until",
	]);
	const anchor = opts.has("anchor") ? anchorOf(opts.get("anchor")) : undefined;
	const until = opts.has("until") ? untilOf(opts.get("until")) : "next";
	if (until === "click" && anchor === undefined)
		throw new EvalException("tour step :until click needs an :anchor", x);
	return {
		...(anchor === undefined ? {} : { anchor }),
		say: sayOf(opts.get("say")),
		until,
	};
}

export function anchorPromptSection(): string {
	return ANCHOR_IDS.map((id) => `- ${id}: ${anchors[id].doc}`).join("\n");
}

function endForm(tourId: string, outcome: (typeof OUTCOMES)[number]): Cell {
	return arrayToList([newSym("ui/tour-end"), tourId, outcome]) as Cell;
}

export function registerTours(
	interp: Interp,
	tours: TourStore,
	actions: TourActions,
): void {
	function* start(tour: StartedTour): Eval<string> {
		yield* settled(tours.start(tour));
		return tour.tourId;
	}

	interp.defGen(
		"ui/point",
		2,
		"(ui/point anchor text)",
		`Spotlight one part of the app with a callout saying \`text\`, until the user clicks it or dismisses it. \`anchor\` is one of ${ANCHOR_IDS.join(" ")}. Replaces any tour on screen. Returns the tour id.`,
		z.tuple([zAny, zAny]),
		function* ([anchor, text]): Eval {
			const id = anchorOf(anchor);
			return yield* start({
				tourId: `point:${id}`,
				steps: [{ anchor: id, say: sayOf(text), until: "click" }],
			});
		},
	);

	interp.defGen(
		"ui/tour",
		-2,
		"(ui/tour id step...)",
		`Walk the user through the app one step at a time. Each step is a plist (:anchor anchor :say text :until next-or-click): :anchor one of ${ANCHOR_IDS.join(" ")}, or none for a callout in the middle; :until next (default) waits for the next button, click waits for the user to click the anchor. Replaces any tour on screen. When the user finishes or skips it, you get a message saying so. Returns the tour id.`,
		z.tuple([zAny, zList]),
		function* ([id, rest]): Eval {
			const tourId = nameOf(id, "a tour id");
			const steps = (listElements(rest) ?? []).map(stepOf);
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
