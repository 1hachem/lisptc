import { quotient } from "@repo/interpreter/arith";
import type { Channels } from "@repo/interpreter/channels";
import { driveAsync, type Eval, settled } from "@repo/interpreter/drive";
import { EvalException } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import {
	detachedState,
	type Interp,
	type State,
	type StateCodec,
} from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	type List,
	listToArray,
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
	judgedKind,
	memoryKind,
} from "@repo/journal-catalog/memory";
import type { Clock } from "@repo/shared/host";
import { systemClock } from "@repo/shared/host";
import { formsOnly } from "@repo/shared/lisp-forms";
import type { ChatMessage } from "@repo/shared/messages";
import type { SearchEngine } from "@repo/shared/search";
import { z } from "zod";
import { memorySearchEngine } from "./memory-search.ts";
import {
	ASKS_FIRES_AT,
	combinatorIn,
	INITIAL_SCORE,
	LINKED_FIRES_AT,
	type Memory,
	type MemoryHost,
	type MemoryJudge,
	type MemoryStore,
	parseTrigger,
	readBuiltins,
	type Situation,
	type Trigger,
	type TriggerKind,
	triggerToForm,
	unjudged,
	VolatileStore,
} from "./ports.ts";

export const REINFORCEMENT = 0.5;
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
export const FORGET_BELOW = 0.05;
export const MAX_CASCADE_DEPTH = 3;
export const MAX_RECALL_WORDS = 200;
export const DEFAULT_RECALL_LIMIT = 5;
export const MAX_BUILTIN_WORDS = 300;

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

function latestStep(interp: Interp): string | undefined {
	const said = interp.getGlobal(newSym("conversation"));
	if (!(said instanceof Cell)) return undefined;
	const turns = listToArray(said).map((turn) => {
		const fields = new Map<string, unknown>();
		for (let at: unknown = turn; at instanceof Cell; at = at.cdr)
			if (at.car instanceof Cell && typeof at.car.car === "string")
				fields.set(at.car.car, at.car.cdr);
		return fields;
	});
	let at = turns.length - 1;
	while (at >= 0 && turns[at]?.get("role") !== "assistant") at--;
	if (at === -1) return undefined;
	return turns
		.slice(at)
		.map((turn) => turn.get("content"))
		.filter((content): content is string => typeof content === "string")
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
	judged?: ReadonlyMap<string, number>;
}

