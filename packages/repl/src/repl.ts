import {
	ConversationInterpreter,
	type ConversationRecord,
	note,
} from "@repo/interpreter/conversation";
import {
	driveAsync,
	type Eval,
	type Hold,
	settled,
} from "@repo/interpreter/drive";
import { type Effect, effect, ends } from "@repo/interpreter/effects";
import { EvalException, StepHold } from "@repo/interpreter/errors";
import type { Chain, Middleware } from "@repo/interpreter/hooks";
import { type Image, restore, snapshot } from "@repo/interpreter/image";
import {
	bufferSink,
	type Hitch,
	hitch,
	type Journal,
	type JournalBuffer,
	printed,
	type Recipient,
	released,
	type Sink,
} from "@repo/interpreter/journal";
import { type Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { EndOfFile, Unspecified } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	type AgentEnd,
	type AgentTurn,
	type Author,
	type Bounded,
	type InterpExtension,
	openSession,
	type SessionHooks,
	type StepContext,
	type TurnContext,
} from "@repo/interpreter/session";
import { type Entry, type Received, view } from "@repo/shared/journal";
import type { Skipped } from "@repo/shared/lisp-forms";
import type { Checkpoint, ImageStore } from "./image-store.ts";

export interface Repl {
	readonly interp: ConversationInterpreter;
	reset(): void;
}

export interface InMemoryRepl extends Repl {
	eval(code: string): Promise<string>;
}

export interface ReplOptions {
	extensions: InterpExtension[];
	images?: ImageStore;
}

export type LiveEntries = (entry: Entry) => void;

const CONSUMED: ReadonlySet<string> = new Set([
	printed.name,
	hitch.name,
	effect.name,
	note.name,
	released.name,
]);

function forwarded(entries: readonly Entry[]): Entry[] {
	return entries.filter((entry) => !CONSUMED.has(entry.kind));
}

function liveEntries(live: LiveEntries): Sink {
	return {
		send(entry) {
			if (!CONSUMED.has(entry.kind)) live(entry);
			return true;
		},
	};
}

export interface EvalOutput extends Bounded {
	entries: readonly Entry[];
	effects: readonly Effect[];
	notes: readonly ConversationRecord[];
	failed: boolean;
	failure?: string;
	held: boolean;
	results: readonly string[];
}

export interface StepResult extends EvalOutput {
	skipped: string[];
}

function partition(hitches: readonly Hitch[]): {
	skipped: string[];
	failed: Hitch[];
	held: Hitch[];
} {
	const skipped: string[] = [];
	const failed: Hitch[] = [];
	const held: Hitch[] = [];
	for (const n of hitches)
		switch (n.kind) {
			case "skipped":
				if (!skipped.includes(n.text)) skipped.push(n.text);
				break;
			case "failed":
				failed.push(n);
				break;
			case "held":
				held.push(n);
				break;
			default: {
				const unhandled: never = n.kind;
				throw new Error(`unhandled hitch kind ${String(unhandled)}`);
			}
		}
	return { skipped, failed, held };
}

interface FormRecorder {
	begin(): number;
	end(skipsBefore: number, value: unknown): void;
}

function recordTopLevel(buffer: JournalBuffer): {
	recorder: FormRecorder;
	results: string[];
} {
	const results: string[] = [];
	const skips = () =>
		buffer.collect(hitch).filter((n) => n.kind === "skipped").length;
	let depth = 0;
	return {
		results,
		recorder: {
			begin: () => {
				depth++;
				return skips();
			},
			end: (skipsBefore, value) => {
				depth--;
				if (depth > 0 || value === Unspecified) return;
				if (skips() === skipsBefore) results.push(str(value));
			},
		},
	};
}

interface Parked {
	readonly hold: Hold;
	readonly run: Promise<unknown>;
	readonly evaluation: number;
}

interface Part {
	readonly model: string;
	readonly user: string;
	readonly hitches: ReturnType<typeof partition>;
}

