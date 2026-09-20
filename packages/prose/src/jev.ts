import { str } from "@repo/interpreter/lisp";
import {
	type ProseExcuse,
	type ProseSense,
	type ProseSort,
	skippedAsProse,
} from "./prose.ts";
import {
	type ChoiceQuestion,
	choice,
	type NoulQuestion,
	noul,
	type Questions,
} from "@typesafe-ai/sdk";
import type { JevHost } from "@repo/jev/jev";
import { jevHost } from "@repo/jev/jev-host";

const PROSE_ODDS = 0.5;
const SPANS = 8;

const ASIDE = "an aside about the program, not a call";

const REASONS = {
	[ASIDE]:
		"A remark, caveat or answer addressed to a reader: it says something about the program or its result rather than asking for work.",
	"a step named before it was written":
		"A placeholder for work still to come: it names an action the author intends to perform later, as a plan or a TODO.",
	"a phrase that reads as English":
		"An ordinary sentence or list of words, where the first word is a verb, article or noun rather than anything that could name a function.",
} as const;

const SITUATION =
	"An author writes Lisp into a REPL with prose around the forms: the parenthesised forms are the program, everything around them is prose the REPL skips. The REPL has nothing bound to this span's head, so it must decide whether to run the span or skip it. Skipping a call hides a real error; running a sentence raises a pointless one.";

function isProse(span: string, error?: string): NoulQuestion {
	return noul(
		{
			situation: SITUATION,
			span,
			...(error === undefined ? {} : { failure: error }),
			question:
				"Is this span English prose that happens to sit in parentheses, rather than a form the author expects the REPL to evaluate?",
		},
		{
			true: "Prose: an aside, a gloss, a sentence, a plan. Nothing is lost by skipping it.",
			false:
				"A call the author expects to run: the name is missing, misspelled, defined later, or names a tool whose server is not loaded yet.",
		},
	);
}

function whyProse(span: string): ChoiceQuestion<typeof REASONS> {
	return choice(
		{
			premise: `Suppose ${span} is prose the author wrote rather than a call they expected to run.`,
			question: "What makes it read as prose?",
		},
		REASONS,
	);
}

export function jevSort(host: JevHost = jevHost): ProseSort {
	return async ({ code, spans, bound }) => {
		const asking = spans.slice(0, SPANS);
		const questions: Questions = {};
		for (const [i, span] of asking.entries()) {
			questions[`prose${i}`] = isProse(span);
			questions[`why${i}`] = whyProse(span);
		}
		const sensed = new Map<string, ProseSense>();
		try {
			const { answers } = await host.ask({
				state: { program: code, bound: [...bound] },
				questions,
			});
			for (const [i, span] of asking.entries()) {
				const verdict = answers[`prose${i}`];
				if (verdict?.type !== "noul") continue;
				if (verdict.noul < PROSE_ODDS) {
					sensed.set(span, false);
					continue;
				}
				const why = answers[`why${i}`];
				sensed.set(span, why?.type === "choice" ? why.choice : ASIDE);
			}
		} catch {
			sensed.clear();
		}
		return sensed;
	};
}

export function jevExcuse(host: JevHost = jevHost): ProseExcuse {
	return async (_interp, form, error) => {
		const span = str(form);
		try {
			const { answers } = await host.ask({
				state: { span, failure: error.message },
				questions: { prose: isProse(span, error.message), why: whyProse(span) },
			});
			return answers.prose.noul < PROSE_ODDS
				? undefined
				: skippedAsProse(form, answers.why.choice);
		} catch {
			return undefined;
		}
	};
}
