import { Reader, str } from "@repo/interpreter/lisp";
import {
	type Answer,
	choice,
	type JsonValue,
	type Judge,
	noul,
	type Question,
} from "@repo/shared/judge";
import { formsOnly } from "@repo/shared/lisp-forms";
import {
	type FiredMemory,
	type Judgment,
	type Keepable,
	type Learner,
	type Observed,
	type Picked,
	type Proposed,
	SPANS_SEEN,
	type Vetting,
} from "./memory.ts";

const KEEPABLE: readonly Keepable[] = ["fact", "procedure", "nothing"];

const NO_SPAN = "none of these states a durable fact";
const NO_FORM = "none of these is a reusable recipe";
const NOT_COVERED = "nothing stored says it yet";
const NOT_STALE = "none of them was contradicted";

const NONE = "none";

function stateOf(observed: Observed): JsonValue {
	return {
		said: observed.said ?? null,
		recent: observed.recent.map((step) => ({
			ran: step.ran,
			prose: step.prose,
			output: step.output,
			failed: step.failed,
		})),
		surfaced: observed.surfaced.map(named),
		known: observed.known.map(named),
	};
}

function named(memory: FiredMemory): JsonValue {
	return { key: memory.key, body: memory.body };
}

function keyed(memories: readonly FiredMemory[]): Record<string, JsonValue> {
	const out: Record<string, JsonValue> = {};
	for (const memory of memories)
		if (memory.key !== NONE) out[memory.key] = memory.body;
	return out;
}

function sentences(text: string): string[] {
	return text
		.split(/(?<=[.!?\n])\s+/)
		.map((span) => span.trim())
		.filter((span) => span !== "");
}

function spansIn(observed: Observed): string[] {
	const out: string[] = [];
	const texts = [
		observed.said ?? "",
		...observed.recent.flatMap((step) => [step.prose, step.output]),
	];
	for (const text of texts)
		for (const span of sentences(text)) if (!out.includes(span)) out.push(span);
	return out.slice(0, SPANS_SEEN);
}

function topLevel(code: string): string[] {
	const reader = new Reader();
	reader.push(formsOnly(code));
	const out: string[] = [];
	while (!reader.isEmpty()) {
		try {
			out.push(str(reader.read()));
		} catch {
			break;
		}
	}
	return out;
}

function formsIn(observed: Observed): string[] {
	const order = [
		...observed.recent.filter((step) => !step.failed),
		...observed.recent.filter((step) => step.failed),
	];
	const out: string[] = [];
	for (const step of order)
		for (const form of topLevel(step.ran))
			if (!out.includes(form)) out.push(form);
	return out.slice(0, SPANS_SEEN);
}

function enumerated(
	items: readonly string[],
	prefix: string,
	nothing: string,
): Record<string, JsonValue> {
	const out: Record<string, JsonValue> = {};
	items.forEach((item, index) => {
		out[`${prefix}${index}`] = item;
	});
	out[NONE] = nothing;
	return out;
}

function questionsFor(
	observed: Observed,
	spans: readonly string[],
	forms: readonly string[],
): Record<string, Question> {
	const memories = keyed(observed.known);
	const questions: Record<string, Question> = {
		worth_keeping: noul(
			"Something in `recent` is worth carrying into a later, unrelated session.",
			{
				true: "a correction, a name that turned out wrong, a constraint found the hard way, a recipe that worked",
				false:
					"routine work, anything the REPL can recompute on demand, anything true only of this task",
			},
		),
		kind: choice("What kind of thing is worth keeping from `recent`?", {
			fact: "something to know: a name, a constraint, a correction. Kept as prose.",
			procedure: "something to do: a form worth running again. Kept as code.",
			nothing: "nothing here is worth keeping",
		}),
	};
	if (spans.length > 0)
		questions.fact_span = choice(
			"Which of these, exactly as it stands, states the durable fact?",
			enumerated(spans, "c", NO_SPAN),
		);
	if (forms.length > 0)
		questions.procedure_form = choice(
			"Which of these forms is worth replaying in a later session, rather than a one-off of this task?",
			enumerated(forms, "f", NO_FORM),
		);
	if (Object.keys(memories).length > 0) {
		questions.covered = choice(
			"Does a memory in `known` already say what `recent` just taught?",
			{ ...memories, [NONE]: NOT_COVERED },
		);
		questions.stale = choice(
			"Which memory in `known` did `recent` show to be wrong? A memory is contradicted when the session proved it false, not when it merely went unused.",
			{ ...memories, [NONE]: NOT_STALE },
		);
	}
	return questions;
}

function picked(answer: Answer | undefined): Picked | undefined {
	if (answer?.type !== "choice") return undefined;
	if (answer.choice === NONE) return undefined;
	return {
		key: answer.choice,
		confidence: answer.probabilities[answer.choice] ?? answer.confidence,
	};
}

function chosen(
	answer: Answer | undefined,
	prefix: string,
	items: readonly string[],
): string | undefined {
	if (answer?.type !== "choice") return undefined;
	if (!answer.choice.startsWith(prefix)) return undefined;
	return items[Number(answer.choice.slice(prefix.length))];
}

function kindIn(answer: Answer | undefined): Keepable {
	if (answer?.type !== "choice") return "nothing";
	const picked = answer.choice as Keepable;
	return KEEPABLE.includes(picked) ? picked : "nothing";
}

function noulIn(answer: Answer | undefined): number {
	return answer?.type === "noul" ? answer.noul : 0;
}

export function judgeLearner(judge: Judge): Learner {
	return {
		async consider(observed, signal) {
			const spans = spansIn(observed);
			const forms = formsIn(observed);
			const judged = await judge(
				{
					state: stateOf(observed),
					questions: questionsFor(observed, spans, forms),
				},
				signal,
			);
			const { answers } = judged;
			const kind = kindIn(answers.kind);
			return {
				worthKeeping: noulIn(answers.worth_keeping),
				kind,
				kindConfidence:
					answers.kind?.type === "choice" ? answers.kind.confidence : 0,
				candidate:
					kind === "fact"
						? chosen(answers.fact_span, "c", spans)
						: kind === "procedure"
							? chosen(answers.procedure_form, "f", forms)
							: undefined,
				covered: picked(answers.covered),
				stale: picked(answers.stale),
				calibrated: judged.calibrated,
			} satisfies Judgment;
		},

		async vet(proposed: Proposed, signal) {
			const memories = keyed(proposed.known);
			const questions: Record<string, Question> = {
				durable: noul(
					"The proposed memory will still be true in a later, unrelated session.",
					{
						true: "a name, a constraint or a correction that outlives this task",
						false: "something true only of what is happening right now",
					},
				),
				recomputable: noul(
					"The REPL could produce this on demand: a doc listing, a discovery call, anything recomputable.",
					{
						true: "a listing, a signature, a value any call would hand back again",
						false: "something that had to be found out the hard way",
					},
				),
			};
			if (Object.keys(memories).length > 0)
				questions.covered = choice(
					"Does a memory in `known` already say what `proposed` says?",
					{ ...memories, [NONE]: NOT_COVERED },
				);
			const judged = await judge(
				{
					state: {
						proposed: { key: proposed.key, body: proposed.body },
						known: proposed.known.map(named),
					},
					questions,
				},
				signal,
			);
			const { answers } = judged;
			return {
				durable: noulIn(answers.durable),
				recomputable: noulIn(answers.recomputable),
				covered: picked(answers.covered),
				calibrated: judged.calibrated,
			} satisfies Vetting;
		},
	};
}
