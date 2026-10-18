import type { Envelope } from "@repo/interpreter/channels";
import { bufferTransport } from "@repo/interpreter/channels-host";
import {
	driveAsync,
	type Eval,
	type Hold,
	settled,
} from "@repo/interpreter/drive";
import { EvalException, StepHold } from "@repo/interpreter/errors";
import {
	type Chain,
	type Middleware,
	noOpinion,
} from "@repo/interpreter/hooks";
import { type Image, restore, snapshot } from "@repo/interpreter/image";
import {
	Interp,
	runAsync,
	runSync,
	type State,
	type StateCodec,
} from "@repo/interpreter/lisp";
import {
	arrayToList,
	EndOfFile,
	jsonToLisp,
	type List,
	listToArray,
	newSym,
} from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import {
	type AgentEnd,
	type AgentStep,
	type AgentTurn,
	type Bounded,
	type InterpExtension,
	type ModelDelta,
	type ModelRequest,
	noAnnotations,
	openSession,
	type SessionHooks,
	type StepAnnotations,
	type StepContext,
	type StepVerdict,
	type TurnContext,
} from "@repo/interpreter/session";
import { type Note, note } from "@repo/interpreter/topics";
import type { Skipped } from "@repo/shared/lisp-forms";
import type { ChatMessage } from "@repo/shared/messages";
import type { ImageStore } from "./image-store.ts";

export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

export interface InMemoryRepl extends Repl {
	eval(code: string): Promise<string>;
}

export interface ReplOptions {
	extensions: InterpExtension[];
	images?: ImageStore;
}

export interface EvalOutput extends Bounded {
	annotations: StepAnnotations;
	emitted: string;
	failed: boolean;
	held: boolean;
	message?: string;
	call?: number;
}

export interface StepResult extends EvalOutput {
	envelopes: readonly Envelope[];
	skipped: string[];
}

function partition(notes: readonly Note[]): {
	skipped: string[];
	failed: Note[];
	held: Note[];
} {
	const skipped: string[] = [];
	const failed: Note[] = [];
	const held: Note[] = [];
	for (const n of notes)
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
				throw new Error(`unhandled note kind ${String(unhandled)}`);
			}
		}
	return { skipped, failed, held };
}

interface Parked {
	readonly hold: Hold;
	readonly run: Promise<unknown>;
	readonly code: string;
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

function render(result: StepResult): EvalOutput {
	const notes = skipNotes(result.skipped);
	return {
		model: result.model + notes,
		user: result.user + notes,
		annotations: result.annotations,
		emitted: result.emitted,
		failed: result.failed,
		held: result.held,
		message: result.message,
		call: result.call,
	};
}

const calls: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

const codes: StateCodec<string[]> = {
	toLisp: (list) => arrayToList(list),
	fromLisp: (x) => listToArray(x as List) as string[],
};

function notCheckpointed(call: number, ex: unknown): string {
	return `Call ${call} was not checkpointed, so it cannot be restored or reverted to: ${ex instanceof Error ? ex.message : String(ex)}`;
}

export function droppedNote(code: readonly string[]): string | undefined {
	if (code.length === 0) return undefined;
	return `The REPL was restored from a checkpoint, and ${code.length === 1 ? "a step that was" : "steps that were"} waiting on an approval did not survive it. Run again whatever still needs doing:\n${code.join("\n")}`;
}

export class MemoryRepl implements InMemoryRepl {
	private currentInterp: Interp;
	private inFlight: Promise<void> = Promise.resolve();
	private parked: Parked[] = [];
	private readonly extensions: InterpExtension[];
	private readonly images: ImageStore | undefined;
	private saving: Promise<void> = Promise.resolve();
	private dropped: string[] = [];
	private unsaved: string[] = [];
	private calls!: State<number>;
	private parkedCode!: State<string[]>;
	readonly hooks: SessionHooks;

