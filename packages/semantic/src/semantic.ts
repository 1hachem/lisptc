import { compare, isNumeric } from "@repo/interpreter/arith";
import { EvalException, messageOf } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import { type Interp, runSync, type StateCodec } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	lispToJson,
	listToArray,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zList } from "@repo/interpreter/schema";
import type { InterpExtension } from "@repo/interpreter/session";
import { withTimeout } from "@repo/interpreter/timeout";
import {
	type ActivityEntry,
	activityKind,
} from "@repo/journal-catalog/activity";
import type { EmbeddingModel } from "@repo/shared/embedding";
import type { Clock, PromptSource } from "@repo/shared/host";
import type {
	JudgeRequest,
	JudgeResult,
	Judgment,
	SystemOneModel,
	Verdict,
} from "@repo/shared/system-one";
import { z } from "zod";

export const SEMANTIC_TIMEOUT_MS = 30_000;

export const DEFAULT_MIN = 0.5;

export const DUPLICATE_SIMILARITY = 0.8;

export const CLUSTER_SIMILARITY = 0.47;

export const OUTLIER_SIMILARITY = 0.47;

export interface SemanticHost {
	systemOne: SystemOneModel;
	embedder: EmbeddingModel;
	clock: Clock;
	prompt: PromptSource;
	memories: PromptSource;
}

const callSeqCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

const CALL_OPTIONS = ["model", "timeout"] as const;
const PREDICATE_OPTIONS = [...CALL_OPTIONS, "min"] as const;

const NONE_LABEL = "none";

const DEFAULT_LEVELS = ["very low", "low", "moderate", "high", "very high"];

function filledMemories(host: SemanticHost): string {
	const fills: Record<string, string> = {
		"timeout-ms": String(SEMANTIC_TIMEOUT_MS),
		"top-level": String(DEFAULT_LEVELS.length - 1),
		"lowest-level": DEFAULT_LEVELS[0] ?? "",
		"highest-level": DEFAULT_LEVELS.at(-1) ?? "",
		min: String(DEFAULT_MIN),
		"duplicate-similarity": String(DUPLICATE_SIMILARITY),
		"cluster-similarity": String(CLUSTER_SIMILARITY),
		"outlier-similarity": String(OUTLIER_SIMILARITY),
	};
	return host.memories().replace(/\{\{([a-z-]+)\}\}/g, (_, name: string) => {
		const fill = fills[name];
		if (fill === undefined)
			throw new Error(`no value fills {{${name}}} in the semantic memories`);
		return fill;
	});
}

export function semanticExtension(host: SemanticHost): InterpExtension {
	return Object.assign(
		(interp: Interp): void => registerSemantic(interp, host),
		{
			prompt: host.prompt(),
			memories: filledMemories(host),
		},
	);
}

type Track = <T>(
	form: string,
	opts: Map<string, unknown>,
	run: (signal: AbortSignal) => Promise<T>,
) => Promise<T>;

function tracker(interp: Interp, host: SemanticHost): Track {
	const calls = interp.state(
		"semantic/calls",
		callSeqCodec,
		0,
		"The number of the last call by meaning, which numbers the activity the user sees.",
	);
	return (form, opts, run) => {
		const n = calls.get() + 1;
		calls.set(n);
		const id = `semantic-${n}`;
		const startedAt = host.clock.now();
		const announce = (
			state: ActivityEntry["state"],
			ms?: number,
			error?: unknown,
		): void =>
			record(interp.channels, activityKind, {
				kind: "semantic",
				icon: "meaning",
				label: form,
				state,
				...(error === undefined ? {} : { error: messageOf(error) }),
				id,
				startedAt,
				...(ms === undefined ? {} : { ms }),
			});
		announce("started");
		const controller = new AbortController();
		return withTimeout(run(controller.signal), timeoutOf(opts), form).then(
			(res) => {
				announce("done", host.clock.now() - startedAt);
				return res;
			},
			(ex) => {
				announce("failed", host.clock.now() - startedAt, ex);
				controller.abort();
				throw ex;
			},
		);
	};
}

type Ask = (
	form: string,
	req: JudgeRequest,
	opts: Map<string, unknown>,
) => Promise<JudgeResult>;

function modelOf(opts: Map<string, unknown>): string | undefined {
	return opts.has("model") ? textOf(opts.get("model"), ":model") : undefined;
}

function asker(track: Track, host: SemanticHost): Ask {
	const asked = new Map<string, Promise<JudgeResult>>();
	return (form, req, opts) => {
		const model = modelOf(opts);
		const full: JudgeRequest = model === undefined ? req : { ...req, model };
		const key = JSON.stringify(full);
		const known = asked.get(key);
		if (known !== undefined) return known;
		const pending = track(form, opts, (signal) =>
			host.systemOne.judge(full, signal),
		);
		pending.catch(() => asked.delete(key));
		asked.set(key, pending);
		return pending;
	};
}

type Embed = (
	form: string,
	xs: unknown[],
	opts: Map<string, unknown>,
) => Promise<number[][]>;

function textFor(x: unknown): string {
	return typeof x === "string" ? x : str(x);
}

