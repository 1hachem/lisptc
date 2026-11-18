import { quotient } from "@repo/interpreter/arith";
import { LispHashTable } from "@repo/interpreter/collections";
import type { Conversation } from "@repo/interpreter/conversation";
import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import type { Journal } from "@repo/interpreter/journal";
import {
	booted,
	detachedState,
	type Interp,
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
	Unspecified,
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
	memorySource,
	notedMemoryKey,
	notedMemorySource,
	recognizedKind,
} from "@repo/journal-catalog/memory";
import type { Clock } from "@repo/shared/host";
import { systemClock } from "@repo/shared/host";
import { formsOnly } from "@repo/shared/lisp-forms";
import {
	type Area,
	type AreaGate,
	type Cue,
	PartialRecognition,
	type Recognize,
	type Situation,
	type Turn,
} from "@repo/shared/recognition";
import type { SearchEngine } from "@repo/shared/search";
import { z } from "zod";
import { memorySearchEngine } from "./memory-search.ts";
import {
	areaFrom,
	areaOf,
	builtinFrom,
	combinatorIn,
	formToMemory,
	hookedTrigger,
	INITIAL_SCORE,
	INTERNAL,
	LINKED_FIRES_AT,
	type Memory,
	type MemoryHost,
	type MemoryStore,
	memoryToForm,
	memoryToRecord,
	memoryToSource,
	recognizeNothing,
	recordToMemory,
	refuseEmpty,
	rememberedFrom,
	type StoredMemory,
	TRIGGER_KINDS,
	type Trigger,
	type TriggerKind,
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
export const MAX_BUILTIN_STEP_WORDS = 3000;

const DAY_MS = 24 * 60 * 60 * 1000;

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
		if (fields.has("source")) return [];
		return typeof role === "string" && typeof content === "string"
			? [{ role, content }]
			: [];
	});
}

function notedKeys(interp: Interp): Set<string> {
	const said = interp.getGlobal(newSym("conversation"));
	const keys = new Set<string>();
	if (!(said instanceof Cell)) return keys;
	for (const turn of listToArray(said))
		for (let at: unknown = turn; at instanceof Cell; at = at.cdr) {
			const field = at.car;
			if (
				!(field instanceof Cell) ||
				field.car !== "source" ||
				typeof field.cdr !== "string"
			)
				continue;
			const key = notedMemoryKey(field.cdr);
			if (key !== undefined) keys.add(key);
		}
	return keys;
}

const GIST_CHARS = 240;

function gistOf(memory: Memory): string {
	const gist = bodyText(memory.body).replace(/\s+/g, " ").trim();
	return gist.length > GIST_CHARS ? `${gist.slice(0, GIST_CHARS)}…` : gist;
}

const LIST = "memory/list";
const SETTLE = "memory/_settle";
const DECLARE_MEMORY = "memory/_declare";
const DECLARE_AREA = "memory/_declare-area";
const ENTRY = "memory/_entry";
const OF_KIND = "memory/_of-kind";
const CALLING = "memory/_calling";
const EVERY = "memory/_every";
const REMEMBERED_KEYS = "memory/_remembered-keys";
const GATES = "memory/_gates";
const UNKEYED = "";

const TABLE = "*memory/table*";
const KINDS = "*memory/kinds*";
const HEADS = "*memory/heads*";
const AREA_TABLE = "*memory/areas*";

const TABLES: readonly (readonly [string, string])[] = [
	[
		TABLE,
		"Every memory, built-in or read from the store, by key, as (form kind heads).",
	],
	[
		KINDS,
		"The keys of the memories each trigger kind fires, in the order they were filed.",
	],
	[
		HEADS,
		"The keys of the call memories each form name fires; those whose pattern names no form are under the empty string.",
	],
	[
		AREA_TABLE,
		"The situation that opens each area to recognition, in the order the areas were declared.",
	],
];

const MEMORY_OWNER = "memory";

const READERS = [ENTRY, OF_KIND, CALLING, EVERY, REMEMBERED_KEYS, GATES];

