import { EvalException } from "@repo/interpreter/errors";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { plistOptions } from "@repo/interpreter/plist";
import { Reader } from "@repo/interpreter/reader";
import type { Awaitable, Clock, PromptSource } from "@repo/shared/host";
import type { SearchEngine } from "@repo/shared/search";

export const INITIAL_SCORE = 1;
export const LINKED_FIRES_AT = 2;
export const WHEN_FIRES_AT = 0.7;

export const TRIGGER_KINDS = [
	"call",
	"result",
	"error",
	"step",
	"prose",
	"user",
	"recall",
	"start",
	"when",
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface Trigger {
	kind: TriggerKind;
	pattern?: unknown;
	unless?: string;
}

export interface Memory {
	key: string;
	body: unknown;
	on?: Trigger;
	links: Map<string, number>;
	score: number;
	used: number;
	lastUsed: number;
}

export interface MemoryStore {
	all(): Awaitable<Memory[]>;
	get(key: string): Awaitable<Memory | undefined>;
	put(memory: Memory): Awaitable<void>;
	delete(key: string): Awaitable<boolean>;
}

export class VolatileStore implements MemoryStore {
	private readonly memories = new Map<string, Memory>();

	all(): Memory[] {
		return [...this.memories.values()];
	}

	get(key: string): Memory | undefined {
		return this.memories.get(key);
	}

	put(memory: Memory): void {
		this.memories.set(memory.key, memory);
	}

	delete(key: string): boolean {
		return this.memories.delete(key);
	}
}

export const COMBINATORS = ["all", "any-of", "not"] as const;

export function combinatorIn(pattern: unknown): string | undefined {
	if (!(pattern instanceof Cell) || !(pattern.car instanceof Sym))
		return undefined;
	const name = pattern.car.name;
	return COMBINATORS.includes(name as (typeof COMBINATORS)[number])
		? name
		: undefined;
}

export function triggerToForm(trigger: Trigger): unknown {
	const parts: unknown[] = [newSym(trigger.kind)];
	if (trigger.pattern !== undefined) parts.push(trigger.pattern);
	if (trigger.unless !== undefined)
		parts.push(newLispKeyword("unless"), trigger.unless);
	return arrayToList(parts);
}

function isTextPattern(pattern: unknown): boolean {
	if (typeof pattern === "string") return true;
	if (combinatorIn(pattern) === undefined) return false;
	return listToArray((pattern as Cell).cdr as List).every(isTextPattern);
}

export function parseTrigger(value: unknown): Trigger | undefined {
	if (value === null || value === undefined) return undefined;
	if (!(value instanceof Cell) || !(value.car instanceof Sym))
		throw new EvalException("trigger expected, as (kind pattern)", value);
	const kind = value.car.name as TriggerKind;
	if (!TRIGGER_KINDS.includes(kind))
		throw new EvalException(
			`unknown trigger kind; expected one of ${TRIGGER_KINDS.join(" ")}`,
			value.car,
		);
	const rest = value.cdr;
	if (rest === null && kind === "when")
		throw new EvalException(
			'a when trigger describes in words the situation that needs the memory: write :when "the agent is about to drive a web page, or a page call just failed"',
			value,
		);
	if (rest === null) return { kind };
	if (!(rest instanceof Cell))
		throw new EvalException("trigger pattern expected after the kind", rest);
	const pattern = rest.car;
	if (kind === "start")
		throw new EvalException(
			"a start trigger fires once, on the user's first message, and takes no pattern: write (start)",
			pattern,
		);
	if (kind === "call" && typeof pattern === "string")
		throw new EvalException(
			'a call trigger matches a form, not a name: write (call (load-mcp "playwright")), or (call (load-mcp)) for any call to it',
			pattern,
		);
	if (kind === "when" && typeof pattern !== "string")
		throw new EvalException(
			"a when trigger is matched against the situation, so it is one string describing the situation that needs the memory",
			pattern,
		);
	if (kind !== "call" && !isTextPattern(pattern))
		throw new EvalException(
			`a ${kind} trigger matches text, so its pattern must be a string or a combinator over strings`,
			pattern,
		);
	if (kind !== "when" || rest.cdr === null) return { kind, pattern };
	const unless = exclusion(
		plistOptions(rest.cdr as List, ["unless"]).get("unless"),
	);
	return unless === undefined ? { kind, pattern } : { kind, pattern, unless };
}

function exclusion(unless: unknown): string | undefined {
	if (unless === null || unless === undefined) return undefined;
	if (typeof unless !== "string" || unless.trim() === "")
		throw new EvalException(
			'an :unless is one string describing the look-alike situation that must not fire the memory: write :unless "the agent only names a page, without driving it"',
			unless,
		);
	return unless;
}

export function authoredTrigger(
	on: unknown,
	when: unknown,
	unless?: unknown,
): Trigger | undefined {
	const given = (value: unknown) => value !== null && value !== undefined;
	if (given(unless) && !given(when))
		throw new EvalException(
			"an :unless narrows a :when, so it is given alongside one",
			unless,
		);
	if (given(on) && given(when))
		throw new EvalException(
			"a memory fires on one trigger: give :on or :when, not both",
			when,
		);
	if (given(when)) {
		if (typeof when !== "string" || when.trim() === "")
			throw new EvalException(
				"a :when is one string describing the situation that needs the memory: what the user asks, what the agent is doing, an error or a result it just got",
				when,
			);
		const excluded = exclusion(unless);
		return excluded === undefined
			? { kind: "when", pattern: when }
			: { kind: "when", pattern: when, unless: excluded };
	}
	const trigger = parseTrigger(on);
	if (trigger?.kind === "when")
		throw new EvalException(
			'a situation is written with :when, not :on: write :when "the agent is about to drive a web page"',
			on,
		);
	return trigger;
}

function readableTrigger(value: unknown): Trigger | undefined {
	try {
		return parseTrigger(value);
	} catch {
		return undefined;
	}
}

export function memoryToForm(memory: Memory): unknown {
	const parts: unknown[] = [
		newSym("memory"),
		memory.key,
		newLispKeyword("body"),
		memory.body,
	];
	if (memory.on !== undefined)
		parts.push(newLispKeyword("on"), triggerToForm(memory.on));
	parts.push(
		newLispKeyword("links"),
		arrayToList([...memory.links].map(([k, w]) => new Cell(k, w))),
		newLispKeyword("score"),
		memory.score,
		newLispKeyword("used"),
		memory.used,
		newLispKeyword("last-used"),
		memory.lastUsed,
	);
	return arrayToList(parts);
}

export function formToMemory(form: unknown): Memory | undefined {
	if (!(form instanceof Cell)) return undefined;
	if (!(form.car instanceof Sym) || form.car.name !== "memory")
		return undefined;
	const rest = form.cdr;
	if (!(rest instanceof Cell) || typeof rest.car !== "string") return undefined;
	const opts = plistOptions(rest.cdr as List, [
		"body",
		"on",
		"links",
		"score",
		"used",
		"last-used",
	]);
	const links = new Map<string, number>();
	for (const pair of listToArray((opts.get("links") ?? null) as List))
		if (pair instanceof Cell && typeof pair.car === "string")
			links.set(pair.car, Number(pair.cdr));
	return {
		key: rest.car,
		body: opts.get("body") ?? null,
		on: readableTrigger(opts.get("on")),
		links,
		score: Number(opts.get("score") ?? INITIAL_SCORE),
		used: Number(opts.get("used") ?? 0),
		lastUsed: Number(opts.get("last-used") ?? 0),
	};
}

const BUILTIN_HEADER = /^\(memory\s/;

function builtinHeader(line: string, body: string): Memory {
	const reader = new Reader();
	reader.push(line);
	const form = reader.read();
	if (
		!(form instanceof Cell) ||
		!(form.car instanceof Sym) ||
		form.car.name !== "memory"
	)
		throw new EvalException(
			'a built-in memory opens with a header line, (memory "key" :when "situation" :unless "situation" :links ("key"...)) or (memory "key" :on (kind "pattern")), and its body is the text below it',
			line,
		);
	const rest = form.cdr;
	if (!(rest instanceof Cell) || typeof rest.car !== "string")
		throw new EvalException("a built-in memory needs a string key", line);
	if (body === "")
		throw new EvalException("a built-in memory needs a body", rest.car);
	const opts = plistOptions(rest.cdr as List, [
		"on",
		"when",
		"unless",
		"links",
	]);
	const links = new Map<string, number>();
	for (const linked of listToArray((opts.get("links") ?? null) as List)) {
		if (typeof linked !== "string")
			throw new EvalException("a link is the key of another memory", linked);
		links.set(linked, LINKED_FIRES_AT);
	}
	return {
		key: rest.car,
		body,
		on: authoredTrigger(opts.get("on"), opts.get("when"), opts.get("unless")),
		links,
		score: INITIAL_SCORE,
		used: 0,
		lastUsed: 0,
	};
}

export function readBuiltins(source: string): Memory[] {
	const memories: Memory[] = [];
	let header: string | undefined;
	let body: string[] = [];
	const close = (): void => {
		if (header !== undefined)
			memories.push(builtinHeader(header, body.join("\n").trim()));
	};
	for (const line of source.split("\n")) {
		if (BUILTIN_HEADER.test(line)) {
			close();
			header = line;
			body = [];
		} else if (header !== undefined) body.push(line);
		else if (line.trim() !== "")
			throw new EvalException(
				"text before the first (memory ...) header belongs to no memory",
				line,
			);
	}
	close();
	return memories;
}

export interface Turn {
	readonly role: string;
	readonly content: string;
}

export interface Situation {
	readonly conversation: readonly Turn[];
}

export interface Cue {
	readonly key: string;
	readonly situation: string;
	readonly unless?: string;
	readonly gist: string;
}

export type Recognize = (
	situation: Situation,
	cues: readonly Cue[],
) => Awaitable<ReadonlyMap<string, number>>;

export const recognizeNothing: Recognize = () => new Map();

export interface MemoryHost {
	store: MemoryStore;
	clock: Clock;
	prompt: PromptSource;
	memories: PromptSource;
	search: SearchEngine;
	recognize: Recognize;
}