function embedder(track: Track, host: SemanticHost): Embed {
	const known = new Map<string, Promise<number[]>>();
	return (form, xs, opts) => {
		const model = modelOf(opts);
		const texts = xs.map(textFor);
		const keyOf = (text: string): string => JSON.stringify([model, text]);
		const fresh = [...new Set(texts.filter((t) => !known.has(keyOf(t))))];
		if (fresh.length > 0) {
			const batch = track(form, opts, (signal) =>
				host.embedder.embed(
					{ inputs: fresh, ...(model === undefined ? {} : { model }) },
					signal,
				),
			);
			fresh.forEach((text, i) => {
				const one = batch.then((res) => {
					const vector = res.vectors[i];
					if (vector === undefined)
						throw new EvalException(`no embedding came back for ${text}`, text);
					return vector;
				});
				known.set(keyOf(text), one);
				one.catch(() => known.delete(keyOf(text)));
			});
		}
		return Promise.all(
			texts.map((t) => known.get(keyOf(t)) as Promise<number[]>),
		);
	};
}

function cosine(a: number[], b: number[]): number {
	if (a.length !== b.length)
		throw new EvalException(
			"two meanings measured on different scales cannot be compared",
			null,
		);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] as number) * (b[i] as number);
		na += (a[i] as number) ** 2;
		nb += (b[i] as number) ** 2;
	}
	return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function examplesFrom(
	x: unknown,
	options: Option[],
): { option: Option; text: unknown }[] {
	const examples: { option: Option; text: unknown }[] = [];
	for (const entry of itemsOf(x, ":examples")) {
		const head = entry instanceof Cell ? entry.car : undefined;
		const label =
			head instanceof LispKeyword
				? head.name
				: typeof head === "string"
					? head
					: undefined;
		const option = options.find((o) => o.label === label);
		if (option === undefined || !(entry instanceof Cell))
			throw new EvalException(
				"%choose: an entry of :examples is (option example...), naming one of the options",
				entry,
			);
		for (const text of itemsOf(entry.cdr, ":examples"))
			examples.push({ option, text });
	}
	const missing = options.find((o) => !examples.some((e) => e.option === o));
	if (missing !== undefined)
		throw new EvalException(
			`%choose: option ${missing.label} has no examples`,
			x,
		);
	return examples;
}

function distinctOf(xs: unknown[]): { reps: unknown[]; repOf: number[] } {
	const reps: unknown[] = [];
	const seen = new Map<string, number>();
	const repOf = xs.map((x) => {
		const key = textFor(x);
		const at = seen.get(key);
		if (at !== undefined) return at;
		seen.set(key, reps.length);
		reps.push(x);
		return reps.length - 1;
	});
	return { reps, repOf };
}

function textOf(x: unknown, what: string): string {
	if (typeof x !== "string")
		throw new EvalException(`${what} must be a string`, x);
	return x;
}

function numberOf(x: unknown, what: string): number {
	if (!isNumeric(x)) throw new EvalException(`${what} must be a number`, x);
	return Number(x);
}

function timeoutOf(opts: Map<string, unknown>): number {
	return opts.has("timeout")
		? numberOf(opts.get("timeout"), ":timeout")
		: SEMANTIC_TIMEOUT_MS;
}

function minOf(opts: Map<string, unknown>): number {
	if (!opts.has("min")) return DEFAULT_MIN;
	const min = numberOf(opts.get("min"), ":min");
	if (min < 0 || min > 1)
		throw new EvalException(":min must be between 0 and 1", opts.get("min"));
	return min;
}

function stateOf(x: unknown): unknown {
	try {
		return lispToJson(x) ?? str(x);
	} catch {
		return str(x);
	}
}

function itemsOf(x: unknown, form: string): unknown[] {
	if (x !== null && !(x instanceof Cell))
		throw new EvalException(`${form} takes a list of items`, x);
	return listToArray(x);
}

function argsOf(
	rest: List,
	form: string,
	count: number,
	allowed: readonly string[],
	usage: string,
): { args: unknown[]; opts: Map<string, unknown> } {
	const { values, options } = splitKeywordArgs(rest, allowed);
	const args = listToArray(values);
	if (args.length !== count)
		throw new EvalException(
			`${form} takes ${usage}, then keyword options`,
			rest,
		);
	return { args, opts: plistOptions(options, allowed) };
}

function noulOf(res: JudgeResult, id: string): number {
	const answer = res.answers[id];
	if (answer?.type !== "noul")
		throw new EvalException(`no yes/no answer came back for ${id}`, id);
	return answer.noul;
}

function choiceOf(
	res: JudgeResult,
	id: string,
): Extract<Verdict, { type: "choice" }> {
	const answer = res.answers[id];
	if (answer?.type !== "choice")
		throw new EvalException(`no choice came back for ${id}`, id);
	return answer;
}

function scoreOf(res: JudgeResult, id: string): number {
	const answer = res.answers[id];
	if (answer?.type !== "score")
		throw new EvalException(`no score came back for ${id}`, id);
	return answer.score;
}

function truth(yes: boolean): true | null {
	return yes ? true : null;
}