function fires(trigger: Trigger, event: MemoryEvent): boolean {
	if (event.judged !== undefined)
		return (event.judged.get(trigger.pattern as string) ?? 0) >= ASKS_FIRES_AT;
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

const keysCodec: StateCodec<readonly string[]> = {
	toLisp: (keys) => arrayToList([...keys]),
	fromLisp: (list) => listToArray(list as List) as string[],
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
	private asked: State<readonly string[]> = detachedState([]);
	private builtinSource: () => readonly string[] = () => [];
	private builtinTable: ReadonlyMap<string, Memory> | undefined;

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
		this.asked = interp.state(
			"memory/asked",
			keysCodec,
			[],
			"The memories an asks trigger fired since the user last spoke, so a later step does not fire them again.",
		);
	}

	readBuiltinsFrom(source: () => readonly string[]): void {
		this.builtinSource = source;
		this.builtinTable = undefined;
	}

	builtins(): ReadonlyMap<string, Memory> {
		if (this.builtinTable !== undefined) return this.builtinTable;
		const table = new Map<string, Memory>();
		for (const source of this.builtinSource())
			for (const memory of readBuiltins(source)) {
				if (table.has(memory.key))
					throw new EvalException(
						"two built-in memories share this key",
						memory.key,
					);
				if (wordCount(bodyText(memory.body)) > MAX_BUILTIN_WORDS)
					throw new EvalException(
						`a built-in memory body holds at most ${MAX_BUILTIN_WORDS} words; split it and link the parts`,
						memory.key,
					);
				table.set(memory.key, memory);
			}
		this.builtinTable = table;
		return table;
	}

	isBuiltin(memory: Memory): boolean {
		return this.builtins().get(memory.key) === memory;
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
		const stored = yield* settled(this.store.all());
		return [...this.builtins().values(), ...stored];
	}

	private change(next: Partial<Step>): void {
		this.step.set({ ...this.step.get(), ...next });
	}

	constructor(
		readonly store: MemoryStore = new VolatileStore(),
		readonly clock: Clock = systemClock,
		readonly search: SearchEngine = memorySearchEngine,
		readonly judge: MemoryJudge = unjudged,
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
		if (fresh) {
			this.heard = said.length;
			this.asked.set([]);
		}
		if (last === undefined || last === "") return [];
		this.change({ stepping: true });
		yield* this.sweep();
		const before = this.step.get().surfaced.length;
		if (fresh) yield* this.dispatch({ kind: "user", text: last }, interp);
		const step = fresh ? undefined : latestStep(interp);
		const judged = yield* this.judgeAsks(
			step === undefined ? { message: last } : { message: last, step },
		);
		if (judged.size > 0)
			yield* this.dispatch({ kind: "asks", text: last, judged }, interp);
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

	private *judgeAsks(situation: Situation): Eval<ReadonlyMap<string, number>> {
		const spent = [...this.loaded.get(), ...this.asked.get()];
		const candidates = (yield* this.everything()).filter(
			(memory) => memory.on?.kind === "asks" && !spent.includes(memory.key),
		);
		const asks = new Set(candidates.map((m) => m.on?.pattern as string));
		if (asks.size === 0) return new Map();
		let scores: ReadonlyMap<string, number> = new Map();
		let error: string | undefined;
		try {
			scores = yield* settled(this.judge(situation, [...asks]));
		} catch (ex) {
			error = ex instanceof Error ? ex.message : String(ex);
		}
		const selected = candidates
			.filter(
				(memory) =>
					memory.on !== undefined &&
					fires(memory.on, { kind: "asks", judged: scores }),
			)
			.map((memory) => memory.key);
		if (scores.size > 0 || error !== undefined)
			record(this.channels, judgedKind, {
				...situation,
				scores: Object.fromEntries(scores),
				...(selected.length === 0 ? {} : { selected }),
				...(error === undefined ? {} : { error }),
			});
		return scores;
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
		yield* settled(this.store.put(memory));
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
		if (!this.step.get().stepping) return;
		for (const memory of yield* this.everything()) {
			const on = memory.on;
			if (on === undefined || on.kind !== event.kind) continue;
			if (!fires(on, event)) continue;
			if (event.kind === "asks") {
				const asked = this.asked.get();
				if (asked.includes(memory.key)) continue;
				this.asked.set([...asked, memory.key]);
			}
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
		record(this.channels, memoryKind, surfaced);
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
		new MemoryBank(host.store, host.clock, host.search, host.judge);
	return Object.assign((interp: Interp): void => registerMemory(interp, bank), {
		bank,
		asks: [FORGET_ALL],
		prompt: host.prompt(),
		memories: host.memories(),
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
			'a trigger (kind pattern) firing this memory by itself: call, result, error, step, prose, user or recall; (asks "when it applies"), judged against what the user said; or (start), which loads it once, on the user\'s first message',
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

function refuseBuiltin(bank: MemoryBank, key: string): void {
	if (bank.builtins().has(key))
		throw new EvalException(
			"this key names a built-in memory, which is read-only",
			key,
			false,
		);
}

export function registerMemory(interp: Interp, bank: MemoryBank): void {
	bank.keepStateIn(interp);
	bank.attach(interp.channels);
	bank.readBuiltinsFrom(() => interp.builtinMemories());

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
		"Store a memory under `key`. Its body is either prose, which loads into your context when the memory fires, or a form, a recipe you run later with `(replay key)`. With `:on` the memory fires by itself whenever that event happens; `:on (start)` loads it once, on the user's first message, so it is the place for your role and your goal. Returns the key.",
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
			refuseBuiltin(bank, key);
			const opts = plistOptions(options, ["on", "links"]);
			const links = new Map<string, number>();
			for (const linked of listToArray((opts.get("links") ?? null) as List))
				if (typeof linked === "string") links.set(linked, LINKED_FIRES_AT);
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
		"memory/forget",
		1,
		"(forget key)",
		"Drop a memory for good; returns t if there was one. Memories also fade on their own: unused, one loses half its strength in a week, and below a floor it is swept away.",
		z.tuple([zString]),
		function* ([key]): Eval {
			refuseBuiltin(bank, key);
			return (yield* settled(bank.store.delete(key))) || null;
		},
	);

	interp.defGen(
		FORGET_ALL,
		0,
		"(forget-all)",
		"Drop every memory for good; returns how many there were. Only when the user asks for a clean slate.",
		z.tuple([]),
		function* (): Eval {
			const all = yield* settled(bank.store.all());
			for (const memory of all) yield* settled(bank.store.delete(memory.key));
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
			refuseBuiltin(bank, key);
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