function partOf(entries: readonly Entry[]): Part {
	const said = view(entries, printed);
	const textFor = (to: Recipient) =>
		said
			.filter((p) => p.to.includes(to))
			.map((p) => p.text)
			.join("");
	return {
		model: textFor("model"),
		user: textFor("user"),
		hitches: partition(view(entries, hitch)),
	};
}

function heldText(part: Part): string {
	return part.hitches.held.map((n) => `held: ${n.text}\n`).join("");
}

type Settled = { readonly held: Hold } | { readonly thrown: unknown };

function stepThrowable(ex: unknown): boolean {
	return (
		ex instanceof EvalException || ex instanceof StepHold || ex === EndOfFile
	);
}

function caught(run: Promise<unknown>): Promise<unknown> {
	return run.then(
		() => undefined,
		(ex) => {
			if (!stepThrowable(ex)) throw ex;
			return ex instanceof StepHold ? undefined : ex;
		},
	);
}

function skipNotes(skipped: string[]): string {
	return skipped.map((what) => `skipped ${what}\n`).join("");
}

function render(
	result: StepResult,
	notes = skipNotes(result.skipped),
): EvalOutput {
	return {
		model: result.model + notes,
		user: result.user + notes,
		entries: result.entries,
		effects: result.effects,
		notes: result.notes,
		failed: result.failed,
		held: result.held,
		results: result.results,
		failure: result.failure,
	};
}

const END: Effect = { type: "end" };

function snapshotOf(interp: Interp): Image | undefined {
	try {
		return snapshot(interp);
	} catch {
		return undefined;
	}
}

export class MemoryRepl implements InMemoryRepl {
	private currentInterp: ConversationInterpreter;
	private inFlight: Promise<void> = Promise.resolve();
	private parked: Parked[] = [];
	private readonly decided = new Set<string>();
	private recorder: FormRecorder | undefined;
	private betweenSteps:
		| {
				journal: Journal;
				buffer: JournalBuffer;
				handled: Set<Entry>;
				detach: () => void;
		  }
		| undefined;
	private readonly extensions: InterpExtension[];
	private readonly images: ImageStore | undefined;
	private saving: Promise<void> = Promise.resolve();
	private calls = 0;
	readonly hooks: SessionHooks;

	constructor(options: ReplOptions) {
		this.extensions = options.extensions;
		this.images = options.images;
		this.hooks = openSession(this.extensions);
		this.currentInterp = this.freshInterp();
	}

	get interp(): ConversationInterpreter {
		return this.currentInterp;
	}

	private freshInterp(): ConversationInterpreter {
		const interp = new ConversationInterpreter({
			extensions: this.extensions,
		});
		const recording = () => this.recorder;
		interp.hooks.evalForm.use(function* (i, form, next) {
			const record = recording();
			if (record === undefined) return yield* next(i, form);
			const mark = record.begin();
			let value: unknown;
			try {
				value = yield* next(i, form);
			} catch (ex) {
				record.end(mark, Unspecified);
				throw ex;
			}
			record.end(mark, value);
			return value;
		});
		runSync(interp, prelude);
		this.setup(interp);
		this.watch(interp);
		return interp;
	}

	async resume(): Promise<number | undefined> {
		const latest = await this.images?.latest();
		if (latest === undefined) return undefined;
		this.load(latest);
		return latest.depth;
	}

	recover(): Promise<number | undefined> {
		return this.enqueue(async () => {
			await this.saving;
			const latest = await this.images?.latest().catch(() => undefined);
			if (latest !== undefined && this.loaded(latest)) return latest.depth;
			this.reset();
			return undefined;
		});
	}

	private loaded(checkpoint: Checkpoint): boolean {
		try {
			this.load(checkpoint);
			return true;
		} catch {
			return false;
		}
	}

	private load({ depth, image }: Checkpoint): void {
		const interp = new ConversationInterpreter({
			extensions: this.extensions,
		});
		try {
			restore(interp, image);
		} catch (ex) {
			interp.dispose();
			throw ex;
		}
		this.parked = [];
		this.decided.clear();
		this.currentInterp.dispose();
		this.currentInterp = interp;
		this.calls = depth;
		this.watch(interp);
	}