function sameSyntax(a: unknown, b: unknown): boolean | undefined {
	if (Object.is(a, b)) return true;
	if (isNumeric(a) && isNumeric(b)) return compare(a, b) === 0;
	if (typeof a === "string" && typeof b === "string" && a === b) return true;
	return undefined;
}

interface Option {
	label: string;
	value: unknown;
	description: string | null;
}

function optionsFrom(x: unknown, form: string): Option[] {
	const options = itemsOf(x, form).map((entry): Option => {
		if (entry instanceof LispKeyword)
			return { label: entry.name, value: entry, description: null };
		if (typeof entry === "string")
			return { label: entry, value: entry, description: null };
		if (
			entry instanceof Cell &&
			(entry.car instanceof LispKeyword || typeof entry.car === "string")
		) {
			const label =
				entry.car instanceof LispKeyword ? entry.car.name : entry.car;
			const description = entry.cdr instanceof Cell ? entry.cdr.car : entry.cdr;
			return {
				label,
				value: entry.car,
				description: textOf(description, `the description of ${label}`),
			};
		}
		throw new EvalException(
			`${form}: an option is a keyword, a string, or (option . "what it means")`,
			entry,
		);
	});
	if (options.length === 0)
		throw new EvalException(`${form} needs at least one option`, x);
	const labels = new Set(options.map((o) => o.label));
	if (labels.size !== options.length)
		throw new EvalException(`${form}: two options share a name`, x);
	return options;
}

function levelsFrom(x: unknown, dimension: string): string[] {
	if (x === undefined) return DEFAULT_LEVELS.map((l) => `${l} ${dimension}`);
	const levels = itemsOf(x, "a score").map((l, i) =>
		textOf(l, `level ${i} of the rubric`),
	);
	if (levels.length < 2 || levels.length > 10)
		throw new EvalException("a rubric has between 2 and 10 levels", x);
	return levels;
}

type Pair = "same" | "less" | "greater" | "at-most" | "at-least";

const PAIR_WORDS: Record<Exclude<Pair, "same">, string> = {
	less: "less than",
	greater: "greater than",
	"at-most": "less than or equal to",
	"at-least": "greater than or equal to",
};

function pairQuestion(pair: Pair, by: string | undefined): string {
	const judged = by === undefined ? "" : ` Judge only by ${by}.`;
	if (pair === "same")
		return `Do \`first\` and \`second\` mean the same thing?${judged}`;
	return `Is \`first\` ${PAIR_WORDS[pair]} \`second\`${by === undefined ? "" : ` in ${by}`}?`;
}

function pairSyntax(pair: Pair, a: unknown, b: unknown): boolean | undefined {
	if (pair === "same") {
		const same = sameSyntax(a, b);
		if (same !== undefined) return same;
		return isNumeric(a) && isNumeric(b) ? false : undefined;
	}
	if (!isNumeric(a) || !isNumeric(b)) return undefined;
	const order = compare(a, b);
	if (pair === "less") return order < 0;
	if (pair === "greater") return order > 0;
	if (pair === "at-most") return order <= 0;
	return order >= 0;
}

interface Subject {
	name: string;
	usage: string;
	doc: string;
	question: (about: string) => string;
	syntax?: (x: unknown, about: string) => boolean | undefined;
}

const SUBJECTS: Subject[] = [
	{
		name: "%is-a",
		usage: '(%is-a x "kind" [:min p])',
		doc: 'Return t when `x` is the kind of thing described, judged by meaning: (%is-a row "person data"). Use it where a type test cannot see the answer.',
		question: (kind) => `Is this ${kind}?`,
	},
	{
		name: "%enough?",
		usage: '(%enough? x "purpose" [:min p])',
		doc: 'Return t when `x` holds enough information for the purpose: (%enough? facts "to book the flight"). Ask the user when it returns nil, instead of guessing.',
		question: (purpose) => `Is this enough information ${purpose}?`,
	},
	{
		name: "%string-contains?",
		usage: '(%string-contains? text "concept" [:min p])',
		doc: 'Return t when `text` mentions the concept, in any words: (%string-contains? mail "a refund"). A literal match answers without a call.',
		question: (concept) => `Does this text mention ${concept}?`,
		syntax: (x, concept) =>
			typeof x === "string" && x.includes(concept) ? true : undefined,
	},
	{
		name: "%string-prefix?",
		usage: '(%string-prefix? text "concept" [:min p])',
		doc: 'Return t when `text` opens with what is described: (%string-prefix? msg "a greeting"). A literal prefix answers without a call.',
		question: (concept) => `Does this text begin with ${concept}?`,
		syntax: (x, concept) =>
			typeof x === "string" && x.startsWith(concept) ? true : undefined,
	},
	{
		name: "%string-suffix?",
		usage: '(%string-suffix? text "concept" [:min p])',
		doc: 'Return t when `text` ends with what is described: (%string-suffix? msg "a question"). A literal suffix answers without a call.',
		question: (concept) => `Does this text end with ${concept}?`,
		syntax: (x, concept) =>
			typeof x === "string" && x.endsWith(concept) ? true : undefined,
	},
];

