import { type Channels, topic } from "@repo/interpreter/channels";
import {
	arrayToList,
	Cell,
	driveAsync,
	type Eval,
	EvalException,
	type Interp,
	type InterpExtension,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
	settled,
	str,
	zList,
} from "@repo/interpreter/lisp";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { annotating, type SessionHooks, slot } from "@repo/interpreter/session";
import {
	type Awaitable,
	type Clock,
	type PromptSource,
	systemClock,
} from "@repo/shared/host";
import { formsOnly } from "@repo/shared/lisp-forms";
import { z } from "zod";
import { memoryHost } from "./memory-host.ts";

export const INITIAL_SCORE = 1;
export const REINFORCEMENT = 0.5;
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const FORGET_BELOW = 0.05;
export const MAX_CASCADE_DEPTH = 3;
export const MAX_RECALL_WORDS = 200;
export const LINKED_FIRES_AT = 2;
export const DEFAULT_RECALL_LIMIT = 5;

export const WINDOW = 3;
export const SAID_CHARS = 1000;
export const RAN_CHARS = 4000;
export const OUTPUT_CHARS = 2000;
export const KNOWN_SEEN = 20;
export const KNOWN_BODY_CHARS = 200;
export const SPANS_SEEN = 24;
export const SLUG_WORDS = 5;

const SLUG_SKIPS = new Set([
	"a",
	"an",
	"and",
	"as",
	"at",
	"for",
	"in",
	"is",
	"it",
	"not",
	"of",
	"on",
	"or",
	"that",
	"the",
	"to",
	"was",
	"with",
]);

export const LEARN_AT = 0.5;
export const LESSON_AT = 0.5;
export const LEARN_AFTER_LESSON_AT = 0.3;
export const COVERED_AT = 0.6;
export const SUSPECT_AT = 0.5;
export const FORGET_AT = 0.8;
export const DURABLE_AT = 0.5;
export const RECOMPUTABLE_AT = 0.7;

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

