import { type Clock, type PromptSource, systemClock } from "@repo/shared/host";
import { z } from "zod";
import { type Channels, topic } from "../../channels.ts";
import {
	arrayToList,
	Cell,
	type Eval,
	EvalException,
	type Interp,
	type InterpExtension,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
	str,
	stripProse,
	zList,
} from "../../lisp.ts";
import { plistOptions, splitKeywordArgs } from "../../plist.ts";
import { memoryHost } from "./memory-host.ts";

export const INITIAL_SCORE = 1;
export const REINFORCEMENT = 0.5;
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const FORGET_BELOW = 0.05;
export const MAX_CASCADE_DEPTH = 3;
export const MAX_RECALL_WORDS = 200;
export const LINKED_FIRES_AT = 2;
export const DEFAULT_RECALL_LIMIT = 5;

export const TRIGGER_KINDS = [
	"call",
	"result",
	"error",
	"step",
	"prose",
	"user",
	"recall",
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
	all(): Memory[];
	get(key: string): Memory | undefined;
	put(memory: Memory): void;
	delete(key: string): boolean;
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

function triggerToForm(trigger: Trigger): unknown {
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

function matches(pattern: string, text: string): boolean {
	try {
		return new RegExp(pattern, "i").test(text);
	} catch {
		return text.toLowerCase().includes(pattern.toLowerCase());
	}
}

function bodyText(body: unknown): string {
	return typeof body === "string" ? body : str(body);
}

function unreadable(body: unknown): boolean {
	const printed = str(body);
	return printed.includes("#<") || printed.includes("#:");
}

export const ANYTHING = "_";
export const COMBINATORS = ["all", "any-of", "not"] as const;

function combinatorIn(pattern: unknown): string | undefined {
	if (!(pattern instanceof Cell) || !(pattern.car instanceof Sym))
		return undefined;
	const name = pattern.car.name;
	return COMBINATORS.includes(name as (typeof COMBINATORS)[number])
		? name
		: undefined;
}

function evalPattern(pattern: unknown, leaf: (p: unknown) => boolean): boolean {
	const combinator = combinatorIn(pattern);
	if (combinator === undefined) return leaf(pattern);
	const parts = listToArray((pattern as Cell).cdr as List);
	if (combinator === "all") return parts.every((p) => evalPattern(p, leaf));
	if (combinator === "any-of") return parts.some((p) => evalPattern(p, leaf));
	return !parts.some((p) => evalPattern(p, leaf));
}

function wholly(pattern: string, name: string): boolean {
	try {
		return new RegExp(`^(?:${pattern})$`).test(name);
	} catch {
		return pattern === name;
	}
}

function structurally(pattern: unknown, target: unknown): boolean {
	if (pattern instanceof Sym)
		return (
			pattern.name === ANYTHING ||
			(target instanceof Sym && wholly(pattern.name, target.name))
		);
	if (typeof pattern === "string") return matches(pattern, str(target, false));
	if (pattern instanceof Cell) {
		if (!(target instanceof Cell)) return false;
		let p: unknown = pattern;
		let t: unknown = target;
		while (p instanceof Cell) {
			if (!(t instanceof Cell)) return false;
			if (!structurally(p.car, t.car)) return false;
			p = p.cdr;
			t = t.cdr;
		}
		return true;
	}
	return str(pattern) === str(target);
}

function someSubform(form: unknown, test: (s: unknown) => boolean): boolean {
	if (!(form instanceof Cell)) return false;
	if (test(form)) return true;
	for (let rest: unknown = form; rest instanceof Cell; rest = rest.cdr)
		if (someSubform(rest.car, test)) return true;
	return false;
}

function lastUserMessage(interp: Interp): string {
	const said = interp.getGlobal(newSym("user-messages"));
	if (!(said instanceof Cell)) return "";
	const all = listToArray(said);
	const last = all[all.length - 1];
	return typeof last === "string" ? last : "";
}

interface MemoryEvent {
	kind: TriggerKind;
	text?: string;
	form?: unknown;
}

function fires(trigger: Trigger, event: MemoryEvent): boolean {
	if (trigger.pattern === undefined) return true;
	if (event.form !== undefined)
		return evalPattern(trigger.pattern, (p) =>
			someSubform(event.form, (s) => structurally(p, s)),
		);
	return evalPattern(trigger.pattern, (p) =>
		typeof p === "string" ? matches(p, event.text ?? "") : false,
	);
}

export interface FiredMemory {
	key: string;
	body: string;
}

export const fired = topic<FiredMemory>("memory");

export class MemoryBank {
	private channels?: Channels;
	private readonly fired = new Set<string>();
	private readonly open = new Set<string>();
	private depth = 0;
	private pending = "";
	private spent = 0;
	private dropped = 0;
	private stepping = false;
	private heard = "";

	constructor(
		readonly store: MemoryStore = new VolatileStore(),
		readonly clock: Clock = systemClock,
	) {}

	private now(): number {
		return this.clock.now();
	}

	attach(channels: Channels): void {
		this.channels = channels;
	}

	reset(): void {
		this.fired.clear();
		this.open.clear();
		this.depth = 0;
		this.pending = "";
		this.spent = 0;
		this.dropped = 0;
		this.stepping = false;
	}

	strength(memory: Memory): number {
		const elapsed = Math.max(0, this.now() - memory.lastUsed);
		return memory.score * 2 ** (-elapsed / HALF_LIFE_MS);
	}

	isOpen(key: string): boolean {
		return this.open.has(key);
	}

	beginStep(code: string, interp: Interp): string {
		this.reset();
		this.stepping = true;
		this.sweep();
		this.dispatch({ kind: "step", text: code }, interp);
		const prose = proseIn(code);
		if (prose !== "") this.dispatch({ kind: "prose", text: prose }, interp);
		const said = lastUserMessage(interp);
		if (said !== "" && said !== this.heard) {
			this.heard = said;
			this.dispatch({ kind: "user", text: said }, interp);
		}
		return this.drain();
	}

	endStep(): string {
		this.wireTogether();
		this.open.clear();
		this.stepping = false;
		return this.drain();
	}

	private drain(): string {
		const text = this.pending;
		this.pending = "";
		if (this.dropped === 0) return text;
		const withheld = `... ${this.dropped} more word${this.dropped === 1 ? "" : "s"} of recalled memory not shown (a step surfaces ${MAX_RECALL_WORDS} words); narrow the query, or read one with (recall "key")\n`;
		this.dropped = 0;
		return text + withheld;
	}

	onCall(interp: Interp, form: unknown): void {
		if (form instanceof Cell) this.dispatch({ kind: "call", form }, interp);
	}

	onResult(interp: Interp, value: unknown): void {
		this.dispatch({ kind: "result", text: str(value) }, interp);
	}

	onError(interp: Interp, error: unknown): void {
		this.dispatch({ kind: "error", text: String(error) }, interp);
	}

	remember(memory: Memory): void {
		this.store.put(memory);
	}

	recall(interp: Interp, query: string, limit: number): Memory[] {
		this.sweep();
		const found = this.store
			.all()
			.filter((m) => matches(query, m.key) || matches(query, bodyText(m.body)))
			.sort((a, b) => this.strength(b) - this.strength(a))
			.slice(0, limit);
		for (const memory of found) this.fire(memory, interp);
		return found;
	}

	fire(memory: Memory, interp: Interp): void {
		if (this.fired.has(memory.key)) return;
		if (this.depth >= MAX_CASCADE_DEPTH) return;
		this.fired.add(memory.key);
		this.open.add(memory.key);
		this.reinforce(memory);
		this.say(memory.key, bodyText(memory.body));
		this.depth++;
		try {
			this.dispatch({ kind: "recall", text: memory.key }, interp);
			for (const [key, weight] of memory.links) {
				if (weight < LINKED_FIRES_AT) continue;
				const linked = this.store.get(key);
				if (linked !== undefined) this.fire(linked, interp);
			}
		} finally {
			this.depth--;
		}
	}

	private reinforce(memory: Memory): void {
		memory.score = this.strength(memory) + REINFORCEMENT;
		memory.used += 1;
		memory.lastUsed = this.now();
		this.store.put(memory);
	}

	private wireTogether(): void {
		const keys = [...this.fired];
		if (keys.length < 2) return;
		for (const key of keys) {
			const memory = this.store.get(key);
			if (memory === undefined) continue;
			for (const other of keys)
				if (other !== key)
					memory.links.set(other, (memory.links.get(other) ?? 0) + 1);
			this.store.put(memory);
		}
	}

	private sweep(): void {
		for (const memory of this.store.all())
			if (this.strength(memory) < FORGET_BELOW) this.store.delete(memory.key);
	}

	private dispatch(event: MemoryEvent, interp: Interp): void {
		if (!this.stepping) return;
		for (const memory of this.store.all()) {
			const on = memory.on;
			if (on === undefined || on.kind !== event.kind) continue;
			if (!fires(on, event)) continue;
			this.fire(memory, interp);
		}
	}

	private say(key: string, body: string): void {
		const line = `${key}: ${body}\n`;
		const words = line.split(/\s+/).filter((w) => w !== "").length;
		if (this.spent >= MAX_RECALL_WORDS) {
			this.dropped += words;
			return;
		}
		this.spent += words;
		this.pending += line;
		if (this.channels) fired.emit(this.channels, ["user"], { key, body });
	}
}

function proseIn(code: string): string {
	const forms = stripProse(code);
	let prose = "";
	for (let i = 0; i < code.length; i++)
		if (forms[i] === " " && code[i] !== " ") prose += code[i];
	return prose.trim();
}

export interface MemoryHost {
	store: MemoryStore;
	clock: Clock;
	prompt: PromptSource;
}

export interface MemoryOptions {
	bank?: MemoryBank;
}

export interface MemoryExtension extends InterpExtension {
	readonly bank: MemoryBank;
}

export function memoryExtension(
	host: MemoryHost = memoryHost,
	options: MemoryOptions = {},
): MemoryExtension {
	const bank = options.bank ?? new MemoryBank(host.store, host.clock);
	return Object.assign((interp: Interp): void => registerMemory(interp, bank), {
		bank,
		prompt: host.prompt(),
	});
}

export function bankOf(extension: InterpExtension): MemoryBank | undefined {
	const carried = (extension as Partial<MemoryExtension>).bank;
	return carried instanceof MemoryBank ? carried : undefined;
}

const zString = z.custom<string>(
	(x) => typeof x === "string",
	"string expected",
);

const REMEMBER_ARGS = [
	{
		name: "on",
		type: "form",
		required: false,
		description:
			"a trigger (kind pattern) firing this memory by itself: call, result, error, step, prose, user or recall",
	},
	{
		name: "links",
		type: "list",
		required: false,
		description: "keys of memories that should surface alongside this one",
	},
];

const RECALL_ARGS = [
	{
		name: "limit",
		type: "integer",
		required: false,
		description: `how many memories to surface (default ${DEFAULT_RECALL_LIMIT})`,
	},
];

function memoryToAlist(bank: MemoryBank, memory: Memory): unknown {
	return arrayToList([
		new Cell("key", memory.key),
		new Cell("body", memory.body),
		new Cell("score", bank.strength(memory)),
		new Cell("used", memory.used),
	]);
}

export function registerMemory(interp: Interp, bank: MemoryBank): void {
	bank.reset();
	bank.attach(interp.channels);

	interp.hooks.evalForm.use(function* (i, form, next): Eval {
		bank.onCall(i, form);
		try {
			const value = yield* next(i, form);
			bank.onResult(i, value);
			return value;
		} catch (ex) {
			bank.onError(i, ex);
			throw ex;
		}
	});

	interp.def(
		"memory/remember",
		-1,
		'(remember key body [:on (kind "pattern")] [:links (key...)])',
		"Store a memory under `key`. Its body is either prose, which loads into your context when the memory fires, or a form, a recipe you run later with `(replay key)`. With `:on` the memory fires by itself whenever that event happens. Returns the key.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = splitKeywordArgs(rest, ["on", "links"]);
			const args = listToArray(values);
			const key = args[0];
			if (typeof key !== "string")
				throw new EvalException("memory key must be a string", key);
			const body = args.length > 1 ? args[1] : null;
			if (unreadable(body))
				throw new EvalException(
					"a memory body must be prose or a form that reads back; this one holds a live value",
					body,
				);
			const opts = plistOptions(options, ["on", "links"]);
			const links = new Map<string, number>();
			for (const linked of listToArray((opts.get("links") ?? null) as List))
				if (typeof linked === "string") links.set(linked, LINKED_FIRES_AT);
			const existing = bank.store.get(key);
			bank.remember({
				key,
				body,
				on: parseTrigger(opts.get("on")),
				links,
				score: existing?.score ?? INITIAL_SCORE,
				used: existing?.used ?? 0,
				lastUsed: bank.clock.now(),
			});
			return key;
		},
		REMEMBER_ARGS,
	);

	interp.def(
		"memory/recall",
		-1,
		"(recall query [:limit n])",
		"Retrieve the memories whose key or body matches `query`, strongest first, and load them into your context. Retrieval strengthens what it finds, and opens it for `(revise key body)` until the step ends.",
		z.tuple([zList]),
		([rest]) => {
			const { values, options } = splitKeywordArgs(rest, ["limit"]);
			const query = listToArray(values)[0];
			if (typeof query !== "string")
				throw new EvalException("recall needs a query string", query);
			const opts = plistOptions(options, ["limit"]);
			const raw = opts.get("limit");
			const limit = raw === undefined ? DEFAULT_RECALL_LIMIT : Number(raw);
			return arrayToList(
				bank
					.recall(interp, query, limit)
					.map((memory) => memoryToAlist(bank, memory)),
			);
		},
		RECALL_ARGS,
	);

	interp.def(
		"memories",
		0,
		"(memories)",
		"List every memory as (key score trigger), strongest first. Reading the list strengthens nothing.",
		z.tuple([]),
		() =>
			arrayToList(
				bank.store
					.all()
					.sort((a, b) => bank.strength(b) - bank.strength(a))
					.map((memory) =>
						arrayToList([
							memory.key,
							bank.strength(memory),
							memory.on === undefined ? null : triggerToForm(memory.on),
						]),
					),
			),
	);

	interp.def(
		"memory/forget",
		1,
		"(forget key)",
		"Drop a memory for good; returns t if there was one. Memories also fade on their own: unused, one loses half its strength in a week, and below a floor it is swept away.",
		z.tuple([zString]),
		([key]) => bank.store.delete(key) || null,
	);

	interp.def(
		"memory/revise",
		2,
		"(revise key body)",
		"Replace the body of a memory that fired this step. Retrieval opens a memory for revision and the step closes it again, so revising one you have not recalled is an error: recall it first, then correct what it says.",
		z.tuple([zString, z.unknown()]),
		([key, body]) => {
			const memory = bank.store.get(key);
			if (memory === undefined)
				throw new EvalException("unknown memory", key, false);
			if (!bank.isOpen(key))
				throw new EvalException(
					"this memory is not open for revision; recall it first",
					key,
					false,
				);
			if (unreadable(body))
				throw new EvalException(
					"a memory body must be prose or a form that reads back; this one holds a live value",
					body,
				);
			memory.body = body;
			bank.remember(memory);
			return key;
		},
	);

	interp.defGen(
		"memory/replay",
		1,
		"(replay key)",
		"Evaluate a memory whose body is a form, and return what it produced. This is how a remembered recipe runs: a memory holding a `defun` installs that function when you replay it. A memory holding prose has nothing to run.",
		z.tuple([zString]),
		function* ([key]): Eval {
			const memory = bank.store.get(key);
			if (memory === undefined)
				throw new EvalException("unknown memory", key, false);
			if (typeof memory.body === "string")
				throw new EvalException(
					"this memory holds prose, not a form; read it with (recall key)",
					key,
					false,
				);
			return yield* interp.evalGen(memory.body, null);
		},
	);
}