const PRELUDE = `
(defun ${ENTRY} (key)
  "The form of the memory filed under key, or nil."
  (car (gethash key *memory/table*)))

(defun ${OF_KIND} (kind)
  "The forms of the memories a trigger of kind fires."
  (mapcar ${ENTRY} (gethash kind *memory/kinds*)))

(defun ${CALLING} (heads)
  "The forms of the call memories filed under any of the form names in heads, or under none."
  (mapcar ${ENTRY}
          (remove-duplicates
            (apply append (mapcar (lambda (head) (gethash head *memory/heads*))
                                  (cons "${UNKEYED}" heads))))))

(defun ${EVERY} ()
  "The forms of every memory, built-in or remembered."
  (mapcar car (hash-table-values *memory/table*)))

(defun ${REMEMBERED_KEYS} ()
  "The keys of the remembered memories filed from the store."
  (remove-if (lambda (key) (string-prefix? "${INTERNAL}" key))
             (hash-table-keys *memory/table*)))

(defun ${GATES} ()
  "Every declared area as (name situation), in the order they were declared."
  (mapcar (lambda (pair) (list (car pair) (cdr pair)))
          (hash-table-alist *memory/areas*)))

(setq memory
  (macro (key &rest declared)
    (list '${DECLARE_MEMORY} (list 'quote (cons key declared)))))
(setq area
  (macro (name &rest declared)
    (list '${DECLARE_AREA} (list 'quote (cons name declared)))))
(${SETTLE})
`;

function isDeclaration(form: unknown): boolean {
	return (
		form instanceof Cell &&
		form.car instanceof Sym &&
		(form.car.name === "memory" || form.car.name === "area")
	);
}

function quoted(x: unknown): unknown {
	return arrayToList([newSym("quote"), x]);
}

const LITERAL_NAME = /^[A-Za-z0-9_\-/:<>=!&%~@]+$/;

function headsOf(pattern: unknown): string[] | undefined {
	const combinator = combinatorIn(pattern);
	if (combinator === "not") return undefined;
	if (combinator !== undefined) {
		const parts = listToArray((pattern as Cell).cdr as List).map(headsOf);
		if (combinator === "all") return parts.find((part) => part !== undefined);
		const keyed = parts.filter((part) => part !== undefined);
		return keyed.length === parts.length ? keyed.flat() : undefined;
	}
	if (!(pattern instanceof Cell) || !(pattern.car instanceof Sym))
		return undefined;
	const name = pattern.car.name;
	return name !== ANYTHING && LITERAL_NAME.test(name) ? [name] : undefined;
}

function fileUnder(table: LispHashTable, name: unknown, key: string): void {
	const filed = listToArray((table.get(name)?.[1] ?? null) as List);
	table.set(name, arrayToList([...filed, key]));
}

function dropFrom(table: LispHashTable, name: unknown, key: string): void {
	const filed = listToArray((table.get(name)?.[1] ?? null) as List);
	table.set(name, arrayToList(filed.filter((filedKey) => filedKey !== key)));
}

function headsIn(form: unknown, into: Set<string> = new Set()): Set<string> {
	if (!(form instanceof Cell)) return into;
	if (form.car instanceof Sym) into.add(form.car.name);
	for (let rest: unknown = form; rest instanceof Cell; rest = rest.cdr)
		headsIn(rest.car, into);
	return into;
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

const flagCodec: StateCodec<boolean> = {
	toLisp: (flag) => flag || null,
	fromLisp: (x) => x === true,
};

function surfacedLine(memory: Memory): string {
	return `${memory.key}: ${bodyText(memory.body)}\n`;
}

interface Step {
	readonly fired: readonly string[];
	readonly open: readonly string[];
	readonly surfaced: readonly FiredMemory[];
	readonly noted: number;
	readonly spent: number;
	readonly builtinSpent: number;
	readonly dropped: number;
	readonly stepping: boolean;
}

const QUIET: Step = {
	fired: [],
	open: [],
	surfaced: [],
	noted: 0,
	spent: 0,
	builtinSpent: 0,
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
			BigInt(step.noted),
			BigInt(step.spent),
			BigInt(step.dropped),
			step.stepping || null,
			BigInt(step.builtinSpent),
		]),
	fromLisp: (list) => {
		const [
			fired,
			open,
			surfaced,
			noted,
			spent,
			dropped,
			stepping,
			builtinSpent,
		] = listToArray(list as List);
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
			noted: typeof noted === "bigint" ? Number(noted) : 0,
			spent: Number(spent),
			builtinSpent: Number(builtinSpent ?? 0),
			dropped: Number(dropped),
			stepping: stepping === true,
		};
	},
};

interface Noted {
	readonly memories: readonly FiredMemory[];
	readonly withheld: string;
}

interface Cascade {
	readonly depth: number;
	readonly record: boolean;
}

