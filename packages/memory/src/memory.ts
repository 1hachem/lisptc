import { quotient } from "@repo/interpreter/arith";
import type { Channels } from "@repo/interpreter/channels";
import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import {
	detachedState,
	type Interp,
	runUnhooked,
	type State,
	type StateCodec,
} from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	type List,
	listToArray,
	newLispKeyword,
	newSym,
	Sym,
} from "@repo/interpreter/objects";
import { plistOptions, splitKeywordArgs } from "@repo/interpreter/plist";
import { str } from "@repo/interpreter/print";
import { zList } from "@repo/interpreter/schema";
import {
	type InterpExtension,
	type SessionHooks,
	slot,
} from "@repo/interpreter/session";
import {
	type FiredMemory,
	memoryKind,
	recognizedKind,
} from "@repo/journal-catalog/memory";
import type { Clock } from "@repo/shared/host";
import { systemClock } from "@repo/shared/host";
import { formsOnly } from "@repo/shared/lisp-forms";
import type { ChatMessage } from "@repo/shared/messages";
import type { SearchEngine } from "@repo/shared/search";
import { z } from "zod";
import { memorySearchEngine } from "./memory-search.ts";
import {
	type Area,
	type AreaGate,
	areaFrom,
	areaOf,
	authoredTrigger,
	builtinFrom,
	type Cue,
	combinatorIn,
	formToMemory,
	INITIAL_SCORE,
	INTERNAL,
	LINKED_FIRES_AT,
	type Memory,
	type MemoryHost,
	type MemoryStore,
	memoryToForm,
	type Recognize,
	recognizeNothing,
	type Situation,
	TRIGGER_KINDS,
	type Trigger,
	type TriggerKind,
	type Turn,
	triggerToForm,
	VolatileStore,
	WHEN_FIRES_AT,
} from "./ports.ts";

export const REINFORCEMENT = 0.5;
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const FORGET_BELOW = 0.05;
export const MAX_CASCADE_DEPTH = 3;
export const MAX_RECALL_WORDS = 200;
export const DEFAULT_RECALL_LIMIT = 5;
export const MAX_BUILTIN_WORDS = 300;
export const RECALLED_RESTS_STEPS = 100;

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

function wordCount(text: string): number {
	return text.split(/\s+/).filter((w) => w !== "").length;
}

function unreadable(body: unknown): boolean {
	const printed = str(body);
	return printed.includes("#<") || printed.includes("#:");
}

export const ANYTHING = "_";

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

function conversationOf(interp: Interp): Turn[] {
	const said = interp.getGlobal(newSym("conversation"));
	if (!(said instanceof Cell)) return [];
	return listToArray(said).flatMap((turn) => {
		const fields = new Map<string, unknown>();
		for (let at: unknown = turn; at instanceof Cell; at = at.cdr)
			if (at.car instanceof Cell && typeof at.car.car === "string")
				fields.set(at.car.car, at.car.cdr);
		const role = fields.get("role");
		const content = fields.get("content");
		return typeof role === "string" && typeof content === "string"
			? [{ role, content }]
			: [];
	});
}

const GIST_CHARS = 240;

function gistOf(memory: Memory): string {
	const gist = bodyText(memory.body).replace(/\s+/g, " ").trim();
	return gist.length > GIST_CHARS ? `${gist.slice(0, GIST_CHARS)}…` : gist;
}

const LIST = "memory/list";
const DECLARED_MEMORIES = "*memories*";
const DECLARED_AREAS = "*areas*";

const DECLARE = `
(setq memory
  (macro (key &rest declared)
    (list 'setq '${DECLARED_MEMORIES}
          (list 'cons (list 'quote (cons key declared)) '${DECLARED_MEMORIES}))))
(setq area
  (macro (name &rest declared)
    (list 'setq '${DECLARED_AREAS}
          (list 'cons (list 'quote (cons name declared)) '${DECLARED_AREAS}))))
`;