	constructor(options: ReplOptions) {
		this.extensions = options.extensions;
		this.images = options.images;
		this.hooks = openSession(this.extensions);
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	get call(): number {
		return this.calls.get();
	}

	private build(): Interp {
		const interp = new Interp({ extensions: this.extensions });
		this.calls = interp.state(
			"repl/call",
			calls,
			0,
			"How many calls this REPL has run. A checkpoint is kept after each one, numbered by it.",
		);
		this.parkedCode = interp.state(
			"repl/parked",
			codes,
			[],
			"The code of each step still waiting on an approval.",
		);
		return interp;
	}

	private freshInterp(): Interp {
		const interp = this.build();
		runSync(interp, prelude);
		this.setup(interp);
		return interp;
	}

	async resume(): Promise<number | undefined> {
		const latest = await this.images?.latest();
		if (latest === undefined) return undefined;
		this.load(latest.image);
		return latest.call;
	}

	takeDropped(): readonly string[] {
		const { dropped } = this;
		this.dropped = [];
		return dropped;
	}

	revert(call: number): Promise<number> {
		return this.enqueue(async () => {
			await this.saving;
			const checkpoint = await this.images?.at(call);
			if (checkpoint === undefined)
				throw new Error(`no checkpoint for call ${call}`);
			this.load(checkpoint.image);
			await this.images?.dropAfter(call);
			return call;
		});
	}

	revertToLatest(): Promise<number | undefined> {
		return this.enqueue(async () => {
			await this.saving;
			const latest = await this.images?.latest();
			if (latest === undefined) return undefined;
			this.load(latest.image);
			return latest.call;
		});
	}

	private load(image: Image): void {
		const { calls, parkedCode } = this;
		const interp = this.build();
		try {
			restore(interp, image);
		} catch (ex) {
			this.calls = calls;
			this.parkedCode = parkedCode;
			throw ex;
		}
		this.parked = [];
		this.currentInterp.dispose();
		this.currentInterp = interp;
		this.dropped = this.parkedCode.get();
		this.parkedCode.set([]);
	}

	private checkpoint(result: StepResult): StepResult {
		const call = this.calls.get() + 1;
		this.calls.set(call);
		const notes = [result.message, droppedNote(this.dropped), ...this.unsaved];
		this.dropped = [];
		this.unsaved = [];
		const { images } = this;
		if (images !== undefined) {
			this.parkedCode.set(this.parked.map((p) => p.code));
			try {
				const image = snapshot(this.currentInterp);
				this.saving = this.saving
					.then(() => images.save({ call, image }))
					.catch((ex) => {
						this.unsaved.push(notCheckpointed(call, ex));
					});
			} catch (ex) {
				notes.push(notCheckpointed(call, ex));
			}
		}
		const message = notes.filter((m) => m !== undefined).join("\n\n");
		return {
			...result,
			call: images === undefined ? undefined : call,
			message: message === "" ? undefined : message,
		};
	}

	protected setup(_interp: Interp): void {}

	protected currentInterpOrUndefined(): Interp | undefined {
		return this.currentInterp as Interp | undefined;
	}

	async evalOutput(code: string): Promise<EvalOutput> {
		return render(await this.evaluate(code));
	}

	protected evaluate(code: string): Promise<StepResult> {
		return this.serialize(code, (ctx) =>
			this.hooks.evalStep.run(async (c) => {
				await runAsync(c.interp, c.code);
			}, ctx),
		);
	}

	async invokeUi(
		action: string,
		values: Record<string, unknown> = {},
	): Promise<EvalOutput> {
		return render(
			await this.serialize("", (ctx) =>
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
		body: (ctx: StepContext) => Promise<void>,
	): Promise<StepResult> {
		return this.enqueue(() =>
			this.runStep(code, body).then((result) => this.checkpoint(result)),
		);
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const done = this.inFlight.then(task, task);
		this.inFlight = done.then(
			() => undefined,
			() => undefined,
		);
		return done;
	}

	private async runStep(
		code: string,
		body: (ctx: StepContext) => Promise<void>,
	): Promise<StepResult> {
		let emitted = "";
		const interp = this.currentInterp;
		const ctx: StepContext = {
			interp,
			code,
			emit: (text) => {
				emitted += text;
			},
		};
		const { channels } = interp;
		channels.step = this.calls.get() + 1;
		const buffer = bufferTransport();
		const detach = channels.pipe(buffer);
		let thrown: unknown;
		let carried = false;
		let carriedThrown: unknown;
		try {
			const ran = await this.untilHeld(() => caught(body(ctx)), code);
			if ("thrown" in ran) {
				thrown = ran.thrown;
				if (this.parked.some((p) => p.hold.released)) {
					carried = true;
					const resumed = await this.untilHeld(() => this.carryOn(), code);
					if ("thrown" in resumed) carriedThrown = resumed.thrown;
				}
			}
		} finally {
			detach();
		}
		const { skipped, failed, held } = partition(buffer.collect(note));
		const holding = held.map((n) => `held: ${n.text}\n`).join("");
		const bounded = this.hooks.stepOutput.run((_c, out) => out, ctx, {
			model: buffer.collectText("model"),
			user: buffer.collectText("user"),
		});
		const error = this.errorOf(ctx, thrown, failed);
		const carriedError = this.errorOf(ctx, carriedThrown, failed);
		const message = this.hooks.message.run(noOpinion, buffer);
		return {
			envelopes: buffer.envelopes,
			model: carried ? error.model : bounded.model + error.model + holding,
			user: bounded.user + carriedError.user + error.user,
			emitted,
			annotations: this.hooks.annotate.run(
				(_b, into) => into,
				buffer,
				noAnnotations(),
			),
			failed: thrown !== undefined,
			held: held.length > 0,
			message: carried
				? [message, carriedOn(bounded.model + carriedError.model + holding)]
						.filter((m) => m !== undefined)
						.join("\n\n")
				: message,
			skipped,
		};
	}

	private errorOf(
		ctx: StepContext,
		thrown: unknown,
		failed: readonly Note[],
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

	private async untilHeld(
		run: () => Promise<unknown>,
		code: string,
	): Promise<Settled> {
		let parked!: (hold: Hold) => void;
		const holding = new Promise<Hold>((resolve) => {
			parked = resolve;
		});
		const unpark = this.currentInterp.holds.parkWith(parked);
		try {
			const running = run();
			const first = await Promise.race([
				running.then((thrown) => ({ thrown })),
				holding.then((held) => ({ held })),
			]);
			if ("held" in first) {
				running.catch(() => undefined);
				this.parked.push({ hold: first.held, run: running, code });
			}
			return first;
		} finally {
			unpark();
		}
	}

	private async carryOn(): Promise<unknown> {
		const ready = this.parked.filter((p) => p.hold.released);
		this.parked = this.parked.filter((p) => !p.hold.released);
		let thrown: unknown;
		for (const { hold, run } of ready) {
			hold.resume();
			thrown = (await run) ?? thrown;
		}
		return thrown;
	}

	async eval(code: string): Promise<string> {
		return (await this.evalOutput(code)).model;
	}

	reset(): void {
		const call = this.calls.get();
		this.parked = [];
		this.currentInterp.dispose();
		this.currentInterp = this.freshInterp();
		this.calls.set(call);
	}
}

export class AgentRepl extends MemoryRepl {
	private finished = false;
	private pendingProse: string[] = [];
	private conversationNames: string[] = [];

	protected override setup(interp: Interp): void {
		const previous = this.currentInterpOrUndefined();
		for (const name of this.conversationNames ?? []) {
			const sym = newSym(name);
			if (previous?.hasGlobal(sym))
				defineLisp(interp, name, previous.getGlobal(sym));
		}
	}

	override async evalOutput(code: string): Promise<EvalOutput> {
		const result = await this.evaluate(code);
		if (result.held) {
			this.finished = true;
			return render(result);
		}
		if (!this.answered(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return {
			model: result.model,
			user: result.user,
			annotations: result.annotations,
			emitted: result.emitted,
			failed: result.failed,
			held: result.held,
			message: result.message,
			call: result.call,
		};
	}

	private answered(code: string, result: StepResult): boolean {
		return this.hooks.answered.run(
			() => false,
			{ interp: this.interp, code, emit: () => {} },
			{
				model: result.model,
				user: result.user,
				skipped: result.skipped,
				failed: result.failed,
			},
		);
	}

	unrun(code: string): Skipped[] {
		return this.hooks.unrun.run(() => [], this.interp, code);
	}

	async turnStart(
		around?: Middleware<[TurnContext], Eval<void>>,
	): Promise<{ emitted: string; annotations: StepAnnotations }> {
		const chain = outermost(this.hooks.turnStart, around);
		const { emitted, annotations } = await this.emitting((ctx) =>
			chain.run(() => settled(undefined), ctx),
		);
		return { emitted, annotations };
	}

	async system(
		prompt: string,
	): Promise<{ prompt: string; annotations: StepAnnotations }> {
		const { value, annotations } = await this.emitting(() =>
			this.hooks.system.run((_i, p) => settled(p), this.interp, prompt),
		);
		return { prompt: value, annotations };
	}

	beginStep(): Promise<{
		emitted: string;
		annotations: StepAnnotations;
	}> {
		return this.emitting((ctx) =>
			this.hooks.beginStep.run(() => settled(undefined), ctx),
		);
	}

	context(messages: readonly ChatMessage[]): readonly ChatMessage[] {
		return this.hooks.context.run((_i, m) => m, this.interp, messages);
	}

	modelCall(
		request: ModelRequest,
		call: (request: ModelRequest) => AsyncIterable<ModelDelta>,
	): AsyncIterable<ModelDelta> {
		return this.hooks.modelCall.run((_i, r) => call(r), this.interp, request);
	}

	response(text: string, read: (text: string) => string): string {
		return this.hooks.response.run((_i, t) => read(t), this.interp, text);
	}

	stepEnd(
		turn: AgentTurn,
		step: AgentStep,
		verdict: StepVerdict,
		around?: Middleware<[AgentTurn, AgentStep, StepVerdict], StepVerdict>,
	): StepVerdict {
		return outermost(this.hooks.stepEnd, around).run(
			(_t, _s, v) => v,
			turn,
			step,
			verdict,
		);
	}

	async beforeSettle(
		more: boolean,
	): Promise<{ more: boolean; emitted: string }> {
		const { beforeSettle } = this.hooks;
		let decided = more;
		const { emitted } = await this.emitting(function* (ctx) {
			decided = yield* beforeSettle.run((_c, m) => settled(m), ctx, more);
		});
		return { more: decided, emitted };
	}

	settled(
		turn: AgentTurn,
		end: AgentEnd,
		around?: Middleware<[AgentTurn, AgentEnd], void>,
	): void {
		outermost(this.hooks.settled, around).run(() => {}, turn, end);
	}

	private async emitting<T>(
		run: (ctx: TurnContext) => Eval<T>,
	): Promise<{ value: T; emitted: string; annotations: StepAnnotations }> {
		let emitted = "";
		const { channels } = this.interp;
		const buffer = bufferTransport();
		const detach = channels.pipe(buffer);
		let value: T;
		try {
			({ value } = await driveAsync(
				run({
					interp: this.interp,
					emit: (text) => {
						emitted += emitted === "" ? text : `\n\n${text}`;
					},
				}),
			));
		} finally {
			detach();
		}
		return {
			value,
			emitted,
			annotations: this.hooks.annotate.run(
				(_b, into) => into,
				buffer,
				noAnnotations(),
			),
		};
	}

	setConversationVars(vars: Record<string, unknown>): void {
		this.conversationNames = Object.keys(vars);
		for (const [name, value] of Object.entries(vars))
			defineLisp(this.interp, name, jsonToLisp(value));
	}

	takeFinished(): boolean {
		const f = this.finished;
		this.finished = false;
		return f;
	}

	takeProseFeedback(): string {
		const notes = this.pendingProse;
		this.pendingProse = [];
		return skipNotes(notes);
	}

	clearTurnSignals(): void {
		this.finished = false;
		this.pendingProse = [];
	}

	override reset(): void {
		super.reset();
		this.clearTurnSignals();
	}
}

function outermost<A extends unknown[], R>(
	chain: Chain<A, R>,
	around: Middleware<A, R> | undefined,
): Chain<A, R> {
	return around === undefined ? chain : chain.wrappedBy(around);
}

function defineLisp(interp: Interp, name: string, value: unknown): void {
	const sym = newSym(name);
	interp.defineGlobal(sym, value, {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
	interp.seal(sym, "repl");
}

function carriedOn(printed: string): string {
	return printed.trim() === ""
		? "The held step carried on and finished."
		: `The held step carried on:\n${printed}`;
}