const TOP: Cascade = { depth: 0, record: true };

export class MemoryBank {
	private journal?: Journal;
	private step: State<Step> = detachedState(QUIET);
	private heardState: State<number> | undefined;
	private interp: Interp | undefined;
	private storeRead: State<boolean> = detachedState(false);

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
		this.storeRead = interp.state(
			"memory/store-read",
			flagCodec,
			false,
			"Whether the remembered memories have been read from the store into the memory tables. Every write, update or forget made in this session clears it and drops them from the tables, so the next read goes back to the store. Built-ins stay filed.",
		);
	}

	declareIn(interp: Interp): void {
		this.interp = interp;
	}

	private installed(): Interp {
		if (this.interp === undefined)
			throw new EvalException(
				"the memory bank reads its memories only once it is installed in an interpreter",
				null,
			);
		return this.interp;
	}

	private *ask(name: string, ...args: unknown[]): Eval<unknown> {
		return yield* this.installed().evalGen(
			arrayToList([newSym(name), ...args.map(quoted)]),
			null,
		);
	}

	private *filed(name: string, ...args: unknown[]): Eval<Memory[]> {
		const forms = listToArray((yield* this.ask(name, ...args)) as List);
		return forms.flatMap((form) => formToMemory(form) ?? []);
	}

	private table(name: string): LispHashTable {
		return this.installed().getGlobal(newSym(name)) as LispHashTable;
	}

	private file(memory: Memory): void {
		this.unfile(memory.key);
		const kind = memory.on?.kind ?? null;
		const heads =
			kind === "call" ? (headsOf(memory.on?.pattern) ?? [UNKEYED]) : [];
		this.table(TABLE).set(
			memory.key,
			arrayToList([memoryToForm(memory), kind, arrayToList(heads)]),
		);
		if (kind !== null) fileUnder(this.table(KINDS), kind, memory.key);
		for (const head of heads) fileUnder(this.table(HEADS), head, memory.key);
	}

	private unfile(key: string): void {
		const filed = this.table(TABLE).get(key)?.[1];
		if (filed === undefined) return;
		this.table(TABLE).delete(key);
		const [, kind, heads] = listToArray(filed as List);
		if (typeof kind === "string") dropFrom(this.table(KINDS), kind, key);
		for (const head of listToArray(heads as List))
			dropFrom(this.table(HEADS), head, key);
	}

	private refuseAfterBoot(declared: unknown): void {
		if (booted(this.installed()))
			throw new EvalException(
				"built-ins are declared only while the interpreter boots, from the .memories.ptc an extension ships; remember yours with memory/remember",
				declared,
				false,
			);
	}

	*declare(declared: unknown): Eval<void> {
		this.refuseAfterBoot(declared);
		const parts = listToArray(declared as List);
		const body = parts.at(-1);
		const built =
			parts.length >= 2 && body instanceof Cell
				? [...parts.slice(0, -1), yield* this.installed().evalGen(body, null)]
				: parts;
		const memory = builtinFrom(arrayToList(built));
		if ((yield* this.ask(ENTRY, memory.key)) !== null)
			throw new EvalException(
				"two built-in memories share this key",
				memory.key,
			);
		if (wordCount(bodyText(memory.body)) > MAX_BUILTIN_WORDS)
			throw new EvalException(
				`a built-in memory body holds at most ${MAX_BUILTIN_WORDS} words; split it and link the parts`,
				memory.key,
			);
		this.file(memory);
	}

	declareArea(declared: unknown): void {
		this.refuseAfterBoot(declared);
		const gate = areaFrom(declared);
		const areas = this.table(AREA_TABLE);
		if (areas.get(gate.name) !== undefined)
			throw new EvalException("two areas share this name", gate.name);
		areas.set(gate.name, gate.situation);
	}

	*gates(): Eval<AreaGate[]> {
		return listToArray((yield* this.ask(GATES)) as List).map((entry) => {
			const [name, situation] = listToArray(entry as List) as [string, string];
			return { name, situation };
		});
	}

	*builtins(): Eval<Memory[]> {
		return (yield* this.filed(EVERY)).filter((memory) =>
			this.isBuiltin(memory),
		);
	}

	isBuiltin(memory: Memory): boolean {
		return memory.key.startsWith(INTERNAL);
	}

	*lookup(key: string): Eval<Memory | undefined> {
		yield* this.load();
		const form = yield* this.ask(ENTRY, key);
		return form === null ? undefined : formToMemory(form);
	}

	*remembered(key: string): Eval<Memory | undefined> {
		const stored = yield* settled(this.store.get(key));
		return stored === undefined ? undefined : this.decode(stored);
	}

	private decode(stored: StoredMemory): Memory | undefined {
		if ("source" in stored) return this.admit(stored.source);
		const interp = this.installed();
		const memory = recordToMemory(stored, (text) => interp.read(text));
		return memory === undefined
			? undefined
			: this.admit(str(memoryToSource(memory)));
	}

	private admit(source: string): Memory | undefined {
		let memory: Memory;
		try {
			const form = this.installed().read(source);
			if (
				!(form instanceof Cell) ||
				!(form.car instanceof Sym) ||
				form.car.name !== "memory"
			)
				return undefined;
			memory = rememberedFrom(form.cdr);
		} catch {
			return undefined;
		}
		this.file(memory);
		return memory;
	}

	private *load(): Eval<void> {
		if (this.storeRead.get()) return;
		for (const found of yield* settled(this.store.all())) this.decode(found);
		this.storeRead.set(true);
	}

	*everything(): Eval<Memory[]> {
		yield* this.load();
		return yield* this.filed(EVERY);
	}

	*listed(hook?: TriggerKind): Eval<Memory[]> {
		if (hook === undefined) return yield* this.everything();
		yield* this.load();
		return yield* this.filed(OF_KIND, hook);
	}

	private *stale(): Eval<void> {
		const keys = listToArray((yield* this.ask(REMEMBERED_KEYS)) as List);
		for (const key of keys) this.unfile(key as string);
		this.storeRead.set(false);
	}

	private *candidates(event: MemoryEvent): Eval<Memory[]> {
		yield* this.load();
		if (event.recognized !== undefined) {
			const found: Memory[] = [];
			for (const [key, score] of event.recognized) {
				if (score < WHEN_FIRES_AT) continue;
				const memory = yield* this.lookup(key);
				if (memory !== undefined) found.push(memory);
			}
			return found;
		}
		if (event.form !== undefined)
			return yield* this.filed(CALLING, arrayToList([...headsIn(event.form)]));
		return yield* this.filed(OF_KIND, event.kind);
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

	attach(journal: Journal): void {
		this.journal = journal;
	}

	reset(): void {
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
		const shown = notedKeys(interp);
		const repl = yield* this.askRepl(interp, seen.step);
		const cues = repl.cues.filter((cue) => !shown.has(cue.key));
		if (cues.length === 0) return;
		let scores: ReadonlyMap<string, number> = new Map();
		let error: string | undefined;
		try {
			scores = yield* settled(this.recognize(situation, cues, repl.areas));
		} catch (ex) {
			if (ex instanceof PartialRecognition) scores = ex.scores;
			error = ex instanceof Error ? ex.message : String(ex);
		}
		if (scores.size === 0 && error === undefined) return;
		const before = this.step.get().surfaced.length;
		if (scores.size > 0)
			yield* this.dispatch(
				{ kind: "when", text: seen.message, recognized: scores },
				interp,
				{ depth: 0, record: false },
			);
		const fired = this.step.get().surfaced.slice(before);
		this.journal?.write(recognizedKind, {
			...seen,
			scores: Object.fromEntries(scores),
			...(fired.length === 0 ? {} : { fired }),
			...(error === undefined ? {} : { error }),
		});
	}

	*beginStep(code: string, interp: Interp): Eval<Noted> {
		this.change({ stepping: true });
		yield* this.sweep();
		yield* this.dispatch({ kind: "step", text: code }, interp);
		const prose = proseIn(code);
		if (prose !== "")
			yield* this.dispatch({ kind: "prose", text: prose }, interp);
		return this.drain();
	}

	*endStep(): Eval<Noted> {
		yield* this.wireTogether();
		const noted = this.drain();
		this.reset();
		return noted;
	}

	private drain(): Noted {
		const { surfaced, noted, dropped } = this.step.get();
		this.change({ noted: surfaced.length, dropped: 0 });
		return {
			memories: surfaced.slice(noted),
			withheld:
				dropped === 0
					? ""
					: `... ${dropped} more word${dropped === 1 ? "" : "s"} of recalled memory not shown (a step surfaces ${MAX_RECALL_WORDS} words); narrow the query, or read one with (recall "key")\n`,
		};
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
		yield* settled(
			this.store.put({
				record: memoryToRecord(memory),
				source: str(memoryToSource(memory)),
			}),
		);
		yield* this.stale();
	}

	*forget(key: string): Eval<boolean> {
		const dropped = yield* settled(this.store.delete(key));
		yield* this.stale();
		return dropped;
	}

	*forgetAll(): Eval<number> {
		const dropped = yield* settled(this.store.clear());
		yield* this.stale();
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
		for (const memory of found) yield* this.fire(memory, interp, TOP);
		return found;
	}

	private *fire(memory: Memory, interp: Interp, at: Cascade): Eval<void> {
		const { fired, open, builtinSpent } = this.step.get();
		if (fired.includes(memory.key)) return;
		if (at.depth >= MAX_CASCADE_DEPTH) return;
		const builtin = this.isBuiltin(memory);
		if (builtin && notedKeys(interp).has(memory.key)) return;
		if (
			builtin &&
			builtinSpent + wordCount(surfacedLine(memory)) > MAX_BUILTIN_STEP_WORDS
		)
			return;
		this.change({
			fired: [...fired, memory.key],
			open: builtin ? open : [...open, memory.key],
		});
		if (!builtin) yield* this.reinforce(memory);
		this.surface(memory, builtin, at);
		const deeper = { ...at, depth: at.depth + 1 };
		yield* this.dispatch({ kind: "recall", text: memory.key }, interp, deeper);
		for (const [key, weight] of memory.links) {
			if (weight < LINKED_FIRES_AT) continue;
			const linked = yield* this.lookup(key);
			if (linked !== undefined) yield* this.fire(linked, interp, deeper);
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
			const memory = yield* this.remembered(key);
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

	private *dispatch(
		event: MemoryEvent,
		interp: Interp,
		at: Cascade = TOP,
	): Eval<void> {
		if (!this.step.get().stepping) return;
		const shown = event.kind === "when" ? notedKeys(interp) : undefined;
		for (const memory of yield* this.candidates(event)) {
			const on = memory.on;
			if (on === undefined || on.kind !== event.kind) continue;
			if (!fires(memory.key, on, event)) continue;
			if (shown?.has(memory.key)) continue;
			yield* this.fire(memory, interp, at);
		}
	}

	private surface(memory: Memory, builtin: boolean, at: Cascade): void {
		const key = memory.key;
		const body = bodyText(memory.body);
		const line = surfacedLine(memory);
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
			builtinSpent: step.builtinSpent + (builtin ? wordCount(line) : 0),
			surfaced: [...step.surfaced, surfaced],
		});
		if (at.record) this.journal?.write(memoryKind, surfaced);
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

export const memorySlot = slot<MemoryBank>("memory");

function noteFired(
	conversation: Conversation,
	memories: readonly FiredMemory[],
	line: (memory: FiredMemory) => string,
): void {
	for (const memory of memories)
		conversation.append(notedMemorySource(memory.key), line(memory));
}

const keyed = (memory: FiredMemory): string =>
	`${memory.key}: ${memory.body}\n`;

function memorySession(bank: MemoryBank): (hooks: SessionHooks) => void {
	return (hooks) => {
		hooks.fill(memorySlot, bank);
		hooks.beginStep.use(function* (ctx, next) {
			const { conversation } = ctx.interp;
			noteFired(
				conversation,
				yield* bank.start(ctx.interp),
				(memory) => `${memory.body}\n`,
			);
			noteFired(conversation, yield* bank.hear(ctx.interp), keyed);
			yield* next(ctx);
		});
		hooks.evalStep.use(async (ctx, next) => {
			const before = (await driveAsync(bank.beginStep(ctx.code, ctx.interp)))
				.value;
			try {
				await next(ctx);
			} finally {
				const after = (await driveAsync(bank.endStep())).value;
				const { conversation } = ctx.interp;
				noteFired(conversation, [...before.memories, ...after.memories], keyed);
				conversation.append(memorySource, before.withheld + after.withheld);
			}
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
		prelude: PRELUDE,
		postlude: host.memories(),
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

function documentDeclarations(interp: Interp): void {
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
}

export function registerMemory(interp: Interp, bank: MemoryBank): void {
	bank.keepStateIn(interp);
	bank.attach(interp.journal);
	interp.defineGlobal(
		newSym("*memory-half-life-days*"),
		BigInt(HALF_LIFE_MS / DAY_MS),
		{
			signature: "*memory-half-life-days*",
			doc: "How many days an unused memory takes to lose half its strength.",
		},
	);
	interp.defineGlobal(
		newSym("*memory-hooks*"),
		arrayToList(TRIGGER_KINDS.filter((kind) => kind !== "when")),
		{
			signature: "*memory-hooks*",
			doc: "The kinds of event an :on trigger can name.",
		},
	);
	for (const [name, doc] of TABLES) {
		interp.defineGlobal(newSym(name), new LispHashTable(), {
			signature: name,
			doc,
		});
		interp.seal(newSym(name), MEMORY_OWNER);
	}
	interp.def(
		SETTLE,
		0,
		`(${SETTLE})`,
		"Give memory and area the documentation the memory extension declares them with, over the core's placeholders, and seal them and the forms that read the memory tables, so only this extension defines them.",
		z.tuple([]),
		() => {
			documentDeclarations(interp);
			for (const name of ["memory", "area", ...READERS])
				interp.seal(newSym(name), MEMORY_OWNER);
			return Unspecified;
		},
	);
	interp.defGen(
		DECLARE_MEMORY,
		1,
		`(${DECLARE_MEMORY} declaration)`,
		"File a built-in memory, as the memory form declares it: check it, build its body, and put it in the memory tables. Returns nothing, so declaring one reports nothing.",
		z.tuple([z.unknown()]),
		function* ([declared]): Eval {
			yield* bank.declare(declared);
			return Unspecified;
		},
	);
	interp.def(
		DECLARE_AREA,
		1,
		`(${DECLARE_AREA} declaration)`,
		"File an area, as the area form declares it, with the situation that opens it to recognition. Returns nothing.",
		z.tuple([z.unknown()]),
		([declared]) => {
			bank.declareArea(declared);
			return Unspecified;
		},
	);
	bank.declareIn(interp);

	interp.hooks.evalForm.use(function* (i, form, next): Eval {
		if (isDeclaration(form)) return yield* next(i, form);
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
		'(remember key body :when "situation" [:unless "situation"] | :on (kind "pattern") [:links (key...)])',
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
			if (typeof key !== "string" || key.trim() === "")
				throw new EvalException("memory key must be a string", key);
			const body = args.length > 1 ? args[1] : null;
			refuseEmpty(body, key);
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
			const existing = yield* bank.remembered(key);
			yield* bank.remember({
				key,
				body,
				on: hookedTrigger(
					opts.get("on"),
					opts.get("when"),
					opts.get("unless"),
					key,
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

	interp.defGen(
		"memory/builtins",
		-1,
		"(builtins [area])",
		'List the built-in memories each extension ships, as (key situation): the :when situation that fires it, or its :on trigger. With an area, such as "mcp", only the keys under it. Recall one by key to read its body.',
		z.tuple([zList]),
		function* ([rest]): Eval {
			const [area] = listToArray(rest);
			if (area !== undefined && typeof area !== "string")
				throw new EvalException(
					'an area is a string, the part of a key before its slash: "mcp"',
					area,
				);
			const prefix = area?.replace(/\/$/, "");
			return arrayToList(
				(yield* bank.builtins())
					.filter(
						(memory) => prefix === undefined || areaFor(memory.key) === prefix,
					)
					.map((memory) => arrayToList([memory.key, situationOf(memory)])),
			);
		},
	);

	interp.defGen(
		AREAS,
		-1,
		"(areas [:when])",
		"List the areas the built-in memories are filed under, as (area count), in the order the extensions ship them. Pass one to memory/builtins to list its keys. With :when, the areas that declare a gate, as (area situation): recognition opens an area when its situation holds, or when the last step called one of its forms, and only then weighs its memories.",
		z.tuple([zList]),
		function* ([rest]): Eval {
			const [hook] = listToArray(rest);
			if (hook !== undefined) {
				if (hookOf(hook) !== "when")
					throw new EvalException("areas are gated by :when only", hook);
				return arrayToList(
					(yield* bank.gates()).map((gate) =>
						arrayToList([gate.name, gate.situation]),
					),
				);
			}
			const counts = new Map<string, number>();
			for (const { key } of yield* bank.builtins())
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
			return quotient(yield* bank.forgetAll(), 1);
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
			const memory = yield* bank.remembered(key);
			if (memory === undefined)
				throw new EvalException("unknown memory", key, false);
			if (!bank.isOpen(key))
				throw new EvalException(
					"this memory is not open for revision; recall it first",
					key,
					false,
				);
			refuseEmpty(body, key);
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