function declaredIn(interp: Interp, name: string): unknown[] {
	const declared = interp.getGlobal(newSym(name));
	return declared instanceof Cell ? listToArray(declared).reverse() : [];
}
const AREAS = "memory/areas";

function entryOf(memory: Memory): unknown {
	return arrayToList([
		new Cell("key", memory.key),
		new Cell("hook", memory.on?.kind ?? null),
		new Cell("pattern", memory.on?.pattern ?? null),
		new Cell("unless", memory.on?.unless ?? null),
		new Cell("gist", gistOf(memory)),
	]);
}

function cueFromEntry(entry: unknown): Cue {
	const field = (name: string): unknown =>
		(
			listToArray(entry as List).find(
				(pair) => pair instanceof Cell && pair.car === name,
			) as Cell | undefined
		)?.cdr;
	const unless = field("unless");
	const key = field("key") as string;
	const area = areaOf(key);
	return {
		key,
		...(area === undefined ? {} : { area }),
		situation: field("pattern") as string,
		...(typeof unless === "string" ? { unless } : {}),
		gist: field("gist") as string,
	};
}

function hookOf(value: unknown): TriggerKind | undefined {
	if (value === undefined) return undefined;
	const name =
		value instanceof LispKeyword
			? value.name
			: typeof value === "string"
				? value.replace(/^:/, "")
				: undefined;
	if (name === undefined || !TRIGGER_KINDS.includes(name as TriggerKind))
		throw new EvalException(
			`a hook is one of :${TRIGGER_KINDS.join(" :")}`,
			value,
		);
	return name as TriggerKind;
}

function stepsTaken(interp: Interp): number {
	const taken = interp.getGlobal(newSym("steps-taken"));
	return typeof taken === "bigint" || typeof taken === "number"
		? Number(taken)
		: 0;
}

function latestStep(turns: readonly Turn[]): string | undefined {
	let at = turns.length - 1;
	while (at >= 0 && turns[at]?.role !== "assistant") at--;
	if (at === -1) return undefined;
	return turns
		.slice(at)
		.map((turn) => turn.content)
		.join("\n\n");
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
	recognized?: ReadonlyMap<string, number>;
}

function fires(key: string, trigger: Trigger, event: MemoryEvent): boolean {
	if (event.recognized !== undefined)
		return (event.recognized.get(key) ?? 0) >= WHEN_FIRES_AT;
	if (trigger.pattern === undefined) return true;
	if (event.form !== undefined)
		return evalPattern(trigger.pattern, (p) =>
			someSubform(event.form, (s) => structurally(p, s)),
		);
	return evalPattern(trigger.pattern, (p) =>
		typeof p === "string" ? matches(p, event.text ?? "") : false,
	);
}

const countCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

const recalledCodec: StateCodec<ReadonlyMap<string, number>> = {
	toLisp: (recalled) =>
		arrayToList([...recalled].map(([key, at]) => new Cell(key, BigInt(at)))),
	fromLisp: (list) =>
		new Map(
			listToArray(list as List).map((pair) => [
				(pair as Cell).car as string,
				Number((pair as Cell).cdr),
			]),
		),
};

const keysCodec: StateCodec<readonly string[]> = {
	toLisp: (keys) => arrayToList([...keys]),
	fromLisp: (list) => listToArray(list as List) as string[],
};

const runtimeCodec: StateCodec<readonly Memory[] | undefined> = {
	toLisp: (memories) =>
		memories === undefined
			? null
			: new Cell("read", arrayToList(memories.map(memoryToForm))),
	fromLisp: (read) =>
		read instanceof Cell
			? listToArray(read.cdr as List).flatMap(
					(form) => formToMemory(form) ?? [],
				)
			: undefined,
};

function carriesLine(message: ChatMessage, key: string): boolean {
	return message.content
		.split("\n")
		.some((line) => line.startsWith(`${key}: `));
}

