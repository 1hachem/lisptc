import type { Channels, Envelope } from "@repo/interpreter/channels";
import {
	bufferTransport,
	type ChannelBuffer,
} from "@repo/interpreter/channels-host";
import {
	driveAsync,
	type Eval,
	type Hold,
	settled,
} from "@repo/interpreter/drive";
import { type Effect, effect } from "@repo/interpreter/effects";
import { EvalException, StepHold } from "@repo/interpreter/errors";
import {
	type Chain,
	type Middleware,
	noOpinion,
} from "@repo/interpreter/hooks";
import { type Image, restore, snapshot } from "@repo/interpreter/image";
import { Interp, runAsync, runSync } from "@repo/interpreter/lisp";
import { EndOfFile, Unspecified } from "@repo/interpreter/objects";
import { prelude } from "@repo/interpreter/prelude";
import { str } from "@repo/interpreter/print";
import {
	type Admission,
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
import type { Checkpoint, ImageStore } from "./image-store.ts";

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
	effects: readonly Effect[];
	emitted: string;
	failed: boolean;
	held: boolean;
	message?: string;
	results: readonly string[];
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

interface FormRecorder {
	begin(): number;
	end(skipsBefore: number, value: unknown): void;
}

function recordTopLevel(buffer: ChannelBuffer): {
	recorder: FormRecorder;
	results: string[];
} {
	const results: string[] = [];
	const skips = () =>
		buffer.collect(note).filter((n) => n.kind === "skipped").length;
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
		effects: result.effects,
		emitted: result.emitted,
		failed: result.failed,
		held: result.held,
		message: result.message,
		results: result.results,
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
	private currentInterp: Interp;
	private inFlight: Promise<void> = Promise.resolve();
	private parked: Parked[] = [];
	private recorder: FormRecorder | undefined;
	private betweenSteps:
		| { channels: Channels; buffer: ChannelBuffer; detach: () => void }
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

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		const interp = new Interp({ extensions: this.extensions });
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
		const interp = new Interp({ extensions: this.extensions });
		try {
			restore(interp, image);
		} catch (ex) {
			interp.dispose();
			throw ex;
		}
		this.parked = [];
		this.currentInterp.dispose();
		this.currentInterp = interp;
		this.calls = depth;
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

	async evalOutput(code: string, origin?: string): Promise<EvalOutput> {
		return render(await this.evaluate(code, origin));
	}

	protected evaluate(code: string, origin?: string): Promise<StepResult> {
		return this.serialize(
			code,
			(ctx) =>
				this.hooks.evalStep.run(async (c) => {
					await runAsync(c.interp, c.code);
				}, ctx),
			origin,
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
		origin?: string,
	): Promise<StepResult> {
		return this.enqueue(() =>
			this.runStep(code, body).then((result) =>
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

	private listenBetweenSteps(channels: Channels): void {
		const buffer = bufferTransport();
		this.betweenSteps = { channels, buffer, detach: channels.pipe(buffer) };
	}

	private takeBetweenSteps(channels: Channels): readonly Envelope[] {
		const between = this.betweenSteps;
		this.betweenSteps = undefined;
		if (between === undefined) return [];
		between.detach();
		return between.channels === channels ? between.buffer.envelopes : [];
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
		channels.step = this.calls + 1;
		const buffer = bufferTransport();
		for (const envelope of this.takeBetweenSteps(channels))
			buffer.send(envelope);
		const detach = channels.pipe(buffer);
		const { recorder, results } = recordTopLevel(buffer);
		this.recorder = recorder;
		let thrown: unknown;
		let carried = false;
		let carriedThrown: unknown;
		try {
			const ran = await this.untilHeld(() => caught(body(ctx)));
			if ("thrown" in ran) {
				thrown = ran.thrown;
				if (this.parked.some((p) => p.hold.released)) {
					carried = true;
					const resumed = await this.untilHeld(() => this.carryOn());
					if ("thrown" in resumed) carriedThrown = resumed.thrown;
				}
			}
		} finally {
			this.recorder = undefined;
			detach();
			this.listenBetweenSteps(channels);
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
			effects: buffer.collect(effect),
			failed: thrown !== undefined,
			held: held.length > 0,
			message: carried
				? [message, carriedOn(bounded.model + carriedError.model + holding)]
						.filter((m) => m !== undefined)
						.join("\n\n")
				: message,
			results,
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

	private async untilHeld(run: () => Promise<unknown>): Promise<Settled> {
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
				this.parked.push({ hold: first.held, run: running });
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
		this.parked = [];
		this.currentInterp.dispose();
		this.currentInterp = this.freshInterp();
	}
}

export class AgentRepl extends MemoryRepl {
	private pendingProse: string[] = [];

	async evalMessage(code: string, origin?: string): Promise<EvalOutput> {
		return render(await this.evaluate(code, origin));
	}

	override async evalOutput(
		code: string,
		origin?: string,
	): Promise<EvalOutput> {
		const result = await this.evaluate(code, origin);
		if (result.held) return ending(render(result));
		if (!this.answered(code, result)) return render(result);
		this.pendingProse.push(...result.skipped);
		return {
			model: result.model,
			user: result.user,
			annotations: result.annotations,
			effects: [...result.effects, END],
			emitted: result.emitted,
			failed: result.failed,
			held: result.held,
			message: result.message,
			results: result.results,
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

	admit(code: string): Promise<Admission> {
		return this.hooks.admit.run(
			async (_i, c) => ({ code: c }),
			this.interp,
			code,
		);
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

	takeProseFeedback(): string {
		const notes = this.pendingProse;
		this.pendingProse = [];
		return skipNotes(notes);
	}

	clearTurnSignals(): void {
		this.pendingProse = [];
	}

	override reset(): void {
		super.reset();
		this.clearTurnSignals();
	}

	override async recover(): Promise<number | undefined> {
		const depth = await super.recover();
		this.clearTurnSignals();
		return depth;
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

function carriedOn(printed: string): string {
	return printed.trim() === ""
		? "The held step carried on and finished."
		: `The held step carried on:\n${printed}`;
}