export function registerSemantic(interp: Interp, host: SemanticHost): void {
	const track = tracker(interp, host);
	const ask = asker(track, host);
	const embed = embedder(track, host);

	const noul = (
		form: string,
		state: unknown,
		instructions: string,
		opts: Map<string, unknown>,
	): Promise<number> =>
		ask(
			form,
			{ state, questions: { q: { type: "noul", instructions } } },
			opts,
		).then((res) => noulOf(res, "q"));

	const noulEach = (
		form: string,
		items: unknown[],
		instructions: string,
		opts: Map<string, unknown>,
	): Promise<number[]> => {
		if (items.length === 0) return Promise.resolve([]);
		const questions: Record<string, Judgment> = {};
		items.forEach((_, i) => {
			questions[`q${i}`] = {
				type: "noul",
				instructions: `${instructions} Judge only \`items[${i}]\`.`,
			};
		});
		return ask(
			form,
			{ state: { items: items.map(stateOf) }, questions },
			opts,
		).then((res) => items.map((_, i) => noulOf(res, `q${i}`)));
	};

	interp.def(
		"%p",
		-1,
		'(%p x "question" [:timeout ms])',
		'Ask a yes/no question about `x` and return the probability of yes, from 0 to 1: (%p mail "is a refund request"). The raw number, for a threshold or a weight of your own; every % predicate is this compared with :min.',
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%p",
				2,
				CALL_OPTIONS,
				"a value and a question",
			);
			return noul(
				"%p",
				stateOf(args[0]),
				textOf(args[1], "the question"),
				opts,
			);
		},
	);

	interp.def(
		"%p-each",
		-1,
		'(%p-each items "question" [:timeout ms])',
		"Ask the same yes/no question about every element of `items` in one call and return the probabilities, in order. What %filter, %some, %every and %count-if are built on.",
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%p-each",
				2,
				CALL_OPTIONS,
				"a list and a question",
			);
			return noulEach(
				"%p-each",
				itemsOf(args[0], "%p-each"),
				textOf(args[1], "the question"),
				opts,
			).then(arrayToList);
		},
	);

	interp.def(
		"%choose",
		-1,
		'(%choose x options [:none value] [:min p] [:question "..."] [:examples examples] [:timeout ms])',
		'Pick the option that fits `x` best and return it as written: (%choose ticket \'(:billing :technical :other)). An option is a keyword, a string, or (option . "what it means"). With :none, "none of these" is an option too, and choosing it returns that value; :min returns it as well when the best option is less likely than p. :question says what is being picked. With :examples, a list of (option example...), it picks the option whose examples are nearest in meaning instead, and :min is the least similarity: (%choose ticket \'(:billing :technical) :examples \'((:billing "I was charged twice") (:technical "the app crashes"))).',
		z.tuple([zList]),
		([rest]) => {
			const allowed = [
				...PREDICATE_OPTIONS,
				"none",
				"question",
				"examples",
			] as const;
			const { args, opts } = argsOf(
				rest,
				"%choose",
				2,
				allowed,
				"a value and a list of options",
			);
			const options = optionsFrom(args[1], "%choose");
			const withNone = opts.has("none");
			if (withNone && options.some((o) => o.label === NONE_LABEL))
				throw new EvalException(
					`%choose: "${NONE_LABEL}" is taken by :none; rename that option`,
					args[1],
				);
			const criteria: Record<string, string | null> = {};
			for (const o of options) criteria[o.label] = o.description;
			if (withNone) criteria[NONE_LABEL] = "None of the other options fits.";
			const instructions = opts.has("question")
				? textOf(opts.get("question"), ":question")
				: "Which option fits best?";
			const fallback = withNone ? opts.get("none") : null;
			const min = opts.has("min") ? minOf(opts) : 0;
			if (opts.has("examples")) {
				const examples = examplesFrom(opts.get("examples"), options);
				const exact = examples.find(
					(e) => textFor(e.text) === textFor(args[0]),
				);
				if (exact !== undefined) return exact.option.value;
				return embed(
					"%choose",
					[args[0], ...examples.map((e) => e.text)],
					opts,
				).then(([target, ...vectors]) => {
					let best: { option: Option; similarity: number } | undefined;
					vectors.forEach((v, i) => {
						const similarity = cosine(target ?? [], v);
						const option = (examples[i] as { option: Option }).option;
						if (best === undefined || similarity > best.similarity)
							best = { option, similarity };
					});
					return best === undefined || best.similarity < min
						? fallback
						: best.option.value;
				});
			}
			return ask(
				"%choose",
				{
					state: stateOf(args[0]),
					questions: { q: { type: "choice", instructions, criteria } },
				},
				opts,
			).then((res) => {
				const answer = choiceOf(res, "q");
				const picked = options.find((o) => o.label === answer.choice);
				if (picked === undefined) return fallback;
				const p = answer.probabilities[answer.choice] ?? 0;
				return p < min ? fallback : picked.value;
			});
		},
	);

	interp.def(
		"%score",
		-1,
		'(%score x "dimension" [levels] [:timeout ms])',
		'Rate `x` along a dimension and return where it falls on the levels, from 0 for the first level up, possibly between two: (%score ticket "urgency" \'("can wait" "today" "right now")). Without levels it rates on five, from very low to very high. Compare scores only when they share their levels.',
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = splitKeywordArgs(rest, CALL_OPTIONS);
			const args = listToArray(values);
			if (args.length < 2 || args.length > 3)
				throw new EvalException(
					"%score takes a value, a dimension and optional levels, then keyword options",
					rest,
				);
			const opts = plistOptions(options, CALL_OPTIONS);
			const dimension = textOf(args[1], "the dimension");
			return ask(
				"%score",
				{
					state: stateOf(args[0]),
					questions: {
						q: {
							type: "score",
							instructions: `Rate it by ${dimension}.`,
							criteria: levelsFrom(args[2], dimension),
						},
					},
				},
				opts,
			).then((res) => scoreOf(res, "q"));
		},
	);

	interp.def(
		"%score-each",
		-1,
		'(%score-each items "dimension" [levels] [:timeout ms])',
		"Rate every element of `items` on the same dimension and levels in one call and return the scores, in order. What %sort, %max and %min are built on.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = splitKeywordArgs(rest, CALL_OPTIONS);
			const args = listToArray(values);
			if (args.length < 2 || args.length > 3)
				throw new EvalException(
					"%score-each takes a list, a dimension and optional levels, then keyword options",
					rest,
				);
			const opts = plistOptions(options, CALL_OPTIONS);
			const items = itemsOf(args[0], "%score-each");
			if (items.length === 0) return null;
			const dimension = textOf(args[1], "the dimension");
			const criteria = levelsFrom(args[2], dimension);
			const questions: Record<string, Judgment> = {};
			items.forEach((_, i) => {
				questions[`q${i}`] = {
					type: "score",
					instructions: `Rate \`items[${i}]\` by ${dimension}.`,
					criteria,
				};
			});
			return ask(
				"%score-each",
				{ state: { items: items.map(stateOf) }, questions },
				opts,
			).then((res) => arrayToList(items.map((_, i) => scoreOf(res, `q${i}`))));
		},
	);

	const definePair = (
		name: string,
		pair: Pair,
		negate: boolean,
		doc: string,
	): void => {
		const by = pair === "same" ? "context" : "by";
		interp.def(
			name,
			-1,
			`(${name} a b [:${by} "..."] [:min p] [:timeout ms])`,
			doc,
			z.tuple([zList]),
			([rest]) => {
				const allowed = [...PREDICATE_OPTIONS, by] as const;
				const { args, opts } = argsOf(rest, name, 2, allowed, "two values");
				const [a, b] = args;
				const exact = pairSyntax(pair, a, b);
				if (exact !== undefined) return truth(exact !== negate);
				const about = opts.has(by) ? textOf(opts.get(by), `:${by}`) : undefined;
				return noul(
					name,
					{ first: stateOf(a), second: stateOf(b) },
					pairQuestion(pair, about),
					opts,
				).then((p) => truth(p >= minOf(opts) !== negate));
			},
		);
	};

	definePair(
		"%=",
		"same",
		false,
		'Return t when `a` and `b` mean the same thing: (%= "Hi there!" "Hello!"). Two numbers, or two equal values, answer without a call, so (%= 2 2.0) is t and (%= 1 2) is nil. :context names what sameness is judged by.',
	);
	definePair(
		"%/=",
		"same",
		true,
		"Return t when `a` and `b` do not mean the same thing. The same judgment as %=, negated.",
	);
	definePair(
		"%<",
		"less",
		false,
		'Return t when `a` is less than `b`: (%< "a cat" "a horse" :by "size"). Two numbers compare as numbers, without a call.',
	);
	definePair(
		"%>",
		"greater",
		false,
		'Return t when `a` is greater than `b`: (%> "scorching" "warm" :by "temperature"). Two numbers compare as numbers, without a call.',
	);
	definePair(
		"%<=",
		"at-most",
		false,
		"Return t when `a` is at most `b`. Two numbers compare as numbers, without a call.",
	);
	definePair(
		"%>=",
		"at-least",
		false,
		"Return t when `a` is at least `b`. Two numbers compare as numbers, without a call.",
	);

	for (const subject of SUBJECTS)
		interp.def(
			subject.name,
			-1,
			subject.usage,
			subject.doc,
			z.tuple([zList]),
			([rest]) => {
				const { args, opts } = argsOf(
					rest,
					subject.name,
					2,
					PREDICATE_OPTIONS,
					"a value and a description",
				);
				const about = textOf(args[1], "the description");
				const exact = subject.syntax?.(args[0], about);
				if (exact !== undefined) return truth(exact);
				return noul(
					subject.name,
					stateOf(args[0]),
					subject.question(about),
					opts,
				).then((p) => truth(p >= minOf(opts)));
			},
		);

	interp.def(
		"%member",
		-1,
		"(%member item xs [:min p] [:timeout ms])",
		'Return the tail of `xs` from the first element that means the same as `item`, or nil: (%member "a refund" topics). An equal element answers without a call.',
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%member",
				2,
				PREDICATE_OPTIONS,
				"an item and a list",
			);
			const [item, xs] = args;
			const items = itemsOf(xs, "%member");
			const tail = (at: number): unknown =>
				at === -1 ? null : arrayToList(items.slice(at));
			const exact = items.findIndex((x) => sameSyntax(item, x) === true);
			if (exact !== -1) return tail(exact);
			const min = minOf(opts);
			return noulEach(
				"%member",
				items,
				`Does it mean the same as ${str(item)}?`,
				opts,
			).then((ps) => tail(ps.findIndex((p) => p >= min)));
		},
	);

	const pick = (
		form: string,
		rest: List,
		found: (items: unknown[], at: number) => unknown,
	): Promise<unknown> | null => {
		const { args, opts } = argsOf(
			rest,
			form,
			2,
			PREDICATE_OPTIONS,
			"a description and a list",
		);
		const description = textOf(args[0], "the description");
		const items = itemsOf(args[1], form);
		if (items.length === 0) return null;
		const criteria: Record<string, string | null> = {};
		items.forEach((x, i) => {
			criteria[String(i)] = typeof x === "string" ? x : str(x);
		});
		criteria[NONE_LABEL] = "None of the items fits.";
		const min = opts.has("min") ? minOf(opts) : 0;
		return ask(
			form,
			{
				state: description,
				questions: {
					q: {
						type: "choice",
						instructions: "Which item matches the description?",
						criteria,
					},
				},
			},
			opts,
		).then((res) => {
			const answer = choiceOf(res, "q");
			const at = Number(answer.choice);
			const p = answer.probabilities[answer.choice] ?? 0;
			if (!Number.isInteger(at) || p < min) return null;
			return found(items, at);
		});
	};

	interp.def(
		"%find",
		-1,
		'(%find "description" xs [:min p] [:timeout ms])',
		'Return the element of `xs` that best matches the description, or nil when none does: (%find "a pet" animals). One call over the whole list.',
		z.tuple([zList]),
		([rest]) => pick("%find", rest, (items, at) => items[at]),
	);

	interp.def(
		"%position",
		-1,
		'(%position "description" xs [:min p] [:timeout ms])',
		"Return the index of the element of `xs` that best matches the description, or nil when none does.",
		z.tuple([zList]),
		([rest]) => pick("%position", rest, (_, at) => BigInt(at)),
	);

	interp.def(
		"%embed",
		-1,
		"(%embed x [:timeout ms])",
		'Return the meaning of `x` as a vector, a list of numbers: (%embed "a refund request"). A text is embedded as written, any other value as it prints. The same text twice in a session is embedded once.',
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(rest, "%embed", 1, CALL_OPTIONS, "a value");
			return embed("%embed", args, opts).then(([v]) => arrayToList(v ?? []));
		},
	);

	interp.def(
		"%similarity",
		-1,
		"(%similarity a b [:timeout ms])",
		'Return how close `a` and `b` are in meaning, the cosine of their embeddings, near 1 for the same meaning: (%similarity "refund" "money back"). Two equal values answer 1 without embedding. The raw number, for a threshold of your own.',
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%similarity",
				2,
				CALL_OPTIONS,
				"two values",
			);
			const [a, b] = args;
			if (sameSyntax(a, b) === true || textFor(a) === textFor(b)) return 1;
			return embed("%similarity", [a, b], opts).then(([va, vb]) =>
				cosine(va ?? [], vb ?? []),
			);
		},
	);

	const similarityMin = (
		opts: Map<string, unknown>,
		fallback: number,
	): number => (opts.has("min") ? minOf(opts) : fallback);

	interp.def(
		"%remove-duplicates",
		-1,
		"(%remove-duplicates xs [:min similarity] [:timeout ms])",
		`Return xs with every element dropped that means the same as an earlier one, first occurrences kept in order: (%remove-duplicates questions). Two elements are the same when the similarity of their embeddings is at least :min, default ${DUPLICATE_SIMILARITY}. Equal elements drop without embedding.`,
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%remove-duplicates",
				1,
				PREDICATE_OPTIONS,
				"a list",
			);
			const { reps } = distinctOf(itemsOf(args[0], "%remove-duplicates"));
			const min = similarityMin(opts, DUPLICATE_SIMILARITY);
			if (reps.length < 2) return arrayToList(reps);
			return embed("%remove-duplicates", reps, opts).then((vectors) => {
				const kept: number[] = [];
				vectors.forEach((v, i) => {
					if (kept.every((k) => cosine(vectors[k] ?? [], v) < min))
						kept.push(i);
				});
				return arrayToList(kept.map((i) => reps[i]));
			});
		},
	);

	interp.def(
		"%cluster",
		-1,
		"(%cluster xs [:min similarity] [:timeout ms])",
		`Group the elements of xs by meaning and return the groups, a list of lists, each in the order of xs and ordered by its first element: (%cluster reviews). Two elements share a group when a chain of elements links them whose neighbours are at least :min similar, default ${CLUSTER_SIMILARITY}. Raise :min for tighter groups. Equal elements share a group without embedding.`,
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%cluster",
				1,
				PREDICATE_OPTIONS,
				"a list",
			);
			const items = itemsOf(args[0], "%cluster");
			const { reps, repOf } = distinctOf(items);
			const min = similarityMin(opts, CLUSTER_SIMILARITY);
			const grouped = (root: (i: number) => number): unknown => {
				const groups = new Map<number, unknown[]>();
				items.forEach((x, i) => {
					const g = root(repOf[i] as number);
					const group = groups.get(g);
					if (group === undefined) groups.set(g, [x]);
					else group.push(x);
				});
				return arrayToList([...groups.values()].map(arrayToList));
			};
			if (reps.length < 2) return grouped(() => 0);
			return embed("%cluster", reps, opts).then((vectors) => {
				const parent = reps.map((_, i) => i);
				const root = (i: number): number => {
					while (parent[i] !== i) i = parent[i] as number;
					return i;
				};
				for (let i = 0; i < vectors.length; i++)
					for (let j = i + 1; j < vectors.length; j++)
						if (cosine(vectors[i] ?? [], vectors[j] ?? []) >= min) {
							const a = root(i);
							const b = root(j);
							if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
						}
				return grouped(root);
			});
		},
	);

	interp.def(
		"%similarity-each",
		-1,
		"(%similarity-each x items [:timeout ms])",
		"Return how close `x` is in meaning to every element of `items`, in order, measured in one call. What %sort, %min and %max with :near are built on.",
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%similarity-each",
				2,
				CALL_OPTIONS,
				"a value and a list",
			);
			const [x, xs] = args;
			const items = itemsOf(xs, "%similarity-each");
			const same = items.map(
				(y) => sameSyntax(x, y) === true || textFor(x) === textFor(y),
			);
			const others = items.filter((_, i) => !same[i]);
			if (others.length === 0) return arrayToList(items.map(() => 1));
			return embed("%similarity-each", [x, ...others], opts).then(
				([target, ...vectors]) => {
					let at = 0;
					return arrayToList(
						items.map((_, i) =>
							same[i] ? 1 : cosine(target ?? [], vectors[at++] ?? []),
						),
					);
				},
			);
		},
	);

	interp.def(
		"%outliers",
		-1,
		"(%outliers xs [:min similarity] [:timeout ms])",
		`Return the elements of xs that nothing else in xs is close to in meaning, in the order of xs: (%outliers reviews). An element is an outlier when its nearest other element is less than :min similar, default ${OUTLIER_SIMILARITY}. An element with an equal twin in xs is never one.`,
		z.tuple([zList]),
		([rest]) => {
			const { args, opts } = argsOf(
				rest,
				"%outliers",
				1,
				PREDICATE_OPTIONS,
				"a list",
			);
			const items = itemsOf(args[0], "%outliers");
			const { reps, repOf } = distinctOf(items);
			const min = similarityMin(opts, OUTLIER_SIMILARITY);
			const twinned = reps.map(
				(_, r) => repOf.filter((at) => at === r).length > 1,
			);
			if (reps.length < 2) return null;
			return embed("%outliers", reps, opts).then((vectors) => {
				const lonely = vectors.map((v, r) => {
					if (twinned[r]) return false;
					let nearest = -1;
					vectors.forEach((w, o) => {
						if (o !== r) nearest = Math.max(nearest, cosine(v, w));
					});
					return nearest < min;
				});
				return arrayToList(items.filter((_, i) => lonely[repOf[i] as number]));
			});
		},
	);

	runSync(interp, MACROS);
}