function userMessages(interp: Interp): string[] {
	const said = interp.getGlobal(newSym("user-messages"));
	if (!(said instanceof Cell)) return [];
	return listToArray(said).filter((m): m is string => typeof m === "string");
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

export interface Stepped {
	readonly ran: string;
	readonly prose: string;
	readonly output: string;
	readonly failed: boolean;
}

export interface Observed {
	readonly said?: string;
	readonly recent: readonly Stepped[];
	readonly surfaced: readonly FiredMemory[];
	readonly known: readonly FiredMemory[];
}

export interface Picked {
	readonly key: string;
	readonly confidence: number;
}

export type Keepable = "fact" | "procedure" | "nothing";

export interface Judgment {
	readonly cost?: number;
	readonly worthKeeping: number;
	readonly lesson?: number;
	readonly kind: Keepable;
	readonly kindConfidence: number;
	readonly candidate?: string;
	readonly trigger?: string;
	readonly covered?: Picked;
	readonly stale?: Picked;
	readonly calibrated: boolean;
}

export interface Proposed {
	readonly key: string;
	readonly body: string;
	readonly known: readonly FiredMemory[];
}

export interface Vetting {
	readonly cost?: number;
	readonly durable: number;
	readonly recomputable: number;
	readonly covered?: Picked;
	readonly calibrated: boolean;
}

export interface Learner {
	consider(o: Observed, signal?: AbortSignal): Awaitable<Judgment | undefined>;
	vet(p: Proposed, signal?: AbortSignal): Awaitable<Vetting | undefined>;
}

export const noLearner: Learner = {
	consider: () => undefined,
	vet: () => undefined,
};

export interface Learning {
	readonly at: "consider" | "vet";
	readonly ms: number;
	readonly failed?: string;
	readonly judged?: Judgment;
	readonly vetted?: Vetting;
	readonly refusal?: string;
}

export type Watcher = (event: Learning) => void;

export const noWatcher: Watcher = () => {};

export interface Learned {
	what: "candidate" | "dropped" | "advice";
	text: string;
}

export const learned = topic<Learned>("learn");

export interface Assessment {
	failed?: string;
	worthKeeping?: number;
	lesson?: number;
	kind?: Keepable;
	kindConfidence?: number;
	candidate?: string;
	covered?: Picked;
	stale?: Picked;
	calibrated?: boolean;
	did: Learned["what"][];
}

export const assessed = topic<Assessment>("judged");

export const ELIDED = "\n... elided ...\n";

function clip(text: string, chars: number): string {
	if (text.length <= chars) return text;
	if (ELIDED.length >= chars) return text.slice(0, chars);
	const head = Math.ceil((chars - ELIDED.length) / 2);
	const tail = chars - ELIDED.length - head;
	return text.slice(0, head) + ELIDED + text.slice(text.length - tail);
}

function tail(text: string, chars: number): string {
	return text.length <= chars ? text : text.slice(text.length - chars);
}

export function slugFor(body: string): string {
	const words = body
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((word) => word !== "" && !SLUG_SKIPS.has(word));
	const slug = words.slice(0, SLUG_WORDS).join("-");
	return slug === "" ? "lesson" : slug;
}

function nudgeFor(judgment: Judgment): string {
	const body = judgment.candidate;
	if (body === undefined)
		return `the last steps taught something worth keeping (${judgment.kind}), but nothing in them states it on its own. Write it in your own words with memory/remember, and hook it to the event that will bring it back.`;
	const quoted =
		judgment.kind === "procedure" ? `'${body}` : JSON.stringify(body);
	const on =
		judgment.trigger === undefined ? "" : `\n  :on '${judgment.trigger}`;
	return [
		`this is worth keeping. run it, or change the wording and run yours:`,
		`(memory/remember "${slugFor(body)}"`,
		`  ${quoted}${on})`,
	].join("\n");
}

function knownIn(
	all: Memory[],
	strength: (memory: Memory) => number,
): FiredMemory[] {
	return [...all]
		.sort((a, b) => strength(b) - strength(a))
		.slice(0, KNOWN_SEEN)
		.map((memory) => ({
			key: memory.key,
			body: clip(bodyText(memory.body), KNOWN_BODY_CHARS),
		}));
}

function refusalIn(vetting: Vetting): string | undefined {
	if (vetting.durable < DURABLE_AT)
		return "this reads as situational; it will not be true in another session";
	if (vetting.recomputable >= RECOMPUTABLE_AT)
		return "the REPL can tell you this; look it up instead";
	const covered = vetting.covered;
	if (covered !== undefined && covered.confidence >= COVERED_AT)
		return `${covered.key} already says this; recall it and revise`;
	return undefined;
}

export class MemoryBank {
	private channels?: Channels;
	private readonly fired = new Set<string>();
	private readonly open = new Set<string>();
	private surfaced: FiredMemory[] = [];
	private depth = 0;
	private pending = "";
	private spent = 0;
	private dropped = 0;
	private stepping = false;
	private heard = 0;
	private ran = "";
	private errored = false;
	private lastError = "";
	private readonly window: Stepped[] = [];
	private awaiting?: Omit<Stepped, "output"> & { trailing: string } & {
		surfaced: FiredMemory[];
	};
	private outstanding?: Promise<Judgment | undefined>;
	private failure?: string;
	private unanswered = false;

	constructor(
		readonly store: MemoryStore = new VolatileStore(),
		readonly clock: Clock = systemClock,
		readonly learner: Learner = noLearner,
		readonly watcher: Watcher = noWatcher,
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
		this.surfaced = [];
		this.depth = 0;
		this.pending = "";
		this.spent = 0;
		this.dropped = 0;
		this.stepping = false;
		this.errored = false;
		this.lastError = "";
		this.ran = "";
	}

	strength(memory: Memory): number {
		const elapsed = Math.max(0, this.now() - memory.lastUsed);
		return memory.score * 2 ** (-elapsed / HALF_LIFE_MS);
	}

	isOpen(key: string): boolean {
		return this.open.has(key);
	}

	*hear(interp: Interp): Eval<FiredMemory[]> {
		const said = userMessages(interp);
		if (said.length === this.heard) return [];
		this.heard = said.length;
		const last = said[said.length - 1];
		if (last === undefined || last === "") return [];
		this.stepping = true;
		yield* this.sweep();
		const before = this.surfaced.length;
		yield* this.dispatch({ kind: "user", text: last }, interp);
		this.stepping = false;
		this.drain();
		return this.surfaced.slice(before);
	}

	*beginStep(code: string, interp: Interp): Eval<string> {
		const learnt = yield* this.settle();
		this.stepping = true;
		this.ran = code;
		yield* this.sweep();
		yield* this.dispatch({ kind: "step", text: code }, interp);
		const prose = proseIn(code);
		if (prose !== "")
			yield* this.dispatch({ kind: "prose", text: prose }, interp);
		return learnt + this.drain();
	}

	*endStep(): Eval<string> {
		yield* this.wireTogether();
		this.awaiting = {
			ran: clip(this.ran, RAN_CHARS),
			prose: proseIn(this.ran),
			surfaced: [...this.surfaced],
			failed: this.errored,
			trailing: this.lastError,
		};
		const text = this.drain();
		this.reset();
		return text;
	}

	observe(interp: Interp, output: string): void {
		const record = this.awaiting;
		this.awaiting = undefined;
		if (record === undefined) return;
		const { trailing, surfaced, ...rest } = record;
		const whole = [output, trailing].filter((part) => part !== "").join("\n");
		this.window.push({ ...rest, output: clip(whole, OUTPUT_CHARS) });
		while (this.window.length > WINDOW) this.window.shift();
		if (this.learner === noLearner) return;
		if (this.outstanding !== undefined) return;
		this.outstanding = this.ask(interp, surfaced);
	}

	private async ask(
		interp: Interp,
		surfaced: FiredMemory[],
	): Promise<Judgment | undefined> {
		const began = this.now();
		try {
			const said = userMessages(interp).at(-1);
			const judged = await this.learner.consider({
				said: said === undefined ? undefined : tail(said, SAID_CHARS),
				recent: [...this.window],
				surfaced,
				known: knownIn(await this.store.all(), (m) => this.strength(m)),
			});
			this.watcher({
				at: "consider",
				ms: this.now() - began,
				judged,
			});
			return judged;
		} catch (ex) {
			this.failure = ex instanceof Error ? ex.message : String(ex);
			this.watcher({
				at: "consider",
				ms: this.now() - began,
				failed: this.failure,
			});
			return undefined;
		}
	}

	private *settle(): Eval<string> {
		const pending = this.outstanding;
		if (pending === undefined) return "";
		this.outstanding = undefined;
		const judgment = yield* settled(pending);
		const failed = this.failure;
		this.failure = undefined;
		if (judgment === undefined) {
			assessed.emit(this.channels, { user: { failed, did: [] } });
			return "";
		}
		return yield* this.act(judgment);
	}

	private *act(judgment: Judgment): Eval<string> {
		let text = "";
		const did: Learned["what"][] = [];
		const stale = judgment.stale;
		if (stale !== undefined) {
			if (stale.confidence >= FORGET_AT && judgment.calibrated) {
				if (yield* settled(this.store.delete(stale.key))) {
					text += this.note(
						"dropped",
						`${stale.key} is gone: the last steps showed it to be wrong.`,
					);
					did.push("dropped");
				}
			} else if (stale.confidence >= SUSPECT_AT) {
				yield* this.doubt(stale.key);
			}
		}
		const covered = judgment.covered;
		const lesson = judgment.lesson ?? 0;
		const worth =
			judgment.worthKeeping >= LEARN_AT ||
			(lesson >= LESSON_AT && judgment.worthKeeping >= LEARN_AFTER_LESSON_AT);
		if (
			worth &&
			judgment.kind !== "nothing" &&
			!(covered !== undefined && covered.confidence >= COVERED_AT)
		) {
			text += this.note("candidate", nudgeFor(judgment));
			this.unanswered = true;
			did.push("candidate");
		}
		assessed.emit(this.channels, {
			user: {
				worthKeeping: judgment.worthKeeping,
				kind: judgment.kind,
				kindConfidence: judgment.kindConfidence,
				lesson: judgment.lesson,
				candidate: judgment.candidate,
				covered,
				stale,
				calibrated: judgment.calibrated,
				did,
			},
		});
		return text;
	}

	private *doubt(key: string): Eval<void> {
		const memory = yield* settled(this.store.get(key));
		if (memory === undefined) return;
		memory.score = this.strength(memory) / 2;
		memory.lastUsed = this.now();
		yield* settled(this.store.put(memory));
	}

	takeUnanswered(): boolean {
		const held = this.unanswered;
		this.unanswered = false;
		return held;
	}

	private note(what: Learned["what"], text: string): string {
		learned.emit(this.channels, { user: { what, text } });
		return `<learn>\n${text}\n</learn>\n`;
	}

	*vetted(key: string, body: unknown): Eval<void> {
		if (this.learner === noLearner) return;
		const began = this.now();
		let vetting: Vetting | undefined;
		try {
			const known = knownIn(yield* settled(this.store.all()), (m) =>
				this.strength(m),
			);
			vetting = yield* settled(
				this.learner.vet({ key, body: bodyText(body), known }),
			);
		} catch (ex) {
			const failed = ex instanceof Error ? ex.message : String(ex);
			this.watcher({ at: "vet", ms: this.now() - began, failed });
			assessed.emit(this.channels, { user: { failed, did: [] } });
			return;
		}
		const refusal = vetting === undefined ? undefined : refusalIn(vetting);
		this.watcher({
			at: "vet",
			ms: this.now() - began,
			vetted: vetting,
			refusal,
		});
		if (vetting === undefined || refusal === undefined) return;
		if (vetting.calibrated) throw new EvalException(refusal, key, false);
		this.pending += this.note("advice", `${key}: ${refusal}`);
	}

	private drain(): string {
		const text = this.pending;
		this.pending = "";
		if (this.dropped === 0) return text;
		const withheld = `... ${this.dropped} more word${this.dropped === 1 ? "" : "s"} of recalled memory not shown (a step surfaces ${MAX_RECALL_WORDS} words); narrow the query, or read one with (recall "key")\n`;
		this.dropped = 0;
		return text + withheld;
	}

	*onCall(interp: Interp, form: unknown): Eval<void> {
		if (form instanceof Cell)
			yield* this.dispatch({ kind: "call", form }, interp);
	}

	*onResult(interp: Interp, value: unknown): Eval<void> {
		yield* this.dispatch({ kind: "result", text: str(value) }, interp);
	}

	*onError(interp: Interp, error: unknown): Eval<void> {
		const text = String(error);
		if (this.stepping) {
			this.errored = true;
			this.lastError = text;
		}
		yield* this.dispatch({ kind: "error", text }, interp);
	}

	*remember(memory: Memory): Eval<void> {
		yield* settled(this.store.put(memory));
	}

	*recall(interp: Interp, query: string, limit: number): Eval<Memory[]> {
		yield* this.sweep();
		const all = yield* settled(this.store.all());
		const found = all
			.filter((m) => matches(query, m.key) || matches(query, bodyText(m.body)))
			.sort((a, b) => this.strength(b) - this.strength(a))
			.slice(0, limit);
		for (const memory of found) yield* this.fire(memory, interp);
		return found;
	}

	*fire(memory: Memory, interp: Interp): Eval<void> {
		if (this.fired.has(memory.key)) return;
		if (this.depth >= MAX_CASCADE_DEPTH) return;
		this.fired.add(memory.key);
		this.open.add(memory.key);
		yield* this.reinforce(memory);
		this.surface(memory.key, bodyText(memory.body));
		this.depth++;
		try {
			yield* this.dispatch({ kind: "recall", text: memory.key }, interp);
			for (const [key, weight] of memory.links) {
				if (weight < LINKED_FIRES_AT) continue;
				const linked = yield* settled(this.store.get(key));
				if (linked !== undefined) yield* this.fire(linked, interp);
			}
		} finally {
			this.depth--;
		}
	}

	private *reinforce(memory: Memory): Eval<void> {
		memory.score = this.strength(memory) + REINFORCEMENT;
		memory.used += 1;
		memory.lastUsed = this.now();
		yield* settled(this.store.put(memory));
	}

	private *wireTogether(): Eval<void> {
		const keys = [...this.fired];
		if (keys.length < 2) return;
		for (const key of keys) {
			const memory = yield* settled(this.store.get(key));
			if (memory === undefined) continue;
			for (const other of keys)
				if (other !== key)
					memory.links.set(other, (memory.links.get(other) ?? 0) + 1);
			yield* settled(this.store.put(memory));
		}
	}

	private *sweep(): Eval<void> {
		const all = yield* settled(this.store.all());
		for (const memory of all)
			if (this.strength(memory) < FORGET_BELOW)
				yield* settled(this.store.delete(memory.key));
	}

	private *dispatch(event: MemoryEvent, interp: Interp): Eval<void> {
		if (!this.stepping) return;
		const all = yield* settled(this.store.all());
		for (const memory of all) {
			const on = memory.on;
			if (on === undefined || on.kind !== event.kind) continue;
			if (!fires(on, event)) continue;
			yield* this.fire(memory, interp);
		}
	}

	private surface(key: string, body: string): void {
		const line = `${key}: ${body}\n`;
		const words = line.split(/\s+/).filter((w) => w !== "").length;
		if (this.spent >= MAX_RECALL_WORDS) {
			this.dropped += words;
			return;
		}
		this.spent += words;
		this.pending += line;
		this.surfaced.push({ key, body });
		fired.emit(this.channels, { user: { key, body } });
	}
}

function proseIn(code: string): string {
	const forms = formsOnly(code);
	let prose = "";
	for (let i = 0; i < code.length; i++)
		if (forms[i] === " " && code[i] !== " ") prose += code[i];
	return prose.trim();
}

export interface MemoryHost {
	store: MemoryStore;
	clock: Clock;
	learn: Learner;
	watch: Watcher;
	prompt: PromptSource;
}

export interface MemoryOptions {
	bank?: MemoryBank;
}

export interface MemoryExtension extends InterpExtension {
	readonly bank: MemoryBank;
}

function heardText(memories: FiredMemory[]): string {
	return [
		"<memories>",
		"these fired on what the user just said. they are private REPL feedback, not the user's words, and the user cannot see them. a body that is a form is a recipe: run it with (memory/replay key).",
		...memories.map((m) => `${m.key}: ${m.body}`),
		"</memories>",
	].join("\n");
}

export const memorySlot = slot<MemoryBank>("memory");

function memorySession(bank: MemoryBank): (hooks: SessionHooks) => void {
	return (hooks) => {
		hooks.fill(memorySlot, bank);
		hooks.beginTurn.use(function* (ctx, next) {
			const heard = yield* bank.hear(ctx.interp);
			if (heard.length > 0) ctx.emit(heardText(heard));
			yield* next(ctx);
		});
		hooks.evalStep.use(async (ctx, next) => {
			ctx.emit((await driveAsync(bank.beginStep(ctx.code, ctx.interp))).value);
			try {
				await next(ctx);
			} finally {
				ctx.emit((await driveAsync(bank.endStep())).value);
			}
		});
		hooks.stepOutput.use((ctx, out, next) => {
			bank.observe(ctx.interp, out.model);
			return next(ctx, out);
		});
		hooks.answered.use((ctx, out, next) =>
			bank.takeUnanswered() ? false : next(ctx, out),
		);
		hooks.annotate.use((buffer, into, next) => {
			const memories = buffer.collect(fired);
			const notes = buffer.collect(learned);
			const judgments = buffer.collect(assessed);
			const entry = {
				...(memories.length === 0 ? {} : { memories }),
				...(notes.length === 0 ? {} : { learned: notes }),
			};
			const told =
				Object.keys(entry).length === 0
					? into
					: annotating(into, "step", entry);
			return next(
				buffer,
				judgments.length === 0
					? told
					: annotating(told, "output", { judged: judgments }),
			);
		});
	};
}

export function memoryExtension(
	host: MemoryHost = memoryHost,
	options: MemoryOptions = {},
): MemoryExtension {
	const bank =
		options.bank ??
		new MemoryBank(host.store, host.clock, host.learn, host.watch);
	return Object.assign((interp: Interp): void => registerMemory(interp, bank), {
		bank,
		prompt: host.prompt(),
		session: memorySession(bank),
	});
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
		yield* bank.onCall(i, form);
		try {
			const value = yield* next(i, form);
			yield* bank.onResult(i, value);
			return value;
		} catch (ex) {
			yield* bank.onError(i, ex);
			throw ex;
		}
	});

	interp.defGen(
		"memory/remember",
		-1,
		'(remember key body [:on (kind "pattern")] [:links (key...)])',
		"Store a memory under `key`. Its body is either prose, which loads into your context when the memory fires, or a form, a recipe you run later with `(replay key)`. With `:on` the memory fires by itself whenever that event happens. Returns the key.",
		z.tuple([zList]),
		function* ([rest]): Eval {
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
			yield* bank.vetted(key, body);
			const existing = yield* settled(bank.store.get(key));
			yield* bank.remember({
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

	interp.defGen(
		"memory/recall",
		-1,
		"(recall query [:limit n])",
		"Retrieve the memories whose key or body matches `query`, strongest first, and load them into your context. Retrieval strengthens what it finds, and opens it for `(revise key body)` until the step ends.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const { values, options } = splitKeywordArgs(rest, ["limit"]);
			const query = listToArray(values)[0];
			if (typeof query !== "string")
				throw new EvalException("recall needs a query string", query);
			const opts = plistOptions(options, ["limit"]);
			const raw = opts.get("limit");
			const limit = raw === undefined ? DEFAULT_RECALL_LIMIT : Number(raw);
			const found = yield* bank.recall(interp, query, limit);
			return arrayToList(found.map((memory) => memoryToAlist(bank, memory)));
		},
		RECALL_ARGS,
	);

	interp.defGen(
		"memories",
		0,
		"(memories)",
		"List every memory as (key score trigger), strongest first. Reading the list strengthens nothing.",
		z.tuple([]),
		function* (): Eval {
			const all = yield* settled(bank.store.all());
			return arrayToList(
				all
					.sort((a, b) => bank.strength(b) - bank.strength(a))
					.map((memory) =>
						arrayToList([
							memory.key,
							bank.strength(memory),
							memory.on === undefined ? null : triggerToForm(memory.on),
						]),
					),
			);
		},
	);

	interp.defGen(
		"memory/forget",
		1,
		"(forget key)",
		"Drop a memory for good; returns t if there was one. Memories also fade on their own: unused, one loses half its strength in a week, and below a floor it is swept away.",
		z.tuple([zString]),
		function* ([key]): Eval {
			return (yield* settled(bank.store.delete(key))) || null;
		},
	);

	interp.defGen(
		"memory/revise",
		2,
		"(revise key body)",
		"Replace the body of a memory that fired this step. Retrieval opens a memory for revision and the step closes it again, so revising one you have not recalled is an error: recall it first, then correct what it says.",
		z.tuple([zString, z.unknown()]),
		function* ([key, body]): Eval {
			const memory = yield* settled(bank.store.get(key));
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
			yield* bank.remember(memory);
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
			const memory = yield* settled(bank.store.get(key));
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