interface Step {
	readonly fired: readonly string[];
	readonly open: readonly string[];
	readonly surfaced: readonly FiredMemory[];
	readonly pending: string;
	readonly spent: number;
	readonly dropped: number;
	readonly stepping: boolean;
}

const QUIET: Step = {
	fired: [],
	open: [],
	surfaced: [],
	pending: "",
	spent: 0,
	dropped: 0,
	stepping: false,
};

const stepCodec: StateCodec<Step> = {
	toLisp: (step) =>
		arrayToList([
			arrayToList([...step.fired]),
			arrayToList([...step.open]),
			arrayToList(
				step.surfaced.map(({ key, body, on }) =>
					arrayToList([key, body, on ?? null]),
				),
			),
			step.pending,
			BigInt(step.spent),
			BigInt(step.dropped),
			step.stepping || null,
		]),
	fromLisp: (list) => {
		const [fired, open, surfaced, pending, spent, dropped, stepping] =
			listToArray(list as List);
		return {
			fired: listToArray(fired as List) as string[],
			open: listToArray(open as List) as string[],
			surfaced: listToArray(surfaced as List).map((entry) => {
				const [key, body, on] = listToArray(entry as List) as [
					string,
					string,
					TriggerKind | null,
				];
				return on === null ? { key, body } : { key, body, on };
			}),
			pending: pending as string,
			spent: Number(spent),
			dropped: Number(dropped),
			stepping: stepping === true,
		};
	},
};

export class MemoryBank {
	private channels?: Channels;
	private depth = 0;
	private step: State<Step> = detachedState(QUIET);
	private heardState: State<number> | undefined;
	private loaded: State<readonly string[]> = detachedState([]);
	private recalled: State<ReadonlyMap<string, number>> = detachedState(
		new Map(),
	);
	private declaredIn: Interp | undefined;
	private firing: FiredMemory[] | undefined;
	private declarations:
		| { memories: ReadonlyMap<string, Memory>; areas: readonly AreaGate[] }
		| undefined;
	private runtime: State<readonly Memory[] | undefined> =
		detachedState(undefined);

	private get heard(): number {
		return this.heardState?.get() ?? 0;
	}

	private set heard(count: number) {
		this.heardState?.set(count);
	}

	keepStateIn(interp: Interp): void {
		this.heardState = interp.state(
			"memory/heard",
			countCodec,
			this.heard,
			"How many user messages the memory bank has already listened to.",
		);
		this.step = interp.state(
			"memory/step",
			stepCodec,
			QUIET,
			"What the memory bank has fired, opened and surfaced in the current step, and the recall words it has shown and held back.",
		);
		this.loaded = interp.state(
			"memory/loaded",
			keysCodec,
			[],
			"The built-in memories whose text is still in the conversation, so they do not load twice.",
		);
		this.recalled = interp.state(
			"memory/recalled",
			recalledCodec,
			new Map(),
			`The step each memory last fired at, by any trigger or recall. Recognition leaves a memory out until ${RECALLED_RESTS_STEPS} steps have passed since.`,
		);
		this.runtime = interp.state(
			"memory/runtime",
			runtimeCodec,
			undefined,
			'Nil until the store is read, then ("read" . memories) with the remembered memories as (memory ...) forms, read from the store once and answered from here after. Every write, update or forget made in this session empties it, so the next read goes back to the store. Built-ins are never copied here.',
		);
	}

	gates(): readonly AreaGate[] {
		return this.declared().areas;
	}

	declareIn(interp: Interp): void {
		this.declaredIn = interp;
		this.declarations = undefined;
	}

	builtins(): ReadonlyMap<string, Memory> {
		return this.declared().memories;
	}