const MACROS = `
(setq _%option
      (lambda (options key default)
        (cond ((null options) default)
              ((eq (car options) key) (car (cdr options)))
              (t (_%option (cdr (cdr options)) key default)))))

(setq _%drop
      (lambda (options key)
        (cond ((null options) nil)
              ((eq (car options) key) (_%drop (cdr (cdr options)) key))
              (t (cons (car options)
                       (cons (car (cdr options))
                             (_%drop (cdr (cdr options)) key)))))))

(setq _%over
      (lambda (ps least)
        (cond ((null ps) nil)
              (t (cons (>= (car ps) least) (_%over (cdr ps) least))))))

(setq _%judged
      (lambda (description xs options)
        (_%over (apply %p-each (cons xs (cons (concat "Does it fit the description: " description "?")
                                              (_%drop options :min))))
                (_%option options :min 0.5))))

(setq _%keep
      (lambda (xs verdicts want)
        (cond ((null xs) nil)
              ((eq (car verdicts) want)
               (cons (car xs) (_%keep (cdr xs) (cdr verdicts) want)))
              (t (_%keep (cdr xs) (cdr verdicts) want)))))

(setq %filter
      (lambda (description xs &rest options)
        (_%keep xs (_%judged description xs options) t)))
(_set-doc '%filter "(%filter description xs [:min p] [:timeout ms])"
          "Return the elements of xs the description fits, judged in one call: (%filter \\"engineers\\" staff).")

(setq %remove-if
      (lambda (description xs &rest options)
        (_%keep xs (_%judged description xs options) nil)))
(_set-doc '%remove-if "(%remove-if description xs [:min p] [:timeout ms])"
          "Return the elements of xs the description does not fit, judged in one call: (%remove-if \\"spam\\" mails).")

(setq %count-if
      (lambda (description xs &rest options)
        (length (_%keep xs (_%judged description xs options) t))))
(_set-doc '%count-if "(%count-if description xs [:min p] [:timeout ms])"
          "Return how many elements of xs the description fits, judged in one call.")

(setq %some
      (lambda (description xs &rest options)
        (cond ((memq t (_%judged description xs options)) t))))
(_set-doc '%some "(%some description xs [:min p] [:timeout ms])"
          "Return t when the description fits at least one element of xs, judged in one call.")

(setq %every
      (lambda (description xs &rest options)
        (cond ((memq nil (_%judged description xs options)) nil) (t t))))
(_set-doc '%every "(%every description xs [:min p] [:timeout ms])"
          "Return t when the description fits every element of xs, judged in one call.")

(setq _%zip
      (lambda (xs ys)
        (cond ((null xs) nil)
              (t (cons (cons (car xs) (car ys)) (_%zip (cdr xs) (cdr ys)))))))

(setq _%rate
      (lambda (xs by levels rest)
        (cond ((null by) (error "say what to rate by, as :by \\"urgency\\""))
              (t (_%zip (apply %score-each
                               (_append (cons xs (cons by (cond (levels (list levels)))))
                                        rest))
                        xs)))))

(setq _%distances
      (lambda (xs near rest)
        (_%zip (mapcar (lambda (s) (- 1 s))
                       (apply %similarity-each (cons near (cons xs rest))))
               xs)))

(setq _%rated
      (lambda (xs options)
        (cond ((null (_%option options :near nil))
               (_%rate xs
                       (_%option options :by nil)
                       (_%option options :levels nil)
                       (_%drop (_%drop (_%drop options :by) :levels) :desc)))
              ((_%option options :by nil)
               (error "say :by or :near, not both"))
              (t (_%distances xs
                              (_%option options :near nil)
                              (_%drop (_%drop (_%drop options :near) :levels) :desc))))))

(setq _%ordered
      (lambda (ordered desc)
        (cond (desc (reverse ordered))
              (t ordered))))

(setq %sort
      (lambda (xs &rest options)
        (_%ordered (mapcar cdr (sort (_%rated xs options)
                                     (lambda (a b) (< (car a) (car b)))))
                   (_%option options :desc nil))))
(_set-doc '%sort "(%sort xs :by dimension [:levels levels] [:desc t] [:timeout ms]) or (%sort xs :near query [:desc t] [:timeout ms])"
          "Return xs ordered by a judged dimension, lowest first, or highest first with :desc t: (%sort tickets :by \\"urgency\\" :desc t). One call rates them all, then a plain sort orders them. With :near, xs is ordered by distance in meaning from the query, closest first: (head (%sort issues :near \\"billing problems\\") 5) is the five closest.")

(setq %max
      (lambda (xs &rest options)
        (car (apply %sort (cons xs (_append options (list :desc t)))))))
(_set-doc '%max "(%max xs :by dimension [:levels levels] [:timeout ms]) or (%max xs :near query)"
          "Return the element of xs rated highest on the dimension: (%max offers :by \\"value for money\\"). With :near, the element farthest in meaning from the query.")

(setq %min
      (lambda (xs &rest options)
        (car (apply %sort (cons xs options)))))
(_set-doc '%min "(%min xs :by dimension [:levels levels] [:timeout ms]) or (%min xs :near query)"
          "Return the element of xs rated lowest on the dimension. With :near, the element closest in meaning to the query: (%min faqs :near question).")

(setq _%tests
      (lambda (clauses)
        (cond ((null clauses) nil)
              ((eq (car (car clauses)) t) (_%tests (cdr clauses)))
              (t (cons (car (car clauses)) (_%tests (cdr clauses)))))))

(setq _%branches
      (lambda (picked clauses test)
        (mapcar (lambda (clause)
                  (cond ((eq (car clause) t) clause)
                        (t (cons (list test picked (car clause)) (cdr clause)))))
                clauses)))

(setq _%quoted
      (lambda (clauses)
        (mapcar (lambda (clause)
                  (cond ((eq (car clause) t) clause)
                        (t (cons (list 'quote (car clause)) (cdr clause)))))
                clauses)))

(setq _%dispatch
      (lambda (picked x options clauses test)
        \`((lambda (,picked) (cond ,@(_%branches picked clauses test)))
          (%choose ,x ,options :none nil))))

(setq %cond
      (macro (x &rest clauses)
        (_%dispatch (gensym) x (cons 'list (_%tests clauses)) clauses 'equal)))
(_set-doc '%cond "(%cond x (\\"test\\" body...)... (t body...))"
          "Run the body of the clause whose test describes x best, chosen in one call: (%cond ticket (\\"asks for a refund\\" (refund ticket)) (\\"reports a bug\\" (file-bug ticket)) (t (escalate ticket))). The t clause runs when no test fits; with none, the value is nil. Only the choice is judged: the body runs as ordinary Lisp.")

(setq %case
      (macro (x &rest clauses)
        (_%dispatch (gensym) x (list 'quote (_%tests clauses)) (_%quoted clauses) 'eq)))
(_set-doc '%case "(%case x (:key body...)... (t body...))"
          "Run the body of the clause whose keyword fits x best, chosen in one call: (%case weather (:hot (stay-in)) (:mild (walk)) (t (check-again))). The t clause runs when no keyword fits; with none, the value is nil.")
`;