	private checkpoint(result: StepResult, origin?: string): StepResult {
		this.calls += 1;
		const { images } = this;
		if (images === undefined) return result;
		const image = snapshotOf(this.currentInterp);
		if (image === undefined) return result;
		this.saving = this.saving
			.then(() => images.save(image, origin))
			.catch(() => undefined);
		return result;
	}

	protected setup(_interp: ConversationInterpreter): void {}

	protected currentInterpOrUndefined(): ConversationInterpreter | undefined {
		return this.currentInterp as ConversationInterpreter | undefined;
	}

	async evalOutput(
		code: string,
		origin?: string,
		live?: LiveEntries,
	): Promise<EvalOutput> {
		return render(await this.evaluate(code, origin, live));
	}

	protected evaluate(
		code: string,
		origin?: string,
		live?: LiveEntries,
		author: Author = "user",
	): Promise<StepResult> {
		return this.serialize(
			code,
			author,
			(ctx) =>
				this.hooks.evalStep.run(async (c) => {
					await runAsync(c.interp, c.code);
				}, ctx),
			origin,
			live,
		);
	}

	async invokeUi(
		action: string,
		values: Record<string, unknown> = {},
	): Promise<EvalOutput> {
		return render(
			await this.serialize("", "user", (ctx) =>
				this.hooks.invoke.run(
					() => {
						throw new EvalException(
							"no ui surface on this repl",
							action,
							false,
						);
					},
					{ interp: ctx.interp, action, values },
				),
			),
		);
	}

	private serialize(
		code: string,
		author: Author,
		body: (ctx: StepContext) => Promise<void>,
		origin?: string,
		live?: LiveEntries,
	): Promise<StepResult> {
		return this.enqueue(() =>
			this.runStep({ code, author }, body, live).then((result) =>
				this.checkpoint(result, origin),
			),
		);
	}

	private enqueue<T>(run: () => Promise<T>): Promise<T> {
		const done = this.inFlight.then(run, run);
		this.inFlight = done.then(
			() => undefined,
			() => undefined,
		);
		return done;
	}

	private listenBetweenSteps(journal: Journal): void {
		this.betweenSteps?.detach();
		const buffer = bufferSink();
		this.betweenSteps = {
			journal,
			buffer,
			handled: new Set(),
			detach: journal.pipe(buffer),
		};
	}

	protected handledBetweenSteps(entries: readonly Entry[]): void {
		for (const entry of entries) this.betweenSteps?.handled.add(entry);
	}

	protected notedBetweenSteps(): ConversationRecord[] {
		const between = this.betweenSteps;
		if (between === undefined) return [];
		const fresh = between.buffer.entries.filter(
			(e) => e.kind === note.name && !between.handled.has(e),
		);
		this.handledBetweenSteps(fresh);
		return fresh.map((e) => e.value as ConversationRecord);
	}

	private takeBetweenSteps(journal: Journal): readonly Entry[] {
		const between = this.betweenSteps;
		this.betweenSteps = undefined;
		if (between === undefined) return [];
		between.detach();
		return between.journal === journal
			? between.buffer.entries.filter((e) => !between.handled.has(e))
			: [];
	}