	private declared(): {
		memories: ReadonlyMap<string, Memory>;
		areas: readonly AreaGate[];
	} {
		if (this.declarations !== undefined) return this.declarations;
		const interp = this.declaredIn;
		if (interp === undefined) return { memories: new Map(), areas: [] };
		interp.defineGlobal(newSym(DECLARED_MEMORIES), null);
		interp.defineGlobal(newSym(DECLARED_AREAS), null);
		for (const source of interp.builtinMemories()) runUnhooked(interp, source);
		const memories = new Map<string, Memory>();
		for (const declared of declaredIn(interp, DECLARED_MEMORIES)) {
			const memory = builtinFrom(declared);
			if (memories.has(memory.key))
				throw new EvalException(
					"two built-in memories share this key",
					memory.key,
				);
			if (wordCount(bodyText(memory.body)) > MAX_BUILTIN_WORDS)
				throw new EvalException(
					`a built-in memory body holds at most ${MAX_BUILTIN_WORDS} words; split it and link the parts`,
					memory.key,
				);
			memories.set(memory.key, memory);
		}
		const areas = new Map<string, AreaGate>();
		for (const declared of declaredIn(interp, DECLARED_AREAS)) {
			const gate = areaFrom(declared);
			if (areas.has(gate.name))
				throw new EvalException("two areas share this name", gate.name);
			areas.set(gate.name, gate);
		}
		this.declarations = { memories, areas: [...areas.values()] };
		return this.declarations;
	}

	isBuiltin(memory: Memory): boolean {
		return this.builtins().has(memory.key);
	}

	keepLoaded(messages: readonly ChatMessage[]): void {
		const loaded = this.loaded.get();
		if (loaded.length === 0) return;
		this.loaded.set(
			loaded.filter((key) => messages.some((m) => carriesLine(m, key))),
		);
	}

	*lookup(key: string): Eval<Memory | undefined> {
		return this.builtins().get(key) ?? (yield* settled(this.store.get(key)));
	}

	*everything(): Eval<Memory[]> {
		const known = this.runtime.get();
		if (known === undefined) return yield* this.reload();
		return [...this.builtins().values(), ...known];
	}

	private *reload(): Eval<Memory[]> {
		const stored = yield* settled(this.store.all());
		this.runtime.set(stored);
		return [...this.builtins().values(), ...stored];
	}

	*listed(hook?: TriggerKind): Eval<Memory[]> {
		return (yield* this.everything()).filter(
			(memory) => hook === undefined || memory.on?.kind === hook,
		);
	}

	private stale(): void {
		this.runtime.set(undefined);
	}

	private change(next: Partial<Step>): void {
		this.step.set({ ...this.step.get(), ...next });
	}

	constructor(
		readonly store: MemoryStore = new VolatileStore(),
		readonly clock: Clock = systemClock,
		readonly search: SearchEngine = memorySearchEngine,
		readonly recognize: Recognize = recognizeNothing,
	) {}

	private now(): number {
		return this.clock.now();
	}

	attach(channels: Channels): void {
		this.channels = channels;
	}

	reset(): void {
		this.depth = 0;
		this.step.set(QUIET);
	}

	strength(memory: Memory): number {
		if (this.isBuiltin(memory)) return memory.score;
		const elapsed = Math.max(0, this.now() - memory.lastUsed);
		return memory.score * 2 ** (-elapsed / HALF_LIFE_MS);
	}

	isOpen(key: string): boolean {
		return this.step.get().open.includes(key);
	}

	*hear(interp: Interp): Eval<FiredMemory[]> {
		const said = userMessages(interp);
		const last = said[said.length - 1];
		const fresh = said.length !== this.heard;
		if (fresh) this.heard = said.length;
		if (last === undefined || last === "") return [];
		this.change({ stepping: true });
		yield* this.sweep();
		const before = this.step.get().surfaced.length;
		if (fresh) yield* this.dispatch({ kind: "user", text: last }, interp);
		const conversation = conversationOf(interp);
		const step = fresh ? undefined : latestStep(conversation);
		yield* this.recognizeSituation(
			{ conversation },
			step === undefined ? { message: last } : { message: last, step },
			interp,
		);
		this.change({ stepping: false });
		this.drain();
		return this.step.get().surfaced.slice(before);
	}

