import type { Envelope } from "@repo/interpreter/channels";
import { bufferTransport } from "@repo/interpreter/channels-host";
import { noOpinion } from "@repo/interpreter/hooks";
import type { InterpExtension } from "@repo/interpreter/lisp";
import {
	driveAsync,
	EndOfFile,
	EvalException,
	Interp,
	jsonToLisp,
	newSym,
	prelude,
	runAsync,
	runSync,
	settled,
} from "@repo/interpreter/lisp";
import {
	type Bounded,
	noAnnotations,
	openSession,
	type SessionHooks,
	type StepAnnotations,
	type StepContext,
} from "@repo/interpreter/session";
import { type Note, note } from "@repo/interpreter/topics";

export interface Repl {
	readonly interp: Interp;
	reset(): void;
}

export interface InMemoryRepl extends Repl {
	eval(code: string): Promise<string>;
}

export interface ReplOptions {
	extensions: InterpExtension[];
}

export interface EvalOutput extends Bounded {
	annotations: StepAnnotations;
	failed: boolean;
	message?: string;
}

interface StepResult extends EvalOutput {
	envelopes: readonly Envelope[];
	skipped: string[];
	feedback: string;
}

function partition(notes: readonly Note[]): {
	skipped: string[];
	failed: Note[];
} {
	const skipped: string[] = [];
	const failed: Note[] = [];
	for (const n of notes)
		switch (n.kind) {
			case "skipped":
				if (!skipped.includes(n.text)) skipped.push(n.text);
				break;
			case "failed":
				failed.push(n);
				break;
			default: {
				const unhandled: never = n.kind;
				throw new Error(`unhandled note kind ${String(unhandled)}`);
			}
		}
	return { skipped, failed };
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
		failed: result.failed,
		message: result.message,
	};
}

export class MemoryRepl implements InMemoryRepl {
	private currentInterp: Interp;
	private inFlight: Promise<void> = Promise.resolve();
	private readonly extensions: InterpExtension[];
	readonly hooks: SessionHooks;

	constructor(options: ReplOptions) {
		this.extensions = options.extensions;
		this.hooks = openSession(this.extensions);
		this.currentInterp = this.freshInterp();
	}

	get interp(): Interp {
		return this.currentInterp;
	}

	private freshInterp(): Interp {
		const interp = new Interp({ extensions: this.extensions });
		runSync(interp, prelude);
		this.setup(interp);
		return interp;
	}

	protected setup(_interp: Interp): void {}

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
		const run = () => this.runStep(code, body);
		const done = this.inFlight.then(run, run);
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
		let feedback = "";
		const interp = this.currentInterp;
		const ctx: StepContext = {
			interp,
			code,
			emit: (text) => {
				feedback += text;
			},
		};
		const { channels } = interp;
		channels.step += 1;
		const buffer = bufferTransport();
		const detach = channels.pipe(buffer);
		let thrown: unknown;
		try {
			await body(ctx);
		} catch (ex) {
			if (!(ex instanceof EvalException) && ex !== EndOfFile) throw ex;
			thrown = ex;
		} finally {
			detach();
		}
		const { skipped, failed } = partition(buffer.payloads(note));
		let error: Bounded = { model: "", user: "" };
		if (thrown === EndOfFile) {
			const text = "unbalanced expression (unexpected end of input)\n";
			error = { model: text, user: "" };
		} else if (thrown !== undefined) {
			const text = `${failed.at(-1)?.text ?? String(thrown)}\n`;
			error = this.hooks.stepError.run(
				() => ({ model: text, user: text }),
				ctx,
				text,
			);
		}
		const bounded = this.hooks.stepOutput.run((_c, out) => out, ctx, {
			model: buffer.text("model"),
			user: buffer.text("user"),
		});
		return {
			envelopes: buffer.envelopes,
			model: bounded.model + error.model,
			user: bounded.user + error.user,
			feedback,
			annotations: this.hooks.annotate.run(
				(_b, into) => into,
				buffer,
				noAnnotations(),
			),
			failed: thrown !== undefined,
			message: this.hooks.message.run(noOpinion, buffer),
			skipped,
		};
	}

	async eval(code: string): Promise<string> {
		return (await this.evalOutput(code)).model;
	}

	reset(): void {
		this.currentInterp.dispose();
		this.currentInterp = this.freshInterp();
	}
}

export class AgentRepl extends MemoryRepl {
	private finished = false;
	private pendingProse: string[] = [];
	private readonly conversationVars = new Map<string, unknown>();

	protected override setup(interp: Interp): void {
		const vars = this.conversationVars;
		if (vars) for (const [name, value] of vars) defineVar(interp, name, value);
	}

	override async evalOutput(code: string): Promise<EvalOutput> {
		const result = await this.evaluate(code);
		if (!this.answered(code, result)) return render(result);
		this.finished = true;
		this.pendingProse.push(...result.skipped);
		return {
			model: result.model,
			user: result.user,
			annotations: result.annotations,
			failed: result.failed,
			message: result.message,
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

	unrun(code: string): string[] {
		return this.hooks.unrun.run(() => [], this.interp, code);
	}

	async beginTurn(): Promise<{ said: string; annotations: StepAnnotations }> {
		let said = "";
		const { channels } = this.interp;
		const buffer = bufferTransport();
		const detach = channels.pipe(buffer);
		try {
			await driveAsync(
				this.hooks.beginTurn.run(() => settled(undefined), {
					interp: this.interp,
					say: (text) => {
						said += said === "" ? text : `\n\n${text}`;
					},
				}),
			);
		} finally {
			detach();
		}
		return {
			said,
			annotations: this.hooks.annotate.run(
				(_b, into) => into,
				buffer,
				noAnnotations(),
			),
		};
	}

	setConversationVars(vars: Record<string, unknown>): void {
		this.conversationVars.clear();
		for (const [name, value] of Object.entries(vars)) {
			this.conversationVars.set(name, value);
			defineVar(this.interp, name, value);
		}
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

function defineVar(interp: Interp, name: string, value: unknown): void {
	interp.defineGlobal(newSym(name), jsonToLisp(value), {
		signature: name,
		doc: "Read-only live conversation state (auto-updated each step).",
	});
}