	private async runStep(
		step: Omit<StepContext, "interp">,
		body: (ctx: StepContext) => Promise<void>,
		live?: LiveEntries,
	): Promise<StepResult> {
		const interp = this.currentInterp;
		const ctx: StepContext = { interp, ...step };
		const { journal } = interp;
		journal.evaluation = this.calls + 1;
		const buffer = bufferSink();
		const watching = live === undefined ? undefined : liveEntries(live);
		for (const entry of this.takeBetweenSteps(journal)) {
			buffer.send(entry);
			watching?.send(entry);
		}
		const detach = journal.pipe(buffer);
		const unwatch = watching === undefined ? () => {} : journal.pipe(watching);
		const { recorder, results } = recordTopLevel(buffer);
		this.recorder = recorder;
		let thrown: unknown;
		let resumedThrown: unknown;
		let resumedFrom: number | undefined;
		try {
			const ran = await this.raceHold(() => caught(body(ctx)));
			if ("thrown" in ran) {
				thrown = ran.thrown;
				if (this.parked.some((p) => this.decided.has(p.hold.id))) {
					resumedFrom = buffer.entries.length;
					const resumed = await this.raceHold(() => this.resumeDecided());
					if ("thrown" in resumed) resumedThrown = resumed.thrown;
					const later = partOf(buffer.entries.slice(resumedFrom));
					const laterError = this.errorOf(
						ctx,
						resumedThrown,
						later.hitches.failed,
					);
					interp.conversation.append(
						"held-step",
						resumedNote(later.model + laterError.model + heldText(later)),
					);
				}
			}
		} finally {
			unwatch();
			this.recorder = undefined;
			detach();
			this.listenBetweenSteps(journal);
		}
		const cut = resumedFrom ?? buffer.entries.length;
		const own = partOf(buffer.entries.slice(0, cut));
		const later = partOf(buffer.entries.slice(cut));
		const all = partition(buffer.collect(hitch));
		const error = this.errorOf(ctx, thrown, own.hitches.failed);
		const laterError = this.errorOf(ctx, resumedThrown, later.hitches.failed);
		return {
			model: own.model + error.model + heldText(own),
			user: own.user + later.user + laterError.user + error.user,
			notes: buffer.collect(note),
			entries: forwarded(buffer.entries),
			effects: buffer.collect(effect),
			failed: thrown !== undefined,
			failure: laterError.user + error.user,
			held: all.held.length > 0,
			results,
			skipped: all.skipped,
		};
	}

	private errorOf(
		ctx: StepContext,
		thrown: unknown,
		failed: readonly Hitch[],
	): Bounded {
		if (thrown === undefined) return { model: "", user: "" };
		if (thrown === EndOfFile)
			return {
				model: "unbalanced expression (unexpected end of input)\n",
				user: "",
			};
		const text = `${failed.at(-1)?.text ?? String(thrown)}\n`;
		return this.hooks.stepError.run(
			() => ({ model: text, user: text }),
			ctx,
			text,
		);
	}

	private watch(interp: ConversationInterpreter): void {
		interp.journal.on(released, ({ hold }) => this.decided.add(hold));
		this.listenBetweenSteps(interp.journal);
	}

	private async raceHold(run: () => Promise<unknown>): Promise<Settled> {
		const { holds, journal } = this.currentInterp;
		let onParked!: (hold: Hold) => void;
		const parkedHold = new Promise<Hold>((resolve) => {
			onParked = resolve;
		});
		const unlisten = journal.on(hitch, (h) => {
			const hold = h.hold === undefined ? undefined : holds.get(h.hold);
			if (h.kind === "held" && hold !== undefined) onParked(hold);
		});
		holds.parkable = true;
		try {
			const running = run();
			const first = await Promise.race([
				running.then((thrown) => ({ thrown })),
				parkedHold.then((held) => ({ held })),
			]);
			if ("held" in first) {
				running.catch(() => undefined);
				this.parked.push({
					hold: first.held,
					run: running,
					evaluation: journal.evaluation,
				});
			}
			return first;
		} finally {
			unlisten();
			holds.parkable = false;
		}
	}

	private async resumeDecided(): Promise<unknown> {
		const { holds, journal } = this.currentInterp;
		const ready = this.parked.filter((p) => this.decided.has(p.hold.id));
		this.parked = this.parked.filter((p) => !this.decided.has(p.hold.id));
		const evaluation = journal.evaluation;
		let thrown: unknown;
		try {
			for (const { hold, run, evaluation: parkedAt } of ready) {
				this.decided.delete(hold.id);
				holds.take(hold.id);
				journal.evaluation = parkedAt;
				hold.resume();
				thrown = (await run) ?? thrown;
			}
		} finally {
			journal.evaluation = evaluation;
		}
		return thrown;
	}