	*start(interp: Interp): Eval<FiredMemory[]> {
		if (this.heard !== 0 || userMessages(interp).length !== 1) return [];
		this.change({ stepping: true });
		yield* this.sweep();
		yield* this.dispatch({ kind: "start" }, interp);
		const { surfaced } = this.step.get();
		this.reset();
		return [...surfaced];
	}

	private *askRepl(
		interp: Interp,
		step: string | undefined,
	): Eval<{ cues: Cue[]; areas: Area[] }> {
		this.change({ stepping: false });
		try {
			const listed = yield* interp.evalGen(
				arrayToList([newSym(LIST), newLispKeyword("when")]),
				null,
			);
			const gated = yield* interp.evalGen(
				arrayToList([newSym(AREAS), newLispKeyword("when")]),
				null,
			);
			return {
				cues: listToArray(listed as List).map(cueFromEntry),
				areas: listToArray(gated as List).map((entry) => {
					const [name, situation] = listToArray(entry as List) as string[];
					return {
						name: name as string,
						situation: situation as string,
						open: step?.includes(`(${name}/`) ?? false,
					};
				}),
			};
		} finally {
			this.change({ stepping: true });
		}
	}

	private *recognizeSituation(
		situation: Situation,
		seen: { message: string; step?: string },
		interp: Interp,
	): Eval<void> {
		const spent = [
			...this.loaded.get(),
			...[...this.recalled.get().keys()].filter((key) =>
				this.resting(key, interp),
			),
		];
		const repl = yield* this.askRepl(interp, seen.step);
		const cues = repl.cues.filter((cue) => !spent.includes(cue.key));
		if (cues.length === 0) return;
		let scores: ReadonlyMap<string, number> = new Map();
		let error: string | undefined;
		try {
			scores = yield* settled(this.recognize(situation, cues, repl.areas));
		} catch (ex) {
			error = ex instanceof Error ? ex.message : String(ex);
		}
		if (scores.size === 0 && error === undefined) return;
		const fired: FiredMemory[] = [];
		this.firing = fired;
		try {
			if (scores.size > 0)
				yield* this.dispatch(
					{ kind: "when", text: seen.message, recognized: scores },
					interp,
				);
		} finally {
			this.firing = undefined;
		}
		record(this.channels, recognizedKind, {
			...seen,
			scores: Object.fromEntries(scores),
			...(fired.length === 0 ? {} : { fired }),
			...(error === undefined ? {} : { error }),
		});
	}

	*beginStep(code: string, interp: Interp): Eval<string> {
		this.change({ stepping: true });
		yield* this.sweep();
		yield* this.dispatch({ kind: "step", text: code }, interp);
		const prose = proseIn(code);
		if (prose !== "")
			yield* this.dispatch({ kind: "prose", text: prose }, interp);
		return this.drain();
	}

	private resting(key: string, interp: Interp): boolean {
		const at = this.recalled.get().get(key);
		return at !== undefined && stepsTaken(interp) - at < RECALLED_RESTS_STEPS;
	}

	*endStep(): Eval<string> {
		yield* this.wireTogether();
		const text = this.drain();
		this.reset();
		return text;
	}

	private drain(): string {
		const { pending: text, dropped } = this.step.get();
		this.change({ pending: "", dropped: 0 });
		if (dropped === 0) return text;
		const withheld = `... ${dropped} more word${dropped === 1 ? "" : "s"} of recalled memory not shown (a step surfaces ${MAX_RECALL_WORDS} words); narrow the query, or read one with (recall "key")\n`;
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
		yield* this.dispatch({ kind: "error", text: String(error) }, interp);
	}

	*remember(memory: Memory): Eval<void> {
		yield* settled(this.store.put(memory));
		this.stale();
	}

	*forget(key: string): Eval<boolean> {
		const dropped = yield* settled(this.store.delete(key));
		this.stale();
		return dropped;
	}

