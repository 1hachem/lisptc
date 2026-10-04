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
import type { Awaitable, Clock, PromptSource } from "@repo/shared/host";
import type { SearchEngine } from "@repo/shared/search";

export const INITIAL_SCORE = 1;

export const TRIGGER_KINDS = [
	"call",
	"result",
	"error",
	"step",
	"prose",
	"user",
	"recall",
	"start",
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface Trigger {
	kind: TriggerKind;
	pattern?: unknown;
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
	if (rest === null) return { kind };
	if (!(rest instanceof Cell))
		throw new EvalException("trigger pattern expected after the kind", rest);
	const pattern = rest.car;
	if (kind === "start")
		throw new EvalException(
			"a start trigger fires at every turn start and takes no pattern: write (start)",
			pattern,
		);
	if (kind === "call" && typeof pattern === "string")
		throw new EvalException(
			'a call trigger matches a form, not a name: write (call (load-mcp "playwright")), or (call (load-mcp)) for any call to it',
			pattern,
		);
	if (kind !== "call" && !isTextPattern(pattern))
		throw new EvalException(
			`a ${kind} trigger matches text, so its pattern must be a string or a combinator over strings`,
			pattern,
		);
	return { kind, pattern };
}

function readableTrigger(value: unknown): Trigger | undefined {
	try {
		return parseTrigger(value);
	} catch {
		return undefined;
	}
}

function contentParts(memory: Memory): unknown[] {
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
	);
	return parts;
}

export function memoryContentForm(memory: Memory): unknown {
	return arrayToList(contentParts(memory));
}

export interface MemoryCounters {
	score: number;
	used: number;
	lastUsed: number;
}

export function countersToForm(counters: MemoryCounters): unknown {
	return arrayToList([
		newSym("counters"),
		newLispKeyword("score"),
		counters.score,
		newLispKeyword("used"),
		counters.used,
		newLispKeyword("last-used"),
		counters.lastUsed,
	]);
}

export function formToCounters(form: unknown): MemoryCounters | undefined {
	if (!(form instanceof Cell) || !(form.car instanceof Sym)) return undefined;
	if (form.car.name !== "counters") return undefined;
	const opts = plistOptions(form.cdr as List, ["score", "used", "last-used"]);
	return {
		score: Number(opts.get("score") ?? INITIAL_SCORE),
		used: Number(opts.get("used") ?? 0),
		lastUsed: Number(opts.get("last-used") ?? 0),
	};
}

export function memoryToForm(memory: Memory): unknown {
	const parts = contentParts(memory);
	parts.push(
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

export interface MemoryHost {
	store: MemoryStore;
	clock: Clock;
	prompt: PromptSource;
	search: SearchEngine;
}