	async eval(code: string): Promise<string> {
		return (await this.evalOutput(code)).model;
	}

	reset(): void {
		this.parked = [];
		this.decided.clear();
		this.currentInterp.dispose();
		this.currentInterp = this.freshInterp();
	}
}

interface Noted {
	readonly notes: readonly ConversationRecord[];
	readonly entries: readonly Entry[];
}

export class AgentRepl extends MemoryRepl {
	protected override setup(interp: ConversationInterpreter): void {
		const previous = this.currentInterpOrUndefined();
		if (previous !== undefined) interp.carryFrom(previous);
	}

	async evalMessage(code: string, origin?: string): Promise<EvalOutput> {
		return render(await this.evaluate(code, origin));
	}

	override async evalOutput(
		code: string,
		origin?: string,
		live?: LiveEntries,
	): Promise<EvalOutput> {
		const result = await this.evaluate(code, origin, live, "assistant");
		if (result.held) return ending(render(result));
		return ends(result.effects) ? render(result, "") : render(result);
	}

	unrun(code: string): Skipped[] {
		return this.hooks.unrun.run(() => [], this.interp, code);
	}

	async turnStart(
		around?: Middleware<[TurnContext], Eval<void>>,
	): Promise<Noted> {
		const chain = outermost(this.hooks.turnStart, around);
		const { notes, entries } = await this.noting((ctx) =>
			chain.run(() => settled(undefined), ctx),
		);
		return { notes, entries };
	}

	async received(
		received: Received,
		around?: Middleware<[TurnContext, Received], Eval<void>>,
	): Promise<Noted> {
		const chain = outermost(this.hooks.received, around);
		const { notes, entries } = await this.noting((ctx) =>
			chain.run(() => settled(undefined), ctx, received),
		);
		return { notes, entries };
	}

	async beginStep(): Promise<Noted> {
		const { notes, entries } = await this.noting((ctx) =>
			this.hooks.beginStep.run(() => settled(undefined), ctx),
		);
		return { notes, entries };
	}

	async beforeSettle(more: boolean): Promise<Noted & { more: boolean }> {
		const { beforeSettle } = this.hooks;
		let decided = more;
		const { notes, entries } = await this.noting(function* (ctx) {
			decided = yield* beforeSettle.run((_c, m) => settled(m), ctx, more);
		});
		return { more: decided, notes, entries };
	}

	answer(code: string): string {
		return this.hooks.answer.run((_i, c) => c, this.interp, code);
	}

	settled(
		turn: AgentTurn,
		end: AgentEnd,
		around?: Middleware<[AgentTurn, AgentEnd], void>,
	): void {
		outermost(this.hooks.settled, around).run(() => {}, turn, end);
	}

	private async noting<T>(
		run: (ctx: TurnContext) => Eval<T>,
	): Promise<Noted & { value: T }> {
		const { interp } = this;
		const earlier = this.notedBetweenSteps();
		const buffer = bufferSink();
		const detach = interp.journal.pipe(buffer);
		let value: T;
		try {
			({ value } = await driveAsync(run({ interp })));
		} finally {
			detach();
			this.handledBetweenSteps(buffer.entries);
		}
		return {
			value,
			notes: [...earlier, ...buffer.collect(note)],
			entries: forwarded(buffer.entries),
		};
	}

	seed(records: readonly ConversationRecord[], stepsTaken: number): void {
		this.interp.seed(records, stepsTaken);
	}
}

function ending(output: EvalOutput): EvalOutput {
	return { ...output, effects: [...output.effects, END] };
}

function outermost<A extends unknown[], R>(
	chain: Chain<A, R>,
	around: Middleware<A, R> | undefined,
): Chain<A, R> {
	return around === undefined ? chain : chain.wrappedBy(around);
}

function resumedNote(printed: string): string {
	return printed.trim() === ""
		? "The held step carried on and finished."
		: `The held step carried on:\n${printed}`;
}