	*recall(interp: Interp, query: string, limit: number): Eval<Memory[]> {
		yield* this.sweep();
		const all = yield* this.everything();
		const documents = all.map((m) => ({
			id: m.key,
			name: m.key,
			description: bodyText(m.body),
		}));
		const hit = new Set(
			this.search.search(query, documents).map((found) => found.id),
		);
		const found = all
			.filter((m) => hit.has(m.key))
			.sort((a, b) => this.strength(b) - this.strength(a))
			.slice(0, limit);
		for (const memory of found) yield* this.fire(memory, interp);
		return found;
	}

	*fire(memory: Memory, interp: Interp): Eval<void> {
		const { fired, open } = this.step.get();
		if (fired.includes(memory.key)) return;
		if (this.depth >= MAX_CASCADE_DEPTH) return;
		const builtin = this.isBuiltin(memory);
		const loaded = this.loaded.get();
		if (builtin && loaded.includes(memory.key)) return;
		this.change({
			fired: [...fired, memory.key],
			open: builtin ? open : [...open, memory.key],
		});
		this.recalled.set(
			new Map([...this.recalled.get(), [memory.key, stepsTaken(interp)]]),
		);
		if (builtin) this.loaded.set([...loaded, memory.key]);
		else yield* this.reinforce(memory);
		this.surface(memory, builtin);
		this.depth++;
		try {
			yield* this.dispatch({ kind: "recall", text: memory.key }, interp);
			for (const [key, weight] of memory.links) {
				if (weight < LINKED_FIRES_AT) continue;
				const linked = yield* this.lookup(key);
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
		yield* this.remember(memory);
	}

	private *wireTogether(): Eval<void> {
		const keys = this.step.get().fired;
		if (keys.length < 2) return;
		for (const key of keys) {
			const memory = yield* settled(this.store.get(key));
			if (memory === undefined) continue;
			for (const other of keys)
				if (other !== key)
					memory.links.set(other, (memory.links.get(other) ?? 0) + 1);
			yield* this.remember(memory);
		}
	}

	private *sweep(): Eval<void> {
		for (const memory of yield* this.everything())
			if (!this.isBuiltin(memory) && this.strength(memory) < FORGET_BELOW)
				yield* this.forget(memory.key);
	}

	private *dispatch(event: MemoryEvent, interp: Interp): Eval<void> {
		if (!this.step.get().stepping) return;
		for (const memory of yield* this.everything()) {
			const on = memory.on;
			if (on === undefined || on.kind !== event.kind) continue;
			if (!fires(memory.key, on, event)) continue;
			if (event.kind === "when" && this.resting(memory.key, interp)) continue;
			yield* this.fire(memory, interp);
		}
	}

	private surface(memory: Memory, builtin: boolean): void {
		const key = memory.key;
		const body = bodyText(memory.body);
		const line = `${key}: ${body}\n`;
		const words = builtin ? 0 : wordCount(line);
		const step = this.step.get();
		if (!builtin && step.spent >= MAX_RECALL_WORDS) {
			this.change({ dropped: step.dropped + words });
			return;
		}
		const surfaced: FiredMemory =
			memory.on === undefined
				? { key, body }
				: { key, body, on: memory.on.kind };
		this.change({
			spent: step.spent + words,
			pending: step.pending + line,
			surfaced: [...step.surfaced, surfaced],
		});
		if (this.firing !== undefined) this.firing.push(surfaced);
		else record(this.channels, memoryKind, surfaced);
	}
}

function proseIn(code: string): string {
	const forms = formsOnly(code);
	let prose = "";
	for (let i = 0; i < code.length; i++)
		if (forms[i] === " " && code[i] !== " ") prose += code[i];
	return prose.trim();
}

export interface MemoryOptions {
	bank?: MemoryBank;
}

export interface MemoryExtension extends InterpExtension {
	readonly bank: MemoryBank;
	readonly asks: readonly string[];
}

const FORGET_ALL = "memory/forget-all";

function heardText(memories: FiredMemory[]): string {
	return [
		"<memories>",
		"these fired on what the user said and what just happened. they are private REPL feedback, not the user's words, and the user cannot see them. a body that is a form is a recipe: run it with (memory/replay key).",
		...memories.map((m) => `${m.key}: ${m.body}`),
		"</memories>",
	].join("\n");
}

function startText(memories: FiredMemory[]): string {
	return [
		"<memories>",
		"these load once, on the user's first message. they are private REPL feedback, not the user's words, and the user cannot see them.",
		...memories.map((m) => m.body),
		"</memories>",
	].join("\n");
}

export const memorySlot = slot<MemoryBank>("memory");

function memorySession(bank: MemoryBank): (hooks: SessionHooks) => void {
	return (hooks) => {
		hooks.fill(memorySlot, bank);
		hooks.beginStep.use(function* (ctx, next) {
			const started = yield* bank.start(ctx.interp);
			if (started.length > 0) ctx.emit(startText(started));
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
		hooks.context.use((interp, messages, next) => {
			bank.keepLoaded(messages);
			return next(interp, messages);
		});
	};
}

export function memoryExtension(
	host: MemoryHost,
	options: MemoryOptions = {},
): MemoryExtension {
	const bank =
		options.bank ??
		new MemoryBank(host.store, host.clock, host.search, host.recognize);
	return Object.assign((interp: Interp): void => registerMemory(interp, bank), {
		bank,
		asks: [FORGET_ALL],
		prompt: host.prompt(),
		memories: host
			.memories()
			.replaceAll("{{rest-steps}}", String(RECALLED_RESTS_STEPS)),
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
			"a trigger (kind pattern) firing this memory by itself on an exact event: call, result, error, step, prose, user or recall; or (start), which loads it once, on the user's first message",
	},
	{
		name: "when",
		type: "string",
		required: false,
		description:
			"the situation that needs this memory, in words, recognized before every step against what the user said and what the agent just did and got back: a request, an action, an error, a result",
	},
	{
		name: "unless",
		type: "string",
		required: false,
		description:
			"beside :when, a look-alike situation that must not fire this memory, in words",
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

function refuseInternal(key: string): void {
	if (key.startsWith(INTERNAL))
		throw new EvalException(
			`keys under ${INTERNAL} are built-in memories, which are read-only; remember yours under another key`,
			key,
			false,
		);
}

function areaFor(key: string): string {
	return areaOf(key) ?? key;
}

function situationOf(memory: Memory): unknown {
	if (memory.on === undefined) return null;
	return memory.on.kind === "when"
		? memory.on.pattern
		: triggerToForm(memory.on);
}

export function registerMemory(interp: Interp, bank: MemoryBank): void {
	bank.keepStateIn(interp);
	bank.attach(interp.channels);
	runUnhooked(interp, DECLARE);
	interp.setDoc("memory", {
		signature:
			'(memory "key" [:when "situation" [:unless "situation"] | :on (kind "pattern")] [:links ("key"...)] "body")',
		doc: `Declare a built-in memory, in a .memories.ptc file an extension ships. Its body holds at most ${MAX_BUILTIN_WORDS} words; split a longer one and link the parts.`,
		wordCaps: [{ position: 1, words: MAX_BUILTIN_WORDS }],
	});
	interp.setDoc("area", {
		signature: '(area "name" :when "situation")',
		doc: "Declare the area a .memories.ptc file's memories are filed under, and the situation that opens it to recognition.",
	});
	bank.declareIn(interp);

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
		'(remember key body [:when "situation" [:unless "situation"] | :on (kind "pattern")] [:links (key...)])',
		"Store a memory under `key`. Its body is either prose, which loads into your context when the memory fires, or a form, a recipe you run later with `(replay key)`. With `:when` it fires by itself once the situation it describes arises: the user's request, what you are doing, an error or a result you just got. `:unless` names a look-alike situation that must not fire it. With `:on` it fires on an exact event; `:on (start)` loads it once, on the user's first message, so it is the place for your role and your goal. Returns the key.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const { values, options } = splitKeywordArgs(rest, [
				"on",
				"when",
				"unless",
				"links",
			]);
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
			refuseInternal(key);
			const opts = plistOptions(options, ["on", "when", "unless", "links"]);
			const links = new Map<string, number>();
			for (const linked of listToArray((opts.get("links") ?? null) as List))
				if (typeof linked === "string") links.set(linked, LINKED_FIRES_AT);
			const existing = yield* settled(bank.store.get(key));
			yield* bank.remember({
				key,
				body,
				on: authoredTrigger(
					opts.get("on"),
					opts.get("when"),
					opts.get("unless"),
				),
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
			const all = yield* bank.everything();
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
		LIST,
		-1,
		"(list [hook])",
		"List every memory, built-in or remembered, as an alist of key, hook, pattern, unless and gist. With a hook such as :when or :call, only the memories that fire on it. Recognition asks (list :when) before every step.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const hook = hookOf(listToArray(rest)[0]);
			return arrayToList((yield* bank.listed(hook)).map(entryOf));
		},
	);

	interp.def(
		"memory/builtins",
		-1,
		"(builtins [area])",
		'List the built-in memories each extension ships, as (key situation): the :when situation that fires it, or its :on trigger. With an area, such as "mcp", only the keys under it. Recall one by key to read its body.',
		z.tuple([zList]),
		([rest]) => {
			const [area] = listToArray(rest);
			if (area !== undefined && typeof area !== "string")
				throw new EvalException(
					'an area is a string, the part of a key before its slash: "mcp"',
					area,
				);
			const prefix = area?.replace(/\/$/, "");
			return arrayToList(
				[...bank.builtins().values()]
					.filter(
						(memory) => prefix === undefined || areaFor(memory.key) === prefix,
					)
					.map((memory) => arrayToList([memory.key, situationOf(memory)])),
			);
		},
	);

	interp.def(
		AREAS,
		-1,
		"(areas [:when])",
		"List the areas the built-in memories are filed under, as (area count), in the order the extensions ship them. Pass one to memory/builtins to list its keys. With :when, the areas that declare a gate, as (area situation): recognition opens an area when its situation holds, or when the last step called one of its forms, and only then weighs its memories.",
		z.tuple([zList]),
		([rest]) => {
			const [hook] = listToArray(rest);
			if (hook !== undefined) {
				if (hookOf(hook) !== "when")
					throw new EvalException("areas are gated by :when only", hook);
				return arrayToList(
					bank.gates().map((gate) => arrayToList([gate.name, gate.situation])),
				);
			}
			const counts = new Map<string, number>();
			for (const key of bank.builtins().keys())
				counts.set(areaFor(key), (counts.get(areaFor(key)) ?? 0) + 1);
			return arrayToList(
				[...counts].map(([area, count]) => arrayToList([area, BigInt(count)])),
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
			refuseInternal(key);
			return (yield* bank.forget(key)) || null;
		},
	);

	interp.defGen(
		FORGET_ALL,
		0,
		"(forget-all)",
		"Drop every memory for good; returns how many there were. Only when the user asks for a clean slate.",
		z.tuple([]),
		function* (): Eval {
			const all = (yield* bank.everything()).filter(
				(memory) => !bank.isBuiltin(memory),
			);
			for (const memory of all) yield* bank.forget(memory.key);
			return quotient(all.length, 1);
		},
	);

	interp.defGen(
		"memory/revise",
		2,
		"(revise key body)",
		"Replace the body of a memory that fired this step. Retrieval opens a memory for revision and the step closes it again, so revising one you have not recalled is an error: recall it first, then correct what it says.",
		z.tuple([zString, z.unknown()]),
		function* ([key, body]): Eval {
			refuseInternal(key);
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
			const memory = yield* bank.lookup(key);
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
